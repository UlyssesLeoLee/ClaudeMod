# Test Design: `hooks/core/build.tsx`

Source: `hooks/core/build.tsx`

Source-SHA256: `74ef4e1f467f8048676892572f358a2ebfdcab94ce5c9fd5820552f4a08b8a59`

## Test Strategy

Integration tests with the `claude-code/testing` kit: `fs.read` returns a fake manifest, `fs.list` a fake `hooks/` tree with subfolders and chosen `mtimeMs`, and a settable `clock.now` moves time. Each pane is mounted and its footer read with `ui.findAll`; the fake counts listings to check the once-a-minute limit.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Manifest `{"version":"9.9.9"}`; newest file in `hooks/core/` at 17:43 | Each of `branch-status`, `doc-links`, `task-overview` panes shows `dev-cockpit 9.9.9 · 代码 2026-11-12 17:43` | tests/build.test.tsx#every pane ends with the version and code time the session loaded |
| TC-002 | After start, a file under `hooks/doclinks/` gets a newer mtime (18:05); clock advanced past 60 s; pane redrawn | Yellow line `⚠ mod 代码已在 2026-11-12 18:05 更新，本会话仍在用旧代码：重开会话后生效` | tests/build.test.tsx#newer code on disk is reported in every pane |
| TC-003 | Newer file appears, clock advanced less than 60 s | No stale line yet; `fs.list` not called again | tests/build.test.tsx#the newer-code check lists files at most once a minute |
| TC-004 | No newer file | No stale line | tests/build.test.tsx#every pane ends with the version and code time the session loaded |

## Boundary & Failure Cases

- Manifest unreadable or not JSON: line reads `dev-cockpit ? · 代码 …` (tests/build.test.tsx "an unreadable manifest or folder still gives a footer").
- `hooks/` unlistable: line reads `代码 未知`, no stale line (same test).
- Files whose extension is not code (`.md`) never count as newer code (TC-002 fixture holds a newer `.md`).

## Regression Scope

Every pane's render calls `buildFooter`; a throw here would blank all three panes, so each pane test file mounting a pane covers it.
