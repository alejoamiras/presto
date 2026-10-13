//! The newest list this machine accepted, kept as its served envelope. Every read verifies it, so a
//! forged or corrupt file is ignored rather than trusted, and every write only moves it forward.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::list::SiteList;
use super::verify::{document, judge, verify_document, Judgement, ListKey, VerifiedDocument};
use super::{ListError, DOCUMENT_MAX_BYTES};

/// A stopped holder (a suspended instance) keeps its lock indefinitely; a save waits this long.
const LOCK_WAIT: Duration = Duration::from_secs(1);
/// One byte past the cap, so an oversized file is detected rather than silently truncated.
const READ_LIMIT: u64 = DOCUMENT_MAX_BYTES as u64 + 1;

#[derive(Debug)]
pub enum LoadError {
    Read(std::io::Error),
    Invalid(ListError),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Read(e) => write!(f, "unreadable: {e}"),
            Self::Invalid(e) => write!(f, "invalid: {e}"),
        }
    }
}

/// What [`ListStore::save_if_newer`] found. Only `Saved` and `WriteFailed` leave the candidate the
/// newest verified list; the other two name what the disk holds instead.
#[derive(Debug)]
pub enum SaveOutcome {
    /// The candidate is on disk (or already was).
    Saved,
    /// Another instance stored a newer list; it, not the candidate, is the newest.
    DiskNewer(SiteList),
    /// The disk holds a different verified list at the candidate's version.
    Equivocation,
    /// The candidate could not be stored. Any verified list on disk was older than it.
    WriteFailed(std::io::Error),
}

pub struct ListStore {
    path: Option<PathBuf>,
    key: ListKey,
}

impl ListStore {
    /// `path: None` keeps nothing: loads find no list and saves succeed without writing.
    pub fn new(path: Option<PathBuf>, key: ListKey) -> Self {
        Self { path, key }
    }

    /// The stored list, verified under the pinned key. Takes no lock: writers rename a complete
    /// file into place, so a read sees the old file or the new one.
    pub fn load(&self) -> Result<Option<SiteList>, LoadError> {
        match self.path.as_deref() {
            Some(path) => read_verified(path, &self.key),
            None => Ok(None),
        }
    }

    /// Stores `candidate` unless the disk already holds a list at least as new. Blocking: the file
    /// lock is polled for up to [`LOCK_WAIT`]. The disk is re-read and re-verified under the lock, so
    /// two instances can never move it backwards, and a caller never activates a list older than one
    /// it could have read.
    pub fn save_if_newer(&self, candidate: &VerifiedDocument) -> SaveOutcome {
        let Some(path) = self.path.as_deref() else {
            return SaveOutcome::Saved;
        };
        let lock = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| {
                crate::file_lock::lock_exclusive_within(
                    &path.with_extension("json.lock"),
                    LOCK_WAIT,
                )
            });
        // Judged even without the lock: a failed save still swaps memory, so it must not skip a
        // newer list on disk. An unreadable or unverifiable file protects nothing and is replaced.
        if let Ok(Some(disk)) = read_verified(path, &self.key) {
            match judge(&disk, &candidate.list) {
                Judgement::Accept => {}
                Judgement::Unchanged => return SaveOutcome::Saved,
                Judgement::Equivocation => return SaveOutcome::Equivocation,
                Judgement::Older => return SaveOutcome::DiskNewer(disk),
            }
        }
        let _lock = match lock {
            Ok(lock) => lock,
            Err(e) => return SaveOutcome::WriteFailed(e),
        };
        let body = document(candidate.list.bytes(), &candidate.signature);
        match crate::updater_state::write_private_atomic(path, &body, ".verified-sites-") {
            Ok(()) => SaveOutcome::Saved,
            Err(e) => SaveOutcome::WriteFailed(e),
        }
    }
}

fn read_verified(path: &Path, key: &ListKey) -> Result<Option<SiteList>, LoadError> {
    let bytes = match read_capped(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(LoadError::Read(e)),
    };
    verify_document(&bytes, key)
        .map(|verified| Some(verified.list))
        .map_err(LoadError::Invalid)
}

