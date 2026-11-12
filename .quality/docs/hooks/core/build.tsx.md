# Technical Design: `hooks/core/build.tsx`

Source: `hooks/core/build.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Tells which copy of the mod a session runs, and whether newer code is waiting:

- `noteBuild($)` — at session start: reads `version` from `.claude-plugin/plugin.json` and the newest modification time of the mod's code files under `hooks/` (recursively, `.ts`, `.tsx`, `.py`, `.ps1`, `.json`), and keeps both in the `modBuild` state.
- `BuildFooter` data via `buildInfo($)` — for the foot of every pane: `line` = `claude-mod <version> · 代码 <YYYY-MM-DD HH:mm>`; `stale` = `⚠ mod 代码已在 <time> 更新，本会话仍在用旧代码：重开会话后生效` when a code file is newer than what the session loaded, else `''`.
- `buildFooter($, e)` — the footer element every pane appends: the line dimmed, the stale notice in yellow.

The newer-code check lists the files again at most once per `STALE_CHECK_MS` (60 s); between checks the last answer is reused (module-level cache), so a pane redraw costs no file listing.

## Dependencies

- `../core/util` (`fullTime`).
- Engine: `$.plugin.root`, `$.fs.read`, `$.fs.list`, `$.clock.now`, `$.ui.resolve`, state `claude-mod.modBuild`.

## Public Contract

- `MOD_NAME = 'claude-mod'`, `STALE_CHECK_MS = 60_000`.
- `noteBuild($): Promise<void>` — never throws: an unreadable manifest gives version `?`, an unreadable folder gives `代码 未知`.
- `buildInfo($): Promise<{ line: string; stale: string }>` — `line` is `''` before `noteBuild` ran.
- `buildFooter($, e)` — returns the footer element, or `null` while `line` is `''`.
- State `modBuild`: `{ version: string; loadedMs: number }` (shape `modBuild-2`).

## Change Notes

- The footer names the mod `claude-mod` and walks `hooks/` with its feature folders.
- A session running code older than the files on disk says so in every pane.
