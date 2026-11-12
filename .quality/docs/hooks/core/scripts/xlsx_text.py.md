# Technical Design: `hooks/core/scripts/xlsx_text.py`

Source: `hooks/core/scripts/xlsx_text.py`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Reads a JSON array of workbook paths on stdin and prints, per path, `{ "sheets": [names], "text": distinct shared strings joined by " / " }` so the doc pane can show the ranking model what an Excel document is about. It reads `xl/workbook.xml` and `xl/sharedStrings.xml` of the `.xlsx`/`.xlsm` zip with streaming `iterparse`, dropping each item once read and stopping past 3000 characters, and skips books over 100 MB.

## Dependencies

Python 3 standard library only (`zipfile`, `xml.etree.ElementTree`, `json`, `sys`). Called by `readBooks` in `hooks/doclinks/pane.tsx` through `runPython`.

## Public Contract

- Input: JSON array of absolute paths. Output: ASCII-escaped JSON object keyed by path; a book that cannot be read gets `{ "error": "<type>: <message>" }` (at most 200 characters), and the pane then uses its name only.
- `text` is at most 3000 characters, never the whole workbook.

## Change Notes

- Lives in `hooks/core/scripts/` and is found through `$.plugin.root`.
