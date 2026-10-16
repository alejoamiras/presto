use super::*;

fn label(raw: &str) -> AztecVersion {
    check_label(raw).unwrap()
}

#[test]
fn labels_must_pass_the_request_gate_and_presto_noir() {
    assert_eq!(label("6.0.0-dev.1").as_str(), "6.0.0-dev.1");
    assert!(check_label("6.0.0").is_ok());
    assert_eq!(
        check_label("6.0.0-alice-perf.1"),
        Err(LabelError::NotNoirCompatible)
    );
    assert_eq!(
        check_label("6.0.0+build.1"),
        Err(LabelError::Version(VersionRejection::HasBuildMetadata))
    );
    assert_eq!(
        check_label("latest"),
        Err(LabelError::Version(VersionRejection::NotSemver))
    );
    assert_eq!(
        check_label("06.0.0"),
        Err(LabelError::Version(VersionRejection::NotSemver))
    );
    assert_eq!(
        label_against("6.0.0-rc.6", &["6.0.0-rc.6"]),
        Err(LabelError::Version(VersionRejection::KnownVulnerable))
    );
}

#[derive(Debug, serde::Deserialize)]
struct Holder {
    #[serde(default, deserialize_with = "de_custom_bb")]
    custom_bb: Option<CustomBbPin>,
    #[serde(default)]
    approved: Vec<String>,
}

fn sample_pin() -> CustomBbPin {
    CustomBbPin {
        path: std::env::temp_dir().join("bb"),
        sha256: "ab".repeat(32),
        label: label("6.0.0-dev.1"),
        pinned_at: 1_760_000_000,
    }
}

