//! GUI-agnostic core of the Presto: the HTTP proving server, bb binary cache, Aztec
//! version resolution, and origin authorization — everything the headless `presto-server`
//! needs, with zero Tauri / GUI / TLS-serving coupling. Both the desktop crate (`presto`)
//! and the headless `presto-server` depend on this.
//!
//! Intentionally `build.rs`-free: the `AZTEC_VERSION` read, `verified-sites.json` check, and
//! `tauri_build::build()` all stay in src-tauri/build.rs; the bb-version is injected via
//! `server::HeadlessState.bundled_version`. See implementations-plan/core-extraction-2026-06-07.

pub mod authorization;
pub mod bb;
pub mod config;
pub mod server;
pub mod update_manifest;
pub mod updater_state;
pub mod versions;
/// F-003 Windows tail — owner-only ACL helpers (Windows-only; the module is `#![cfg(windows)]`).
#[cfg(windows)]
pub mod win_acl;

use std::path::PathBuf;

// Windows installs into LocalAppData/Presto; case alone cannot separate retained runtime data.
const DATA_DIR_NAME: &str = if cfg!(windows) {
    "build.presto.presto"
} else {
    "presto"
};

/// `PRESTO_HOME`: one directory that roots every piece of Presto's mutable state — config, the bb
/// version cache, prove workspaces, logs. Unset (every real install) keeps the per-platform defaults.
/// Exists so a second instance (a test harness on another port) can run with private state: cache
/// eviction and workspace reaping assume the process that won the port is the only one touching them.
pub fn presto_home() -> Option<PathBuf> {
    std::env::var_os("PRESTO_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// `PRESTO_HOME` only when it really is a private directory: an override that resolves to the
/// default `~/.presto` (by name or through a symlink) would share the version cache with the
/// desktop app while running its own eviction sweeps, so it does not count as isolation.
pub fn isolated_presto_home() -> Option<PathBuf> {
    let home = presto_home()?;
    let default = dirs::home_dir()?.join(".presto");
    (!same_directory(&home, &default)).then_some(home)
}

fn same_directory(a: &std::path::Path, b: &std::path::Path) -> bool {
    let resolve = |p: &std::path::Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    resolve(a) == resolve(b)
}

pub(crate) fn runtime_data_dir() -> Option<PathBuf> {
    if let Some(home) = presto_home() {
        return Some(home.join("data"));
    }
    dirs::data_local_dir().map(|base| base.join(DATA_DIR_NAME))
}

/// Returns the log directory.
///
/// - macOS: `~/Library/Application Support/presto/logs/`
/// - Linux: `~/.local/share/presto/logs/`
/// - Windows: `%LOCALAPPDATA%/build.presto.presto/logs/`
pub fn log_dir() -> PathBuf {
    runtime_data_dir()
        .unwrap_or_else(|| PathBuf::from(DATA_DIR_NAME))
        .join("logs")
}

#[cfg(test)]
mod presto_home_tests {
    use serial_test::serial;

    #[test]
    #[serial]
    fn presto_home_roots_config_cache_and_runtime_data_and_nothing_else_when_unset() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PRESTO_HOME", dir.path());
        let under = |p: std::path::PathBuf| p.starts_with(dir.path());
        assert!(under(super::runtime_data_dir().unwrap()));
        assert!(under(super::config::config_path()));
        assert!(under(super::versions::versions_base_dir().unwrap()));
        assert_eq!(super::runtime_data_dir().unwrap(), dir.path().join("data"));
        assert_eq!(super::config::config_path(), dir.path().join("config.json"));
        assert_eq!(
            super::versions::versions_base_dir().unwrap(),
            dir.path().join("versions")
        );

        std::env::set_var("PRESTO_HOME", "");
        assert!(super::presto_home().is_none(), "empty is unset");
        std::env::remove_var("PRESTO_HOME");
        assert!(!under(super::runtime_data_dir().unwrap()));
        assert!(!under(super::config::config_path()));
    }

    #[test]
    fn the_default_state_directory_is_not_an_isolated_home_even_through_a_symlink() {
        let root = tempfile::tempdir().unwrap();
        let default = root.path().join(".presto");
        std::fs::create_dir(&default).unwrap();
        assert!(super::same_directory(
            &default,
            &root.path().join(".presto")
        ));
        assert!(!super::same_directory(&default, &root.path().join("other")));
        assert!(
            !super::same_directory(
                &root.path().join("missing-a"),
                &root.path().join("missing-b")
            ),
            "unresolvable paths compare by name"
        );
        #[cfg(unix)]
        {
            let alias = root.path().join("alias");
            std::os::unix::fs::symlink(&default, &alias).unwrap();
            assert!(super::same_directory(&alias, &default));
        }
    }
}

#[cfg(all(test, windows))]
mod data_path_tests {
    #[test]
    fn runtime_data_is_outside_the_default_install_directory() {
        let local = dirs::data_local_dir().unwrap();
        let install = local.join("Presto").to_string_lossy().to_lowercase();
        let logs = super::log_dir().to_string_lossy().to_lowercase();
        assert!(!logs.starts_with(&format!("{install}\\")));
        assert_eq!(
            super::log_dir(),
            local.join("build.presto.presto").join("logs")
        );
        assert_eq!(
            super::runtime_data_dir().unwrap(),
            local.join("build.presto.presto")
        );
    }
}
