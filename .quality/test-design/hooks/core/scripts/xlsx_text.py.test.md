# Test Design: `hooks/core/scripts/xlsx_text.py`

Source: `hooks/core/scripts/xlsx_text.py`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

The mod's tests fake `process.run` and check how the pane uses the script's answer; the script itself is checked by running it with Python on a real workbook.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Fake answer with `sheets` and `text` for a linked `.xlsx` | The model prompt carries `工作表: …` content for it | tests/doc-links.test.tsx "every classified doc reaches the model; its picks are grouped, invented ids dropped" |
| TC-002 | No Python | Warning 没能用 Python 读取 Excel 内容; workbooks still ranked by name | tests/doc-links.test.tsx "without Python, Excel docs still count by name" |
| TC-003 | `echo ["D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL/docs/99_archive/history/09_requirements-tracking-sheet.xlsx"] \| py -3 -I hooks/core/scripts/xlsx_text.py` | JSON with that path, its sheet names and leading text | Manual check, command in this row |

## Boundary & Failure Cases

- A path that is not a zip (renamed `.xls`) gets `{"error": "BadZipFile: …"}`; the other books are still answered.
- A workbook over 100 MB gets `{"error": "ValueError: workbook over 100 MB, skipped"}`.

## Regression Scope

Ranking quality for Excel documents in the doc pane.
