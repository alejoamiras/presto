//! No other account may be able to change the pinned file or any directory above it: the rehash
//! before each spawn cannot see a swap made between the hash and the exec.

use std::path::Path;

#[cfg(unix)]
use super::shell_quote;
use super::{display_path, Refusal, RefusalCode};

/// Unix: the file and every ancestor belong to the user or root; none is writable by another
/// account through mode bits (a sticky directory and the user's private group excepted) or through
/// an ACL allow entry. `path` must be canonical.
#[cfg(unix)]
pub(super) fn check(path: &Path) -> Result<(), Refusal> {
    use std::os::unix::fs::MetadataExt;
    let viewer = Viewer::current();
    let ancestors = path.ancestors().skip(1).map(|dir| (dir, false));
    for (node, is_file) in std::iter::once((path, true)).chain(ancestors) {
        let meta = std::fs::symlink_metadata(node).map_err(|e| Refusal::unreadable(node, &e))?;
        let mode = NodeMode {
            uid: meta.uid(),
            gid: meta.gid(),
            mode: meta.mode(),
        };
        let owned = mode.uid == viewer.uid;
        check_mode(mode, &viewer, is_file)
            .map_err(|issue| mode_refusal(issue, node, is_file, owned))?;
        match acl::grants_write(node) {
            Ok(false) => {}
            Ok(true) => return Err(acl_refusal(node, owned)),
            Err(e) => return Err(Refusal::unreadable(node, &e)),
        }
    }
    Ok(())
}

