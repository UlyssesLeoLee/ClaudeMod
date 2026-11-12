# Test Design: `hooks/core/files.ts`

Source: `hooks/core/files.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Integration tests with a faked `process.run` that records argv and answers per command, faked `fs.exists`, and `$.plugin.root` from the kit. Assertions are on the recorded argv and on the pane text.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | 📂 文件夹 on a linked Windows path; fake PowerShell prints `front` | argv is `powershell.exe … -File <root>/hooks/core/scripts/reveal.ps1 -Path D:\… -Folder D:\…`; no explorer fallback | tests/doc-links.test.tsx "📄 打开 opens the file; 📂 文件夹 opens its folder with the file selected" |
| TC-002 | Same, PowerShell fails | `explorer.exe /select,<path>` runs | tests/doc-links.test.tsx "documents kept in another folder of the project join once the folder is added" |
| TC-003 | 📄 打开 on an existing file | `explorer.exe <path>` | tests/doc-links.test.tsx "打开 opens the doc in the default app" |
| TC-004 | 📄 打开 on a missing file | No process started; toast says it is gone | tests/doc-links.test.tsx "打开 a doc that is gone says so and opens nothing" |
| TC-005 | 智能关联 with Python answering JSON | `python -I <root>/hooks/core/scripts/file_state.py`; SHA256 shown | tests/doc-links.test.tsx "linking records each linked doc’s SHA256 and modification time" |
| TC-006 | No Python (`python` and `py` fail) | State unknown, pane says why | tests/doc-links.test.tsx "without Python the state is unknown, and the pane says why" |
| TC-007 | git calls from the branch pane | Every git argv starts with `git`, env has `GIT_TERMINAL_PROMPT=0` | tests/branches.test.tsx "加载Git queries the defaults, then what the field holds" |

## Boundary & Failure Cases

- Python prints non-JSON: treated as no Python (TC-006 variant in tests/doc-links.test.tsx "without Python, Excel docs still count by name").
- `projectRoot` outside a repository returns the session folder (tests/overview.test.tsx "without a WBS, 新建 asks first, looks again, and sends only the fixed prompt").

## Regression Scope

Doc pane SHA256 tracking, Excel reading, open/reveal buttons, overview git state, and every branch pane git call.
