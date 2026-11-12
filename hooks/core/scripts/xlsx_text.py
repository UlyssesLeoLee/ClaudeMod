"""Prints the sheet names and leading text of .xlsx/.xlsm files, stdlib only.

stdin: a JSON array of paths, UTF-8. stdout: one ASCII-escaped JSON object
{path: {"sheets": [...], "text": "..."} | {"error": "..."}}, so no console
code page can mangle Japanese or Chinese text on the way back.
"""
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
LIMIT = 3000
# A workbook past this is skipped whole: reading it is not worth the memory.
MAX_BYTES = 100 * 1024 * 1024


def read_book(path):
    if os.path.getsize(path) > MAX_BYTES:
        raise ValueError("workbook over 100 MB, skipped")
    with zipfile.ZipFile(path) as book:
        names = set(book.namelist())
        with book.open("xl/workbook.xml") as stream:
            sheets = [el.get("name", "") for _, el in ET.iterparse(stream) if el.tag == NS + "sheet"]
        seen, texts, size = set(), [], 0
        if "xl/sharedStrings.xml" in names:
            # Streamed, each item dropped once read, and stopped at LIMIT: a workbook with
            # millions of strings costs no more memory than one with a hundred.
            with book.open("xl/sharedStrings.xml") as stream:
                for _, item in ET.iterparse(stream):
                    if item.tag != NS + "si":
                        continue
                    text = "".join(t.text or "" for t in item.iter(NS + "t")).strip()
                    item.clear()
                    if text and text not in seen:
                        seen.add(text)
                        texts.append(text)
                        size += len(text)
                        if size > LIMIT:
                            break
        return {"sheets": sheets, "text": " / ".join(texts)[:LIMIT]}


def main():
    paths = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    result = {}
    for path in paths:
        try:
            result[path] = read_book(path)
        except Exception as err:  # one unreadable book must not hide the others
            result[path] = {"error": f"{type(err).__name__}: {err}"[:200]}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
