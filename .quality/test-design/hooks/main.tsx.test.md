# Test Design: `hooks/main.tsx`

Source: `hooks/main.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Integration tests through the `claude-code/testing` kit (`claude plugin test`): `$.session.start`, `$.ui.mount` of the `AbovePrompt` band, presses on its buttons, with faked engine calls (`process.run`, `fs.*`, `store`, `ui.open`, `command.register`). No real git, model or file system is touched.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | `session.start` with faked `command.register` / `ui.open` | `/branch-status`, `/doc-links`, `/task-overview` registered; 分支变更 pane opened; no `process.run`, no `model.complete` | tests/branches.test.tsx "no git runs until 加载Git is pressed"; tests/doc-links.test.tsx "nothing is scanned, run or asked until 智能关联 is pressed"; tests/overview.test.tsx "nothing is read, run or asked before 生成概要 is pressed" |
| TC-002 | Band mounted, no query yet | Buttons 📋 任务概要, 📚 关联文档, 🌿 分支记录 | tests/main.test.tsx "the band holds one button per feature, each opening its pane" |
| TC-003 | Press each band button | `ui.open` with `task-overview`, `doc-links`, `branch-status` | tests/main.test.tsx "the band holds one button per feature, each opening its pane" |
| TC-004 | Query whose branches hold AI commits of the last 5 days | Band button reads 🚨 分支记录 · 近5天 AI×N | tests/branches.test.tsx "outer alarm counts AI of the last 5 days; inner rows show every AI commit" |
| TC-005 | Session start, then each pane mounted | Every pane ends with `claude-mod <version> · 代码 <time>` | tests/build.test.tsx "every pane ends with the version and code time the session loaded" |

## Boundary & Failure Cases

- Band with `hasSurvey: true`: the mod yields (`next(e)`), drawing nothing of its own (TC-002 file, case "a survey above the prompt takes the band").
- Only an AI commit older than 5 days: band shows 🌿 分支记录 without a count (tests/branches.test.tsx "only an old AI commit raises no outer alarm").

## Regression Scope

All three features start from this module: a missing start call leaves a pane's busy flags or commands unset. The branch, doc and overview test files each start a session through it, so their whole suites are the regression net.
