"""Prints the SHA256, modification time and size of files, stdlib only.

stdin: a JSON array of paths, UTF-8. stdout: one ASCII-escaped JSON object
{path: {"sha256", "mtimeMs", "size"} | {"missing": true} | {"error": "..."}}.
"""
import hashlib
import json
import os
import sys


def state(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    info = os.stat(path)
    return {"sha256": digest.hexdigest(), "mtimeMs": int(info.st_mtime * 1000), "size": info.st_size}


def main():
    paths = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    result = {}
    for path in paths:
        try:
            result[path] = state(path)
        except FileNotFoundError:
            result[path] = {"missing": True}
        except Exception as err:  # one unreadable file must not hide the others
            result[path] = {"error": f"{type(err).__name__}: {err}"[:200]}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