/// Windows: the file must sit under the user's profile, whose default ACL admits only the user,
/// SYSTEM and Administrators. Elsewhere (`C:\dev`), Authenticated Users can usually modify.
#[cfg(windows)]
pub(super) fn check(path: &Path) -> Result<(), Refusal> {
    let profile = dirs::home_dir().and_then(|home| std::fs::canonicalize(home).ok());
    match profile {
        Some(profile) if path.starts_with(&profile) && path != profile => Ok(()),
        Some(profile) => Err(Refusal::new(
            RefusalCode::OutsideProfile,
            format!(
                "Other accounts may be able to modify files outside your user folder. Move this bb under {}.",
                display_path(&profile)
            ),
            None,
        )),
        None => Err(Refusal::new(
            RefusalCode::OutsideProfile,
            "Presto could not find your user folder.".to_string(),
            None,
        )),
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn check(path: &Path) -> Result<(), Refusal> {
    Err(Refusal::new(
        RefusalCode::OutsideProfile,
        format!(
            "Presto cannot check who may modify {} on this system.",
            display_path(path)
        ),
        None,
    ))
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy)]
struct NodeMode {
    uid: u32,
    gid: u32,
    mode: u32,
}

#[cfg(unix)]
struct Viewer {
    uid: u32,
    /// The user's own group (same name, the primary gid, no listed members, nobody else's primary
    /// gid): group write through it reaches no other account, which keeps Debian's `umask 002`
    /// builds usable.
    private_gid: Option<u32>,
}

#[cfg(unix)]
impl Viewer {
    fn current() -> Self {
        let uid = unsafe { libc::geteuid() };
        Self {
            uid,
            private_gid: private_gid(uid),
        }
    }
}

#[cfg(unix)]
#[derive(Debug, PartialEq, Eq)]
enum Issue {
    ForeignOwner,
    WritableByOthers,
}

#[cfg(unix)]
fn check_mode(node: NodeMode, viewer: &Viewer, is_file: bool) -> Result<(), Issue> {
    if node.uid != viewer.uid && node.uid != 0 {
        return Err(Issue::ForeignOwner);
    }
    let group_write = node.mode & 0o020 != 0 && Some(node.gid) != viewer.private_gid;
    let world_write = node.mode & 0o002 != 0;
    // In a sticky directory only an entry's owner (the user or root, checked above) may rename it.
    let sticky = !is_file && node.mode & 0o1000 != 0;
    if (group_write || world_write) && !sticky {
        return Err(Issue::WritableByOthers);
    }
    Ok(())
}

#[cfg(unix)]
fn mode_refusal(issue: Issue, node: &Path, is_file: bool, owned: bool) -> Refusal {
    let shown = display_path(node);
    match issue {
        Issue::ForeignOwner => Refusal::new(
            RefusalCode::ForeignOwner,
            format!("{shown} belongs to another account, which could replace this bb. Move it into a folder you own."),
            None,
        ),
        Issue::WritableByOthers => {
            let what = if is_file {
                format!("Other accounts can modify {shown}.")
            } else {
                format!("Other accounts can modify {shown}, a folder above this bb.")
            };
            let fix = owned.then(|| format!("chmod go-w {}", shell_quote(node)));
            let message = if owned {
                what
            } else {
                format!("{what} Move the bb into a folder you own.")
            };
            Refusal::new(RefusalCode::WritableByOthers, message, fix)
        }
    }
}

#[cfg(unix)]
fn acl_refusal(node: &Path, owned: bool) -> Refusal {
    let clear = if cfg!(target_os = "macos") {
        "chmod -N"
    } else {
        "setfacl -b"
    };
    Refusal::new(
        RefusalCode::AclGrantsWrite,
        format!(
            "An access-control entry lets other accounts modify {}.",
            display_path(node)
        ),
        owned.then(|| format!("{clear} {}", shell_quote(node))),
    )
}

#[cfg(unix)]
fn private_gid(uid: u32) -> Option<u32> {
    use std::ffi::CStr;
    let mut buf = vec![0 as libc::c_char; 16 * 1024];
    let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
    let mut found = std::ptr::null_mut();
    let rc = unsafe { libc::getpwuid_r(uid, &mut pwd, buf.as_mut_ptr(), buf.len(), &mut found) };
    if rc != 0 || found.is_null() {
        return None;
    }
    let user = unsafe { CStr::from_ptr(pwd.pw_name) }.to_bytes().to_vec();
    let gid = pwd.pw_gid;

    // An ERANGE on a huge member list just means "not private": the stricter answer.
    let mut gbuf = vec![0 as libc::c_char; 64 * 1024];
    let mut grp: libc::group = unsafe { std::mem::zeroed() };
    let mut gfound = std::ptr::null_mut();
    let rc = unsafe { libc::getgrgid_r(gid, &mut grp, gbuf.as_mut_ptr(), gbuf.len(), &mut gfound) };
    if rc != 0 || gfound.is_null() {
        return None;
    }
    let group = unsafe { CStr::from_ptr(grp.gr_name) }.to_bytes();
    let has_members = !grp.gr_mem.is_null() && !unsafe { *grp.gr_mem }.is_null();
    let accounts = primary_groups()?;
    is_private_group(uid, gid, &user, group, has_members, &accounts).then_some(gid)
}

#[cfg(unix)]
fn is_private_group(
    uid: u32,
    gid: u32,
    user: &[u8],
    group: &[u8],
    has_members: bool,
    accounts: &[(u32, u32)],
) -> bool {
    user == group && !has_members && accounts.iter().all(|&(u, g)| u == uid || g != gid)
}

/// Every account's (uid, primary gid), or None when they cannot all be listed. Accounts an NSS
/// source declines to enumerate (sssd's default) stay unseen.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn primary_groups() -> Option<Vec<(u32, u32)>> {
    // The enumeration cursor is process-wide.
    static CURSOR: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _cursor = CURSOR.lock().unwrap_or_else(|e| e.into_inner());
    let mut buf = vec![0 as libc::c_char; 16 * 1024];
    let mut accounts = Vec::new();
    unsafe { libc::setpwent() };
    let listed = loop {
        let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
        let mut found = std::ptr::null_mut();
        match unsafe { libc::getpwent_r(&mut pwd, buf.as_mut_ptr(), buf.len(), &mut found) } {
            0 if !found.is_null() => accounts.push((pwd.pw_uid, pwd.pw_gid)),
            libc::ENOENT => break Some(accounts),
            _ => break None,
        }
    };
    unsafe { libc::endpwent() };
    listed
}

/// No reentrant enumeration here, and macOS accounts default to the shared `staff` group anyway.
#[cfg(all(unix, not(all(target_os = "linux", target_env = "gnu"))))]
fn primary_groups() -> Option<Vec<(u32, u32)>> {
    None
}

