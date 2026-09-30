//! Cross-process exclusive advisory locks on a sibling lock file. `flock` / `LockFileEx` are tied to
//! the open handle, so the OS releases the lock if the holder dies and a crash never strands it.
//! Independent opens conflict even within one process; duplicated descriptors would not.

use std::fs::File;
use std::path::Path;

fn open_lock_file(lock_path: &Path) -> std::io::Result<File> {
    std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(lock_path)
}

/// Blocks until this process holds `lock_path` exclusively; the lock lasts as long as the returned
/// handle. Hold it only for brief work with no OS dialogs inside, so a UI thread cannot deadlock.
pub(crate) fn lock_exclusive(lock_path: &Path) -> std::io::Result<File> {
    let file = open_lock_file(lock_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        // flock(LOCK_EX): blocks until no other open-file-description holds the lock; released on close/exit.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
        use windows_sys::Win32::System::IO::OVERLAPPED;
        // LockFileEx (no LOCKFILE_FAIL_IMMEDIATELY) blocks for an exclusive byte-range lock over the whole
        // file; released on CloseHandle (guard drop) / process exit. OVERLAPPED is zeroed (offset 0).
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            LockFileEx(
                file.as_raw_handle() as _,
                LOCKFILE_EXCLUSIVE_LOCK,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(file)
}

/// Test-only non-blocking acquire, so a test can prove exclusivity without timing: `Ok(None)` means
/// another handle holds the lock.
#[cfg(test)]
pub(crate) fn try_lock_exclusive(lock_path: &Path) -> std::io::Result<Option<File>> {
    let file = open_lock_file(lock_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let e = std::io::Error::last_os_error();
            if e.kind() == std::io::ErrorKind::WouldBlock {
                return Ok(None);
            }
            return Err(e);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
        };
        use windows_sys::Win32::System::IO::OVERLAPPED;
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            LockFileEx(
                file.as_raw_handle() as _,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        };
        if ok == 0 {
            return Ok(None); // held elsewhere → would block
        }
    }
    Ok(Some(file))
}
