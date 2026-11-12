# Test Design: `hooks/doclinks/pane.tsx`

Source: `hooks/doclinks/pane.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Integration tests in tests/doc-links.test.tsx, tests/review-sync.test.tsx and tests/store.test.tsx: a fake file tree (`fs.list` / `fs.read` / `fs.exists`), a fake model answering JSON, a fake Python, `mock.store`, faked `session.messages`, `prompt.submit`, `prompt.fill`, `turn.*` events. Assertions on pane text, model prompts, recorded processes and store writes.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Pane mounted, nothing pressed | No scan, no process, no model | tests/doc-links.test.tsx "nothing is scanned, run or asked until 智能关联 is pressed" |
| TC-002 | Session record with earlier requests | Task from the person's words only | tests/doc-links.test.tsx "the task comes from the session record, earlier history included: the person’s words only" |
| TC-003 | 智能关联 | Every candidate reaches the model; picks grouped; invented ids dropped | tests/doc-links.test.tsx "every classified doc reaches the model; its picks are grouped, invented ids dropped" |
| TC-004 | Fresh result | Each kind shows `label（n）`; no document path drawn until ▶ pressed | tests/doc-links.test.tsx "a fresh result starts folded: each kind shows its count, its rows open on a press" |
| TC-005 | Model leaves out UT and IT; scan holds `04_unit-test/UT-…md`, `05_integration-test/IT-…md` in an extra folder | Both linked under UT / IT with 按类型补充 reason | tests/doc-links.test.tsx "every kind found gets a link: what the model left out is filled in by kind" |
| TC-006 | Folder beside the project named like it | Scanned in the first pass; offered with ➕ 固定加入 | tests/doc-links.test.tsx "a folder beside the project is scanned in the first pass, before anyone adds it" |
| TC-007 | Real layout: project `D:/OA-Partner`, extra folder `D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL/docs` with `04_unit-test`, `05_integration-test`, `06_system-test`; session folder `D:/OA-Partner/docs/architecture`; model picks none of them | UT, IT and ST rows each hold the V40 document; result stored under `docLinks:d:/oa-partner` | tests/store.test.tsx "a session inside a subfolder links the project's test designs from its extra folder" |
| TC-008 | Link, then the file changes | Shows 关联后已修改; ✔ 接受修改 resets | tests/doc-links.test.tsx "a doc changed after linking shows as changed until the change is accepted" |
| TC-009 | 📝 更新 → 确认 | Fixed prompt with ticked paths only, as the person's words | tests/doc-links.test.tsx "更新 asks first, then hands Claude only the ticked paths, never model text" |
| TC-010 | Review, then code edit, turn ends | Docs linked and update handed to Claude; unchanged docs get 手动更新 | tests/review-sync.test.tsx "a review, then code changed: the turn’s end links docs and hands Claude their update"; "after the update turn, a doc whose SHA256 did not move gets the 手动更新 button" |
| TC-011 | `/doc-links add`, `remove`, `list`; ➕ 添加文档目录 | Folder kept for the project; prompt box filled | tests/doc-links.test.tsx "an extra folder must be absolute, exist, lie outside the project, and be added once"; "➕ 添加文档目录 puts the command in the prompt box" |

## Boundary & Failure Cases

- No request in the record yet: says so, scans nothing.
- Model fails: keyword fallback, warning shown.
- No Python: names only, state unknown, warning shown.
- A failed run keeps the earlier links and says why.
- A linked file deleted: 文件已不存在.
- Review followed by doc edits only, a failed edit, or a subagent's turn: nothing triggered.

## Regression Scope

The band button (hooks/main.tsx), store helpers (core/store), file helpers (core/files), scripts.