/// Linux: the POSIX access ACL, read raw from its xattr. A named user or group entry holding write
/// is refused even when the mask hides it today, since the owner of that node could widen the mask.
#[cfg(target_os = "linux")]
mod acl {
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    pub(super) fn grants_write(path: &Path) -> std::io::Result<bool> {
        let cpath = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        let mut buf = vec![0u8; 8 * 1024];
        let n = unsafe {
            libc::lgetxattr(
                cpath.as_ptr(),
                c"system.posix_acl_access".as_ptr(),
                buf.as_mut_ptr().cast(),
                buf.len(),
            )
        };
        if n < 0 {
            let e = std::io::Error::last_os_error();
            return match e.raw_os_error() {
                Some(libc::ENODATA) | Some(libc::ENOTSUP) => Ok(false),
                _ => Err(e),
            };
        }
        Ok(posix_acl_grants_write(&buf[..n as usize]))
    }

    /// The kernel's `posix_acl_xattr` layout: a little-endian u32 version (2), then 8-byte entries
    /// (u16 tag, u16 perm, u32 id). Anything else is refused rather than guessed at.
    pub(super) fn posix_acl_grants_write(xattr: &[u8]) -> bool {
        const VERSION: u32 = 2;
        const ACL_USER: u16 = 0x02;
        const ACL_GROUP: u16 = 0x08;
        const WRITE: u16 = 0x02;
        let Some((version, entries)) = xattr.split_first_chunk::<4>() else {
            return true;
        };
        let (entries, partial) = entries.as_chunks::<8>();
        if u32::from_le_bytes(*version) != VERSION || !partial.is_empty() {
            return true;
        }
        entries.iter().any(|entry| {
            let tag = u16::from_le_bytes([entry[0], entry[1]]);
            let perm = u16::from_le_bytes([entry[2], entry[3]]);
            matches!(tag, ACL_USER | ACL_GROUP) && perm & WRITE != 0
        })
    }
}

/// macOS evaluates an extended ACL before the mode bits, so an allow entry carrying any
/// write-class right defeats the mode check. Deny entries pass (the home folder ships with
/// `group:everyone deny delete`).
#[cfg(target_os = "macos")]
mod acl {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    type Acl = *mut c_void;
    type AclEntry = *mut c_void;
    type AclPermset = *mut c_void;

    // <sys/acl.h>
    const ACL_TYPE_EXTENDED: c_int = 0x0000_0100;
    const ACL_FIRST_ENTRY: c_int = 0;
    const ACL_NEXT_ENTRY: c_int = -1;
    const ACL_EXTENDED_ALLOW: c_int = 1;
    /// write data / add file, delete, append / add subdirectory, delete child, write attributes,
    /// write extended attributes, write security, change owner.
    const WRITE_CLASS: [c_int; 8] = [
        1 << 2,
        1 << 4,
        1 << 5,
        1 << 6,
        1 << 8,
        1 << 10,
        1 << 12,
        1 << 13,
    ];

    extern "C" {
        fn acl_get_file(path: *const c_char, kind: c_int) -> Acl;
        fn acl_get_entry(acl: Acl, entry_id: c_int, entry: *mut AclEntry) -> c_int;
        fn acl_get_tag_type(entry: AclEntry, tag: *mut c_int) -> c_int;
        fn acl_get_permset(entry: AclEntry, permset: *mut AclPermset) -> c_int;
        fn acl_get_perm_np(permset: AclPermset, perm: c_int) -> c_int;
        fn acl_free(obj: *mut c_void) -> c_int;
    }

