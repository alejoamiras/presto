# server-1: owner asks

## 1. Should PRIVACY.md promise that error bodies carry no local path?

- **Surface**: `PRIVACY.md`, the paragraph that begins "Presto never logs the witness itself"
  (line 39). Arc 1 does not edit this file.
- **Options**:
  - A: add one sentence: "An error a site receives names what failed, never a path on your
    computer; the detail stays in the log." Users then read a promise that the tests enforce.
  - B: leave PRIVACY.md as it is. Nothing in it becomes false after arc 1.
- **Recommendation**: A. The page already says what error bodies never carry (the witness), and the
  same tests now enforce the path rule.
- **What ships now**: B. Arc 1 does not touch PRIVACY.md.
