# Technical Design: `hooks/core/scripts/file_state.py`

Source: `hooks/core/scripts/file_state.py`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Reads a JSON array of absolute paths on stdin and prints a JSON object keyed by each path: `{ "sha256": hex, "mtimeMs": number, "size": number }` for a readable file, `{ "missing": true }` for a path that does not exist, `{ "error": "<type>: <message>" }` (at most 200 characters) for one that cannot be read. Content is hashed in 1 MiB blocks, so large workbooks never load whole. Output is ASCII-escaped JSON, so no console code page alters Japanese or Chinese paths.

## Dependencies

Python 3 standard library only (`hashlib`, `json`, `os`, `sys`). Called by `senseFiles` in `hooks/core/files.ts` with `python -I` (isolated mode).

## Public Contract

- Input: JSON array of strings on stdin (UTF-8).
- Output: one JSON object on stdout; exit code 0.
- One unreadable file never hides the others: each path gets its own entry. `senseFiles` treats an `error` entry as no state for that path.

## Change Notes

- Lives in `hooks/core/scripts/` and is found through `$.plugin.root`.
