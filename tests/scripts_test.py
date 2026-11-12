"""Tests of the mod's Python scripts, run as the mod runs them: JSON on stdin, JSON out.

Run: py -3 -m unittest discover -s tests -p "*_test.py"
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / "hooks" / "core" / "scripts"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def run(script, paths):
    done = subprocess.run(
        [sys.executable, "-I", str(SCRIPTS / script)],
        input=json.dumps(paths).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    out = done.stdout.decode("ascii")  # ASCII-escaped JSON: no code page can alter it
    return json.loads(out)


def workbook(path, sheets, strings):
    with zipfile.ZipFile(path, "w") as book:
        book.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{NS}"><sheets>'
            + "".join(f'<sheet name="{s}" sheetId="{i + 1}"/>' for i, s in enumerate(sheets))
            + "</sheets></workbook>",
        )
        if strings is not None:
            book.writestr(
                "xl/sharedStrings.xml",
                f'<sst xmlns="{NS}">' + "".join(f"<si><t>{t}</t></si>" for t in strings) + "</sst>",
            )


class FileStateTest(unittest.TestCase):
    def test_a_file_gets_its_sha256_mtime_and_size_and_a_gone_one_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = os.path.join(tmp, "要件定義書.md")
            pathlib.Path(doc).write_bytes("勤怠申請\n".encode("utf-8"))
            gone = os.path.join(tmp, "nope.md")
            got = run("file_state.py", [doc, gone])
            self.assertEqual(got[doc]["sha256"], hashlib.sha256("勤怠申請\n".encode("utf-8")).hexdigest())
            self.assertEqual(got[doc]["size"], len("勤怠申請\n".encode("utf-8")))
            self.assertEqual(got[doc]["mtimeMs"], int(os.stat(doc).st_mtime * 1000))
            self.assertEqual(got[gone], {"missing": True})

    def test_an_unreadable_path_reports_an_error_and_the_others_are_still_answered(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = os.path.join(tmp, "a.md")
            pathlib.Path(doc).write_text("x", encoding="utf-8")
            got = run("file_state.py", [tmp, doc])
            self.assertIn("error", got[tmp])
            self.assertLessEqual(len(got[tmp]["error"]), 200)
            self.assertIn("sha256", got[doc])

    def test_no_paths_give_an_empty_answer(self):
        self.assertEqual(run("file_state.py", []), {})


class XlsxTextTest(unittest.TestCase):
    def test_a_workbook_gives_its_sheet_names_and_distinct_strings(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = os.path.join(tmp, "単体テスト仕様書.xlsx")
            workbook(book, ["改訂履歴", "テストケース"], ["勤怠申請", "承認", "勤怠申請"])
            got = run("xlsx_text.py", [book])
            self.assertEqual(got[book], {"sheets": ["改訂履歴", "テストケース"], "text": "勤怠申請 / 承認"})

    def test_text_stops_past_3000_characters(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = os.path.join(tmp, "big.xlsx")
            workbook(book, ["S"], [f"{i:04d}" + "あ" * 96 for i in range(100)])
            got = run("xlsx_text.py", [book])
            self.assertLessEqual(len(got[book]["text"]), 3000)
            self.assertTrue(got[book]["text"].startswith("0000"))

    def test_a_book_without_shared_strings_still_gives_its_sheets(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = os.path.join(tmp, "numbers.xlsx")
            workbook(book, ["数値"], None)
            self.assertEqual(run("xlsx_text.py", [book])[book], {"sheets": ["数値"], "text": ""})

    def test_a_file_that_is_no_workbook_reports_an_error_and_the_others_are_still_answered(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "old.xls")
            pathlib.Path(fake).write_bytes(b"\xd0\xcf\x11\xe0 not a zip")
            book = os.path.join(tmp, "ok.xlsx")
            workbook(book, ["S"], ["x"])
            got = run("xlsx_text.py", [fake, book])
            self.assertTrue(got[fake]["error"].startswith("BadZipFile"))
            self.assertEqual(got[book]["sheets"], ["S"])


if __name__ == "__main__":
    unittest.main()
