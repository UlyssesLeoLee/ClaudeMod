# Test Design: `hooks/core/scripts/file_state.py`

Source: `hooks/core/scripts/file_state.py`

Source-SHA256: `4d9515fa1556efcebb7ca9c4d87a6bdee6cfdfb62f5e2c4a3cce119a26b9ec3e`

## Test Strategy

The mod's test runner fakes `process.run`, so tests/doc-links.test.tsx checks how the pane uses the script's answer, and tests/scripts_test.py runs the script itself with Python on real files (`py -3 -m unittest discover -s tests -p "*_test.py"`).

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Fake script answer with `sha256`, `mtimeMs`, `size` | Pane shows `SHA256 <16 hex>… · 修改于 …` | tests/doc-links.test.tsx#linking records each linked doc’s SHA256 and modification time |
| TC-002 | Fake answer `missing: true` | Row shows 文件已不存在 | tests/doc-links.test.tsx#a linked doc deleted from disk shows as missing |
| TC-003 | A UTF-8 named file and a gone path | SHA256 equal to hashlib's, the file's size and mtime; `{"missing": true}` for the gone one | tests/scripts_test.py::FileStateTest::test_a_file_gets_its_sha256_mtime_and_size_and_a_gone_one_is_missing |
| TC-004 | A folder path beside a file | `error` of at most 200 characters for the folder; the file still answered | tests/scripts_test.py::FileStateTest::test_an_unreadable_path_reports_an_error_and_the_others_are_still_answered |
| TC-005 | No paths | `{}` | tests/scripts_test.py::FileStateTest::test_no_paths_give_an_empty_answer |

## Boundary & Failure Cases

- Empty array gives `{}` (TC-005).
- A path that cannot be read gives an `error` entry while the other paths are still answered (TC-004).

## Regression Scope

SHA256 status of every linked document (same / changed / missing) and the review-driven update verification.
