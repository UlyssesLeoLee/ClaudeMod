# Technical Design: `hooks/core/files.ts`

Source: `hooks/core/files.ts`

Source-SHA256: `1435ce72bb4476c2db19639df4db6bce72c7ca5fe6ca6c4ca3ae6ae848321130`

## Responsibility

The mod's reach outside the engine: git, the mod's own scripts, and the person's default apps. Each call runs only from a button press or a command.

- `runGit($, cwd, args, timeoutMs)` — `git` with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so no credential prompt holds a pane.
- `projectRoot($)` — `git rev-parse --show-toplevel` from the session folder; outside a repository the session folder with forward slashes.
- `runPython($, cwd, script, input)` — runs `hooks/core/scripts/<script>` with `python -I`, then `py -3 -I`; JSON on stdin and stdout; `undefined` when neither answers or the output is not JSON.
- `senseFiles($, root, paths)` — SHA256, mtime and size per path through `file_state.py`; `'missing'` for a file that is gone; `undefined` without Python.
- `revealInFolder($, root, path)` — Windows: `powershell.exe -File hooks/core/scripts/reveal.ps1 -Path … -Folder …` (Explorer with the file selected, brought to the front), falling back to `explorer.exe /select,…`; macOS `open -R`; Linux `xdg-open <folder>`.
- `openInApp($, root, path)` — the default app (`explorer.exe <file>`, `open`, `xdg-open`), only for a file that exists.

## Dependencies

- `./util` (`fullPath`).
- Engine: `$.process.run`, `$.session.cwd`, `$.fs.exists`, `$.plugin.root`.
- Scripts: `hooks/core/scripts/file_state.py`, `xlsx_text.py`, `reveal.ps1`.

## Public Contract

- `type Opened = 'opened' | 'missing' | 'failed'`; `type Sensed = FileState | 'missing'`.
- `revealInFolder`: script stdout `front` or `opened` → `'opened'`; `missing` → `'missing'`; anything else → fallback commands.
- `openInApp`: a missing file → `'missing'` without starting any process.

## Change Notes

- Scripts live in `hooks/core/scripts/`; every path is built from `$.plugin.root`, so the mod runs from wherever it is installed.
