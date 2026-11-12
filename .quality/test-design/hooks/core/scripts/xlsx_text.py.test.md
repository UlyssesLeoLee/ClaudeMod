# Test Design: `hooks/core/scripts/xlsx_text.py`

Source: `hooks/core/scripts/xlsx_text.py`

Source-SHA256: `79e7ef65c80d507ef1093ddf244d279f298bc5979e066bbd3025b7ea1583a997`

## Test Strategy

The mod's test runner fakes `process.run`, so tests/doc-links.test.tsx checks how the pane falls back without the script, and tests/scripts_test.py runs the script itself with Python on workbooks it builds (`py -3 -m unittest discover -s tests -p "*_test.py"`).

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | No Python | Warning 没能用 Python 读取 Excel 内容; workbooks still ranked by name | tests/doc-links.test.tsx#without Python, Excel docs still count by name |
| TC-002 | A workbook with two sheets and a repeated string | Sheet names; distinct strings joined by " / " | tests/scripts_test.py::XlsxTextTest::test_a_workbook_gives_its_sheet_names_and_distinct_strings |
| TC-003 | 100 strings of 100 characters | `text` of at most 3000 characters, from the first string on | tests/scripts_test.py::XlsxTextTest::test_text_stops_past_3000_characters |
| TC-004 | A workbook without `xl/sharedStrings.xml` | Its sheets, empty text | tests/scripts_test.py::XlsxTextTest::test_a_book_without_shared_strings_still_gives_its_sheets |
| TC-005 | A `.xls` that is no zip, beside a good workbook | `BadZipFile` error for it; the good one answered | tests/scripts_test.py::XlsxTextTest::test_a_file_that_is_no_workbook_reports_an_error_and_the_others_are_still_answered |

## Boundary & Failure Cases

- A file that is no zip gets a `BadZipFile` error, the others are still answered (TC-005).
- A workbook over 100 MB gets `ValueError: workbook over 100 MB, skipped`; no test builds a 100 MB file, the size check is the script's first line of `read_book`.

## Regression Scope

Ranking quality for Excel documents in the doc pane.
