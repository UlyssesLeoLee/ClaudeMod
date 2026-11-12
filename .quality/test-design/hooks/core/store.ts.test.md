# Test Design: `hooks/core/store.ts`

Source: `hooks/core/store.ts`

Source-SHA256: `0a737e41293ac7953a69243259f34624039001ed59e397d409901de58b9ae75c`

## Test Strategy

Integration tests with `mock.store(on, entries)` seeding stored values and a faked `session.cwd`; the doc and overview panes are mounted and their restored results read from the rendered text.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Store holds `docLinks:c:/proj` (2 links); session folder `C:/proj/docs/architecture` | Doc pane shows the 2 links' counts without any `process.run` | tests/store.test.tsx#a result saved for the project is found from a subfolder |
| TC-002 | Store holds `docLinks:c:/proj` at t=1 and `docLinks:c:/proj/docs` at t=2; session folder `C:/proj/docs` | The t=2 result is shown | tests/store.test.tsx#the latest result among the folders above wins |
| TC-003 | 智能关联 from session folder `C:/proj/docs` in repository `C:/proj` | Result written to `docLinks:c:/proj` only | tests/store.test.tsx#a new result is kept under the project's root |
| TC-004 | Store holds `overview:c:/proj`; session folder `C:/proj/src` | Overview pane shows it without running anything | tests/store.test.tsx#an overview saved for the project is found from a subfolder |

## Boundary & Failure Cases

- A stored value of another shape is skipped by `restore`, and an older valid one is used (TC-002 fixture adds a malformed newer entry).
- Nothing stored anywhere above: the pane shows its empty state (tests/doc-links.test.tsx "nothing is scanned, run or asked until 智能关联 is pressed").

## Regression Scope

Doc links restore (tests/doc-links.test.tsx "a project’s links come back in a later session, without running anything") and overview restore (tests/overview.test.tsx "an overview comes back in a later session without running anything").
