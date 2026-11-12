# Test Design: `hooks/core/scripts/file_state.py`

Source: `hooks/core/scripts/file_state.py`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

The mod's test runner (`claude plugin test`) fakes `process.run`, so its tests check the script's contract (argv, JSON in, JSON out) and not the script itself. The script is checked by running it directly with Python on real files.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Fake script answer `{path: {sha256, mtimeMs, size}}` | Pane shows `SHA256 <16 hex>… · 修改于 …` | tests/doc-links.test.tsx "linking records each linked doc’s SHA256 and modification time" |
| TC-002 | Fake answer `{path: {missing: true}}` | Row shows 文件已不存在 | tests/doc-links.test.tsx "a linked doc deleted from disk shows as missing" |
| TC-003 | `echo ["<README.md>","<no-such>"] \| py -3 -I hooks/core/scripts/file_state.py` | README entry with its `sha256` equal to `Get-FileHash -Algorithm SHA256`; `{"missing": true}` for the other | Manual check, command in this row |

## Boundary & Failure Cases

- Empty array → `{}` (TC-003 variant with `[]`).
- A directory path → `{"error": "PermissionError: …"}` or `IsADirectoryError` by platform; the other paths are still answered.

## Regression Scope

SHA256 status of every linked document (same / changed / missing) and the review-driven update verification.
