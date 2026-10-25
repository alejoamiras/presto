# Phase 2: every `prove_failed` body is fixed text

- The official-route test fails against forwarding: with `bb_failure` temporarily returning the error's text on the
  official route, `an_official_route_workspace_failure_keeps_its_path_off_the_wire` failed on `/prove` with
  `{"error":"prove_failed","message":"No such file or directory (os error 2) at path \"<tmp>/no-tmp/prove-…\""}`;
  restored, it passes. The custom-route twin still passes, and its Settings detail still names `no-tmp`.
