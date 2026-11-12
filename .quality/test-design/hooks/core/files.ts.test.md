# Test Design: `hooks/core/files.ts`

Source: `hooks/core/files.ts`

Source-SHA256: `1435ce72bb4476c2db19639df4db6bce72c7ca5fe6ca6c4ca3ae6ae848321130`

## Test Strategy

Integration tests with a faked `process.run` that records argv and answers per command, faked `fs.exists`, and `$.plugin.root` from the kit. Assertions are on the recorded argv and on the pane text.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | 📂 文件夹 on a linked file; the mod's script prints `front` | One process: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <root>/hooks/core/scripts/reveal.ps1 -Path C:\proj\docs\… -Folder C:\proj\docs`; no explorer fallback | tests/doc-links.test.tsx#📂 文件夹 runs the mod’s own script, and stops once it brought the window to the front |
| TC-002 | 📂 文件夹 when the script answers neither `front` nor `opened` | `explorer.exe /select,<file>`; a gone file opens its folder | tests/doc-links.test.tsx#📄 打开 opens the file, 📂 文件夹 opens its folder with the file selected |
| TC-003 | 📄 打开 on an existing file | `explorer.exe <path>` | tests/doc-links.test.tsx#打开 opens the doc in the default app |
| TC-004 | 📄 打开 on a missing file | No process started; the pane says it is gone | tests/doc-links.test.tsx#打开 a doc that is gone says so and opens nothing |
| TC-005 | 智能关联 with Python answering | `file_state.py` runs with the linked paths; SHA256 shown | tests/doc-links.test.tsx#linking records each linked doc’s SHA256 and modification time |
| TC-006 | No Python (`python` and `py` fail) | State unknown, the pane says why | tests/doc-links.test.tsx#without Python the state is unknown, and the pane says why |
| TC-007 | A document of an extra folder opened | Its absolute path handed over with backslashes | tests/doc-links.test.tsx#documents kept in another folder of the project join once the folder is added |

## Boundary & Failure Cases

- Every interpreter exits non-zero: treated as no Python; workbooks count by name (tests/doc-links.test.tsx, "without Python, Excel docs still count by name").
- explorer.exe exits 1 even when it opened: counted as opened (TC-002, TC-003 fixtures).

## Regression Scope

Doc pane SHA256 tracking, Excel reading, open/reveal buttons, overview git state, and every branch pane git call.