/// Opens without blocking (a FIFO at the path would otherwise hang startup), refuses anything but a
/// regular file on the opened handle, and reads at most [`DOCUMENT_MAX_BYTES`].
fn read_capped(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "not a regular file",
        ));
    }
    let mut bytes = Vec::new();
    file.take(READ_LIMIT).read_to_end(&mut bytes)?;
    if bytes.len() > DOCUMENT_MAX_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "larger than the document cap",
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::verified_sites::verify::verify_list;

    fn fixture(name: &str) -> Vec<u8> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verified_sites");
        std::fs::read(dir.join(name)).unwrap_or_else(|e| panic!("fixture {name}: {e}"))
    }

    fn pinned() -> ListKey {
        ListKey::from_document(&String::from_utf8(fixture("test1.pub")).unwrap()).unwrap()
    }

    /// A fixture list and its signature, as a verified document.
    fn signed(name: &str) -> VerifiedDocument {
        let (list, signature) = (
            fixture(&format!("{name}.json")),
            fixture(&format!("{name}.json.minisig")),
        );
        VerifiedDocument {
            list: verify_list(&list, &signature, &pinned()).unwrap(),
            signature,
        }
    }

    fn envelope(doc: &VerifiedDocument) -> Vec<u8> {
        document(doc.list.bytes(), &doc.signature)
    }

    struct Dir {
        _tmp: tempfile::TempDir,
        path: PathBuf,
    }

    impl Dir {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let path = tmp
                .path()
                .join("presto")
                .join("verified-sites-accepted.json");
            Self { _tmp: tmp, path }
        }

        fn store(&self) -> ListStore {
            ListStore::new(Some(self.path.clone()), pinned())
        }

        fn write(&self, bytes: &[u8]) {
            std::fs::create_dir_all(self.path.parent().unwrap()).unwrap();
            std::fs::write(&self.path, bytes).unwrap();
        }

        fn disk(&self) -> Vec<u8> {
            std::fs::read(&self.path).unwrap()
        }

        fn lock_is_free(&self) -> bool {
            crate::file_lock::try_lock_exclusive(&self.path.with_extension("json.lock"))
                .unwrap()
                .is_some()
        }
    }

    fn version(loaded: Result<Option<SiteList>, LoadError>) -> Option<u64> {
        loaded.unwrap().map(|list| list.version())
    }

    #[test]
    fn saves_the_envelope_privately_and_loads_it_back() {
        let dir = Dir::new();
        let store = dir.store();
        assert_eq!(version(store.load()), None, "nothing stored yet");
        let four = signed("list-4");
        assert!(matches!(store.save_if_newer(&four), SaveOutcome::Saved));
        assert_eq!(dir.disk(), envelope(&four));
        assert_eq!(version(store.load()), Some(4));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&dir.path), 0o600);
            assert_eq!(mode(dir.path.parent().unwrap()), 0o700);
        }
    }

    #[test]
    fn a_memory_only_store_keeps_nothing() {
        let store = ListStore::new(None, pinned());
        assert!(matches!(
            store.save_if_newer(&signed("list-5")),
            SaveOutcome::Saved
        ));
        assert_eq!(version(store.load()), None);
    }

    /// Bad files are refused on load, then replaced by the next accepted list.
    fn assert_refused_then_replaced(dir: &Dir) {
        let store = dir.store();
        let started = Instant::now();
        assert!(store.load().is_err());
        assert!(started.elapsed() < Duration::from_millis(200));
        let five = signed("list-5");
        assert!(matches!(store.save_if_newer(&five), SaveOutcome::Saved));
        assert_eq!(dir.disk(), envelope(&five));
    }

    #[test]
    fn a_corrupt_file_is_refused_and_replaced() {
        let dir = Dir::new();
        dir.write(b"{\"schema\":\"presto-verified-sites-envelope-v1\",\"list\":");
        assert_refused_then_replaced(&dir);
    }

    #[test]
    fn a_forged_file_is_refused_and_replaced() {
        // The legitimate list 5's exact bytes, signed by another key: trusting it would make the
        // fetched list 5 a no-op and leave the forgery on disk.
        let dir = Dir::new();
        dir.write(&document(
            &fixture("list-5.json"),
            &fixture("list-5.wrong-key.minisig"),
        ));
        assert!(matches!(
            dir.store().load(),
            Err(LoadError::Invalid(ListError::KeyMismatch))
        ));
        assert_refused_then_replaced(&dir);
    }

    #[test]
    fn a_forged_list_at_the_highest_version_never_becomes_the_floor() {
        let (list, signature) = (
            fixture("list-max-wrong-key.json"),
            fixture("list-max-wrong-key.json.minisig"),
        );
        let other = ListKey::from_document(&String::from_utf8(fixture("test2.pub")).unwrap());
        let forged = verify_list(&list, &signature, &other.unwrap()).unwrap();
        assert_eq!(forged.version(), crate::verified_sites::MAX_VERSION);
        let dir = Dir::new();
        dir.write(&document(&list, &signature));
        assert!(matches!(
            dir.store().load(),
            Err(LoadError::Invalid(ListError::KeyMismatch))
        ));
        assert_refused_then_replaced(&dir);
        assert_eq!(version(dir.store().load()), Some(5));
    }

    #[test]
    fn an_oversized_file_is_refused_and_replaced() {
        let dir = Dir::new();
        dir.write(&vec![b' '; DOCUMENT_MAX_BYTES + 1]);
        assert_refused_then_replaced(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_never_blocks_and_is_replaced() {
        let dir = Dir::new();
        std::fs::create_dir_all(dir.path.parent().unwrap()).unwrap();
        let c_path = std::ffi::CString::new(dir.path.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        // The save's rename replaces the FIFO like any other bad file. On a thread, so a blocking
        // open fails the test instead of hanging it.
        let checks = std::thread::spawn(move || assert_refused_then_replaced(&dir));
        let deadline = Instant::now() + Duration::from_secs(10);
        while !checks.is_finished() {
            assert!(Instant::now() < deadline, "opening the FIFO blocked");
            std::thread::sleep(Duration::from_millis(10));
        }
        checks.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_never_blocks_and_fails_the_save() {
        let dir = Dir::new();
        std::fs::create_dir_all(&dir.path).unwrap();
        let store = dir.store();
        let started = Instant::now();
        assert!(store.load().is_err());
        assert!(started.elapsed() < Duration::from_millis(200));
        assert!(matches!(
            store.save_if_newer(&signed("list-5")),
            SaveOutcome::WriteFailed(_)
        ));
        assert!(dir.path.is_dir());
        assert!(dir.lock_is_free());
    }

    #[test]
    fn the_disk_never_moves_backwards() {
        let dir = Dir::new();
        let store = dir.store();
        let six = signed("list-6");
        assert!(matches!(store.save_if_newer(&six), SaveOutcome::Saved));
        match store.save_if_newer(&signed("list-5")) {
            SaveOutcome::DiskNewer(disk) => assert_eq!(disk, six.list),
            other => panic!("expected the disk's newer list, got {other:?}"),
        }
        assert_eq!(dir.disk(), envelope(&six));
        assert!(matches!(store.save_if_newer(&six), SaveOutcome::Saved));
        assert_eq!(dir.disk(), envelope(&six));
        assert!(dir.lock_is_free());
    }

    #[test]
    fn a_different_list_at_the_stored_version_is_equivocation() {
        let dir = Dir::new();
        let store = dir.store();
        let five = signed("list-5");
        assert!(matches!(store.save_if_newer(&five), SaveOutcome::Saved));
        assert!(matches!(
            store.save_if_newer(&signed("list-5-equivocating")),
            SaveOutcome::Equivocation
        ));
        assert_eq!(dir.disk(), envelope(&five));
        assert!(dir.lock_is_free());
    }

    #[test]
    fn a_save_waits_for_the_lock_and_releases_it() {
        let dir = Dir::new();
        let store = dir.store();
        assert!(matches!(
            store.save_if_newer(&signed("list-4")),
            SaveOutcome::Saved
        ));
        let held =
            crate::file_lock::try_lock_exclusive(&dir.path.with_extension("json.lock")).unwrap();
        assert!(held.is_some());
        let started = Instant::now();
        match store.save_if_newer(&signed("list-5")) {
            SaveOutcome::WriteFailed(e) => assert_eq!(e.kind(), std::io::ErrorKind::TimedOut),
            other => panic!("expected a lock timeout, got {other:?}"),
        }
        assert!(started.elapsed() >= LOCK_WAIT);
        assert_eq!(version(store.load()), Some(4), "nothing written");
        drop(held);
        assert!(matches!(
            store.save_if_newer(&signed("list-5")),
            SaveOutcome::Saved
        ));
        assert!(dir.lock_is_free());
    }

    #[test]
    fn a_save_that_cannot_lock_still_defers_to_the_disk() {
        let save_beside = |on_disk: &str| {
            let dir = Dir::new();
            dir.write(&envelope(&signed(on_disk)));
            let held = crate::file_lock::try_lock_exclusive(&dir.path.with_extension("json.lock"))
                .unwrap();
            assert!(held.is_some());
            dir.store().save_if_newer(&signed("list-5"))
        };
        match save_beside("list-6") {
            SaveOutcome::DiskNewer(list) => assert_eq!(list.version(), 6),
            other => panic!("expected the disk's list 6, got {other:?}"),
        }
        assert!(matches!(
            save_beside("list-5-equivocating"),
            SaveOutcome::Equivocation
        ));
    }

    #[test]
    fn an_unwritable_directory_fails_the_save() {
        // A regular file where the directory should be: refused on every OS, and as root.
        let tmp = tempfile::tempdir().unwrap();
        let blocker = tmp.path().join("presto");
        std::fs::write(&blocker, b"").unwrap();
        let store = ListStore::new(Some(blocker.join("verified-sites-accepted.json")), pinned());
        assert!(matches!(
            store.save_if_newer(&signed("list-5")),
            SaveOutcome::WriteFailed(_)
        ));
        assert!(store.load().is_err());
    }
}