    struct Owned(Acl);
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { acl_free(self.0) };
        }
    }

    /// The path is canonical, so following links (`acl_get_file`) reads the node itself.
    pub(super) fn grants_write(path: &Path) -> std::io::Result<bool> {
        let cpath = CString::new(path.as_os_str().as_bytes())?;
        let acl = unsafe { acl_get_file(cpath.as_ptr(), ACL_TYPE_EXTENDED) };
        if acl.is_null() {
            let e = std::io::Error::last_os_error();
            return match e.raw_os_error() {
                // ENOENT here means "no extended ACL": the node itself was just stat'ed.
                Some(libc::ENOENT) | Some(libc::ENOTSUP) => Ok(false),
                _ => Err(e),
            };
        }
        let acl = Owned(acl);
        let mut entry: AclEntry = std::ptr::null_mut();
        let mut which = ACL_FIRST_ENTRY;
        while unsafe { acl_get_entry(acl.0, which, &mut entry) } == 0 {
            which = ACL_NEXT_ENTRY;
            let mut tag: c_int = 0;
            if unsafe { acl_get_tag_type(entry, &mut tag) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if tag != ACL_EXTENDED_ALLOW {
                continue;
            }
            let mut perms: AclPermset = std::ptr::null_mut();
            if unsafe { acl_get_permset(entry, &mut perms) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if WRITE_CLASS
                .iter()
                .any(|&perm| unsafe { acl_get_perm_np(perms, perm) } == 1)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
mod acl {
    pub(super) fn grants_write(_path: &std::path::Path) -> std::io::Result<bool> {
        Ok(false)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const ME: u32 = 1000;
    const MINE: u32 = 1000;
    const SHARED: u32 = 50;

    fn node(uid: u32, gid: u32, mode: u32) -> NodeMode {
        NodeMode { uid, gid, mode }
    }

    #[test]
    fn mode_policy_admits_only_the_user_root_sticky_dirs_and_the_private_group() {
        let viewer = Viewer {
            uid: ME,
            private_gid: Some(MINE),
        };
        let file = |n| check_mode(n, &viewer, true);
        let dir = |n| check_mode(n, &viewer, false);
        use Issue::*;

        assert_eq!(file(node(ME, MINE, 0o755)), Ok(()));
        assert_eq!(file(node(0, 0, 0o755)), Ok(()));
        assert_eq!(file(node(1001, MINE, 0o755)), Err(ForeignOwner));
        assert_eq!(file(node(ME, MINE, 0o775)), Ok(()), "private group");
        assert_eq!(file(node(ME, SHARED, 0o775)), Err(WritableByOthers));
        assert_eq!(file(node(ME, MINE, 0o757)), Err(WritableByOthers));
        assert_eq!(
            file(node(ME, MINE, 0o1757)),
            Err(WritableByOthers),
            "sticky means nothing on a file"
        );

        assert_eq!(dir(node(0, 0, 0o1777)), Ok(()), "/tmp");
        assert_eq!(dir(node(0, 0, 0o777)), Err(WritableByOthers));
        assert_eq!(dir(node(ME, MINE, 0o775)), Ok(()));
        assert_eq!(dir(node(0, SHARED, 0o775)), Err(WritableByOthers));
        assert_eq!(dir(node(1001, 1001, 0o755)), Err(ForeignOwner));

        let no_private = Viewer {
            uid: ME,
            private_gid: None,
        };
        assert_eq!(
            check_mode(node(ME, MINE, 0o775), &no_private, true),
            Err(WritableByOthers)
        );
    }

    #[test]
    fn a_group_is_private_only_when_no_other_account_has_it_as_its_primary() {
        let alone = [(0, 0), (ME, MINE), (1001, 1001)];
        assert!(is_private_group(ME, MINE, b"me", b"me", false, &alone));
        assert!(!is_private_group(ME, MINE, b"me", b"devs", false, &alone));
        assert!(!is_private_group(ME, MINE, b"me", b"me", true, &alone));
        let shared = [(ME, MINE), (1001, MINE)];
        assert!(!is_private_group(ME, MINE, b"me", b"me", false, &shared));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn posix_acl_named_write_entries_are_refused_and_garbage_fails_closed() {
        fn acl(entries: &[(u16, u16, u32)]) -> Vec<u8> {
            let mut out = 2u32.to_le_bytes().to_vec();
            for (tag, perm, id) in entries {
                out.extend_from_slice(&tag.to_le_bytes());
                out.extend_from_slice(&perm.to_le_bytes());
                out.extend_from_slice(&id.to_le_bytes());
            }
            out
        }
        let base = [
            (0x01, 7, u32::MAX),
            (0x04, 5, u32::MAX),
            (0x20, 5, u32::MAX),
        ];
        assert!(!acl::posix_acl_grants_write(&acl(&base)));
        let named_user_write = [
            (0x01, 7, u32::MAX),
            (0x02, 2, 65534),
            (0x04, 5, u32::MAX),
            (0x10, 5, u32::MAX),
            (0x20, 5, u32::MAX),
        ];
        assert!(acl::posix_acl_grants_write(&acl(&named_user_write)));
        let named_group_read = [(0x01, 7, u32::MAX), (0x08, 4, 50), (0x10, 4, u32::MAX)];
        assert!(!acl::posix_acl_grants_write(&acl(&named_group_read)));
        assert!(acl::posix_acl_grants_write(&[1, 0, 0, 0]));
        assert!(acl::posix_acl_grants_write(&acl(&base)[..9]));
    }
}
