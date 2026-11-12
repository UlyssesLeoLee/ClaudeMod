# Test Design: `hooks/overview/pane.tsx`

Source: `hooks/overview/pane.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Integration tests in tests/overview.test.tsx and tests/store.test.tsx: fake `docs/WBS.md` via `fs.list` / `fs.read`, fake git, fake model JSON, `mock.clock`, `mock.store`, faked `prompt.submit`.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Pane mounted, nothing pressed | No read, process or model | tests/overview.test.tsx "nothing is read, run or asked before 生成概要 is pressed" |
| TC-002 | WBS with 工数 on every leaf, one 已取消, one overdue | Weighted %, 已取消 left out, overdue first in red | tests/overview.test.tsx "completion counts leaves by 工数, leaves out 已取消, and lists open tasks overdue first" |
| TC-003 | Model summary of 200 characters | Cut to 140 | tests/overview.test.tsx "a summary longer than 140 characters is cut, whatever the model says" |
| TC-004 | Model fails | Summary from the numbers, within 140, warning shown | tests/overview.test.tsx "without the model, the summary comes from the numbers, within 140, and says so" |
| TC-005 | Mismatches naming unknown tasks or kinds | Only known ones shown | tests/overview.test.tsx "only mismatches naming a task of the WBS, of a known kind, are shown" |
| TC-006 | No WBS; 新建 → 确认 | Looks again; submits only the fixed prompt | tests/overview.test.tsx "without a WBS, 新建 asks first, looks again, and sends only the fixed prompt" |
| TC-007 | Stored overview, new session | Shown without running anything | tests/overview.test.tsx "an overview comes back in a later session without running anything" |
| TC-008 | Stored under the project root, session folder `C:/proj/src` | Shown | tests/store.test.tsx "an overview saved for the project is found from a subfolder" |

## Boundary & Failure Cases

- A failing run keeps the last good overview and says why (tests/overview.test.tsx "a run that fails keeps the last good overview and says why").
- WBS without a 任务 column: error names what the table needs.

## Regression Scope

WBS parsing (overview/wbs), store helpers (core/store), band button (hooks/main.tsx).