#[test]
fn a_pin_round_trips_and_a_malformed_one_loads_as_none_beside_intact_neighbours() {
    let pin = sample_pin();
    let load = |record: serde_json::Value| -> Holder {
        serde_json::from_value(serde_json::json!({"custom_bb": record, "approved": ["kept"]}))
            .unwrap()
    };
    let stored = serde_json::to_value(&pin).unwrap();
    assert_eq!(stored["label"], "6.0.0-dev.1");
    assert_eq!(load(stored.clone()).custom_bb, Some(pin));

    let with = |key: &str, value: serde_json::Value| {
        let mut record = stored.clone();
        record[key] = value;
        record
    };
    let malformed = [
        with("sha256", serde_json::json!(5)),
        with("sha256", serde_json::json!("AB".repeat(32))),
        with("path", serde_json::json!("relative/bb")),
        with("label", serde_json::json!("6.0.0-alice-perf.1")),
        with("pinned_at", serde_json::json!("yesterday")),
        serde_json::json!("not an object"),
        serde_json::Value::Null,
    ];
    for record in malformed {
        let held = load(record.clone());
        assert_eq!(held.custom_bb, None, "{record}");
        assert_eq!(held.approved, ["kept"]);
    }
    let absent: Holder = serde_json::from_str(r#"{"approved": ["kept"]}"#).unwrap();
    assert_eq!(absent.custom_bb, None);
}

#[test]
fn suggestions_come_only_from_tokens_that_pass_the_label_gate() {
    let suggest = |out: &str| suggest_label(out).map(|v| v.as_str().to_string());
    assert_eq!(suggest("6.0.0-rc.6\n").as_deref(), Some("6.0.0-rc.6"));
    assert_eq!(suggest("bb v6.0.0 (abc123)").as_deref(), Some("6.0.0"));
    assert_eq!(suggest("00000000.00000000.00000000-d00d"), None);
    assert_eq!(suggest("barretenberg local build"), None);
    assert_eq!(excerpt("  a\u{1b}[31mb\n"), "a\u{FFFD}[31mb");
}

#[cfg(unix)]
mod unix {
    use super::*;
    use serial_test::serial;
    use std::os::unix::fs::PermissionsExt;

    struct Fixture {
        _dir: tempfile::TempDir,
        root: PathBuf,
        bb: PathBuf,
        pin: CustomBbPin,
    }

    fn chmod(path: &Path, mode: u32) {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    fn fixture(script: &str) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let bb = root.join("bb");
        std::fs::write(&bb, format!("#!/bin/sh\n{script}\n")).unwrap();
        chmod(&bb, 0o755);
        let pin = CustomBbPin {
            sha256: versions::sha256_file(&bb).unwrap(),
            path: bb.clone(),
            label: label("6.0.0-dev.1"),
            pinned_at: 0,
        };
        Fixture {
            _dir: dir,
            root,
            bb,
            pin,
        }
    }

    fn refusal_code(result: Result<PathBuf, Unavailable>) -> RefusalCode {
        match result {
            Err(Unavailable::Unsafe(refusal)) => refusal.code,
            other => panic!("expected a policy refusal, got {other:?}"),
        }
    }

    #[test]
    fn spawn_check_refuses_anything_but_the_pinned_bytes_at_the_pinned_canonical_path() {
        let f = fixture("echo 6.0.0-dev.1");
        assert_eq!(verify_for_spawn(&f.pin), Ok(f.bb.clone()));

        std::fs::write(&f.bb, "#!/bin/sh\necho swapped\n").unwrap();
        assert_eq!(verify_for_spawn(&f.pin), Err(Unavailable::Changed));

        let f = fixture("echo 1");
        let real = f.root.join("bb.real");
        std::fs::rename(&f.bb, &real).unwrap();
        std::os::unix::fs::symlink(&real, &f.bb).unwrap();
        assert_eq!(
            verify_for_spawn(&f.pin),
            Err(Unavailable::Changed),
            "final symlink"
        );

        let f = fixture("echo 1");
        let alias = f.root.join("alias");
        std::os::unix::fs::symlink(&f.root, &alias).unwrap();
        let through_alias = CustomBbPin {
            path: alias.join("bb"),
            ..f.pin.clone()
        };
        assert_eq!(
            verify_for_spawn(&through_alias),
            Err(Unavailable::Changed),
            "symlinked ancestor"
        );

        std::fs::remove_file(&f.bb).unwrap();
        assert_eq!(verify_for_spawn(&f.pin), Err(Unavailable::Missing));
        std::fs::create_dir(&f.bb).unwrap();
        assert_eq!(
            verify_for_spawn(&f.pin),
            Err(Unavailable::Changed),
            "not a file"
        );
    }

    #[test]
    fn spawn_check_refuses_a_file_or_folder_other_accounts_can_write() {
        let f = fixture("echo 1");
        chmod(&f.bb, 0o757);
        assert_eq!(
            refusal_code(verify_for_spawn(&f.pin)),
            RefusalCode::WritableByOthers
        );

        let f = fixture("echo 1");
        chmod(&f.root, 0o777);
        let refused = verify_for_spawn(&f.pin);
        chmod(&f.root, 0o1777);
        assert_eq!(refusal_code(refused), RefusalCode::WritableByOthers);
        assert_eq!(verify_for_spawn(&f.pin), Ok(f.bb.clone()), "sticky");
        chmod(&f.root, 0o700);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn spawn_check_refuses_a_posix_acl_granting_a_named_user_write() {
        let f = fixture("echo 1");
        // A named entry with write, masked to r-x so the mode bits alone would pass.
        let mut xattr = 2u32.to_le_bytes().to_vec();
        for (tag, perm, id) in [
            (0x01u16, 7u16, u32::MAX),
            (0x02, 2, 65534),
            (0x04, 5, u32::MAX),
            (0x10, 5, u32::MAX),
            (0x20, 0, u32::MAX),
        ] {
            xattr.extend_from_slice(&tag.to_le_bytes());
            xattr.extend_from_slice(&perm.to_le_bytes());
            xattr.extend_from_slice(&id.to_le_bytes());
        }
        let cpath = std::ffi::CString::new(f.root.to_str().unwrap()).unwrap();
        let set = unsafe {
            libc::lsetxattr(
                cpath.as_ptr(),
                c"system.posix_acl_access".as_ptr(),
                xattr.as_ptr().cast(),
                xattr.len(),
                0,
            )
        };
        if set != 0 {
            eprintln!(
                "skipped: this file system takes no POSIX ACL ({})",
                std::io::Error::last_os_error()
            );
            return;
        }
        assert_eq!(
            refusal_code(verify_for_spawn(&f.pin)),
            RefusalCode::AclGrantsWrite
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn spawn_check_refuses_an_allow_write_ace_and_accepts_a_deny_only_one() {
        let chmod_acl = |args: &[&str], path: &Path| {
            let status = std::process::Command::new("/bin/chmod")
                .args(args)
                .arg(path)
                .status()
                .unwrap();
            assert!(status.success(), "chmod {args:?}");
        };
        let f = fixture("echo 1");
        chmod_acl(&["+a", "everyone allow write"], &f.bb);
        assert_eq!(
            refusal_code(verify_for_spawn(&f.pin)),
            RefusalCode::AclGrantsWrite
        );
        chmod_acl(&["-N"], &f.bb);
        chmod_acl(&["+a", "everyone deny delete"], &f.bb);
        assert_eq!(verify_for_spawn(&f.pin), Ok(f.bb.clone()));
        chmod_acl(&["+a", "everyone allow add_file"], &f.root);
        assert_eq!(
            refusal_code(verify_for_spawn(&f.pin)),
            RefusalCode::AclGrantsWrite,
            "ancestor"
        );
    }

    fn inspect_code(path: &Path) -> RefusalCode {
        match inspect(path) {
            Err(refusal) => refusal.code,
            Ok(found) => panic!("expected a refusal, inspected {found:?}"),
        }
    }

    /// A real native program for this host, copied where the test controls its mode.
    fn copied_system_binary() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let copy = dir.path().canonicalize().unwrap().join("bb");
        std::fs::copy("/bin/ls", &copy).unwrap();
        chmod(&copy, 0o755);
        (dir, copy)
    }

    #[test]
    fn inspection_pins_a_native_program_and_refuses_what_could_not_run_as_bb() {
        let (_dir, bb) = copied_system_binary();
        let found = inspect(&bb).unwrap();
        assert_eq!(found.path, bb);
        assert_eq!(found.sha256, versions::sha256_file(&bb).unwrap());
        assert!(
            inspect(Path::new("/bin/ls")).is_ok(),
            "root-owned system path"
        );

        chmod(&bb, 0o644);
        assert_eq!(inspect_code(&bb), RefusalCode::NotExecutable);

        let script = fixture("echo 6.0.0-dev.1");
        assert_eq!(inspect_code(&script.bb), RefusalCode::WrongFormat);
        assert_eq!(inspect_code(&script.root), RefusalCode::NotRegularFile);

        let foreign = script.root.join("foreign");
        std::fs::write(&foreign, foreign_header()).unwrap();
        chmod(&foreign, 0o755);
        assert_eq!(inspect_code(&foreign), RefusalCode::WrongArchitecture);
    }

    /// A header naming this host's format but the other common architecture.
    fn foreign_header() -> Vec<u8> {
        let other_is_arm = cfg!(target_arch = "x86_64");
        if cfg!(target_os = "macos") {
            let cpu: u32 = if other_is_arm {
                0x0100_000C
            } else {
                0x0100_0007
            };
            let mut h = 0xFEED_FACFu32.to_le_bytes().to_vec();
            h.extend_from_slice(&cpu.to_le_bytes());
            h.resize(64, 0);
            h
        } else {
            let machine: u16 = if other_is_arm { 183 } else { 62 };
            let mut h = vec![0u8; 64];
            h[..4].copy_from_slice(b"\x7FELF");
            h[4] = 2;
            h[5] = 1;
            h[18..20].copy_from_slice(&machine.to_le_bytes());
            h
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn inspection_refuses_a_quarantined_or_unsigned_file() {
        let (_dir, bb) = copied_system_binary();
        let status = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.apple.quarantine", "0081;00000000;Test;"])
            .arg(&bb)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(inspect_code(&bb), RefusalCode::Quarantined);

        #[cfg(target_arch = "aarch64")]
        {
            let (_dir, bb) = copied_system_binary();
            let status = std::process::Command::new("/usr/bin/codesign")
                .arg("--remove-signature")
                .arg(&bb)
                .status()
                .unwrap();
            assert!(status.success());
            assert_eq!(inspect_code(&bb), RefusalCode::Unsigned);
        }
    }

    async fn run(f: &Fixture, timeout: Duration) -> Result<TestRun, TestRunError> {
        let permit = take_test_permit(&Arc::new(Semaphore::new(1))).unwrap();
        test_run_within(&f.bb, &f.pin.sha256, permit, || true, timeout).await
    }

    #[tokio::test]
    #[serial]
    async fn a_test_run_reports_the_version_it_printed_or_why_it_could_not() {
        let _home = crate::ScopedPrestoHome::new();
        let printed = run(&fixture("echo 6.0.0-dev.1"), TEST_RUN_TIMEOUT)
            .await
            .unwrap();
        assert_eq!(
            printed.version_suggestion.map(|v| v.as_str().to_string()),
            Some("6.0.0-dev.1".to_string())
        );
        assert_eq!(printed.excerpt, "6.0.0-dev.1");

        let garbage = run(
            &fixture("echo local build; echo noise >&2"),
            TEST_RUN_TIMEOUT,
        )
        .await
        .unwrap();
        assert_eq!(garbage.version_suggestion, None);
        assert_eq!(garbage.excerpt, "local build");

        let failed = run(&fixture("exit 3"), TEST_RUN_TIMEOUT).await;
        assert!(matches!(failed, Err(TestRunError::Failed(_))), "{failed:?}");

        let flood = run(
            &fixture("yes 6.0.0-dev.1 | head -c 100000"),
            TEST_RUN_TIMEOUT,
        )
        .await
        .unwrap();
        assert!(flood.excerpt.chars().count() <= EXCERPT_CHARS);
    }

    #[tokio::test]
    #[serial]
    async fn a_hung_test_run_is_killed_and_reaped_at_the_limit() {
        let _home = crate::ScopedPrestoHome::new();
        let pidfile = tempfile::tempdir().unwrap();
        let pidfile = pidfile.path().join("pid");
        let f = fixture(&format!("echo $$ > '{}'; exec sleep 30", pidfile.display()));
        let started = std::time::Instant::now();
        let result = run(&f, Duration::from_millis(500)).await;
        assert!(matches!(result, Err(TestRunError::TimedOut)), "{result:?}");
        assert!(started.elapsed() < Duration::from_secs(5));
        let pid: i32 = std::fs::read_to_string(&pidfile)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let gone = unsafe { libc::kill(pid, 0) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
        assert!(gone, "the killed run was reaped");
    }

    #[tokio::test]
    #[serial]
    async fn a_test_run_refuses_changed_bytes_a_withdrawn_candidate_and_a_busy_prover_without_running_anything(
    ) {
        let _home = crate::ScopedPrestoHome::new();
        let marker = tempfile::tempdir().unwrap();
        let marker = marker.path().join("ran");
        let f = fixture(&format!("touch '{}'", marker.display()));
        let reviewed = f.pin.sha256.clone();
        let permit = take_test_permit(&Arc::new(Semaphore::new(1))).unwrap();
        let withdrawn = test_run_within(&f.bb, &reviewed, permit, || false, TEST_RUN_TIMEOUT).await;
        assert!(
            matches!(
                withdrawn,
                Err(TestRunError::Unavailable(Unavailable::Withdrawn))
            ),
            "{withdrawn:?}"
        );
        assert!(
            !marker.exists(),
            "an intact file not admitted after the rehash never ran"
        );

        std::fs::write(
            &f.bb,
            format!("#!/bin/sh\ntouch '{}'\n# rebuilt\n", marker.display()),
        )
        .unwrap();
        let permit = take_test_permit(&Arc::new(Semaphore::new(1))).unwrap();
        let changed = test_run_within(&f.bb, &reviewed, permit, || true, TEST_RUN_TIMEOUT).await;
        assert!(
            matches!(
                changed,
                Err(TestRunError::Unavailable(Unavailable::Changed))
            ),
            "{changed:?}"
        );
        assert!(!marker.exists(), "the changed file never ran");

        let prove = Arc::new(Semaphore::new(1));
        let proof = take_test_permit(&prove).unwrap();
        assert!(matches!(take_test_permit(&prove), Err(TestRunError::Busy)));
        drop(proof);
    }

    #[tokio::test]
    #[serial]
    async fn a_test_run_holds_the_prove_permit_until_bb_has_finished() {
        let _home = crate::ScopedPrestoHome::new();
        let f = fixture(
            "touch \"$0.started\"\ni=0\n\
             while [ ! -e \"$0.release\" ] && [ $i -lt 60 ]; do sleep 0.05; i=$((i+1)); done\n\
             echo 6.0.0-dev.1",
        );
        let (started, release) = (f.root.join("bb.started"), f.root.join("bb.release"));
        let prove = Arc::new(Semaphore::new(1));
        let permit = take_test_permit(&prove).unwrap();
        let (bb, sha256) = (f.bb.clone(), f.pin.sha256.clone());
        let run = tokio::spawn(async move { test_run(&bb, &sha256, permit, || true).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            while !started.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("bb started");
        assert!(matches!(take_test_permit(&prove), Err(TestRunError::Busy)));
        std::fs::write(&release, "").unwrap();
        run.await.unwrap().unwrap();
        assert_eq!(prove.available_permits(), 1, "the permit comes back");
    }

    #[test]
    #[serial]
    fn the_env_override_counts_only_when_it_names_an_existing_path() {
        let f = fixture("echo 1");
        std::env::set_var("BB_BINARY_PATH", &f.bb);
        let set = env_override_active();
        std::env::set_var("BB_BINARY_PATH", f.root.join("missing"));
        let dangling = env_override_active();
        std::env::remove_var("BB_BINARY_PATH");
        assert!(set);
        assert!(!dangling);
        assert!(!env_override_active());
    }
}
