# Technical Design: `hooks/core/where.ts`

Source: `hooks/core/where.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Tells where a session works and where its edits land, with no Git process, so it also works in a folder that is not a repository.

- `Where` = `{ cwd, root, top, main, kind }`. `cwd` is `$.session.cwd()` (where commands run; a shell `cd` moves it), `root` is `$.session.root()` (the project root the session started in or was moved to), both with forward slashes. `top` is the working tree's root: the nearest folder at or above `cwd` (at most 12 levels) that holds `.git`, or `null`. `kind` is `none` (no `.git`), `repo` (`.git` is a folder), `worktree` (`.git` is a file whose `gitdir:` line points into `<main>/.git/worktrees/<name>`) or `submodule` (a `.git` file with any other `gitdir:`). `main` is the main working tree's root for a `worktree`, else `null`.
- `readWhere($)` reads those with `$.session.cwd`, `$.session.root`, `$.fs.stat` and `$.fs.read`; it never throws (a failed read gives `kind: 'none'`).
- `gitdirMain(text)` reads a `.git` file's text: `{ kind: 'worktree', main }`, `{ kind: 'submodule', main: null }`, or `null` when there is no `gitdir:` line; slashes of either kind and a trailing newline are accepted.
- `isUnder(path, folder)` is true for the folder itself and anything below it, compared at folder boundaries (`C:/proj2` is not under `C:/proj`), case and slash insensitive.
- `whereNotes(w)` is the pane's lines, each `{ text, tone }` with tone `info`, `warn` or `dim`: `📍 运行目录：<cwd>`; `项目根：<root>` when it differs from `cwd`, with a warning when `cwd` is not under `root`; then the Git state: not a repository, a repository (noting a project root that is a subfolder of it), a worktree (naming its main working tree and saying the main working tree does not see this session's edits), or a submodule.
- `touchedPath(tool, input, cwd)` is the file an `Edit`, `Write`, `MultiEdit` or `NotebookEdit` call changed, absolute with forward slashes (a relative path is taken from `cwd`), else `''`.
- `isTempPath(path)` is true for a file in Claude's per-session temp folder: a path with a `temp` or `tmp` folder followed by a folder starting `claude`, and a `scratchpad` folder below it. `tempPlace(path)` is that scratchpad folder.
- `EditPlace` = `{ place, kind, count, lastMs }` with kind `inside` (under `root`), `outside` or `temp`. `addEdit(places, { place, kind }, now)` counts one more file edit there and keeps at most 6 places, dropping the one touched longest ago. `editNotes(places, root)` says each place, newest first: `✔ 项目内 <root> · N 次`, `⚠ <place> · N 次（不在项目根下）`, `🗂 临时目录 <place> · N 次（Claude 放中间文件的地方）`.
- `editPlace($, file, w, now)` finds where one edited file belongs: the temp folder, `root` when the file is under it, else the nearest repository root above the file (`$.fs.stat` of `.git`, at most 10 levels, remembered per folder) or the file's own folder.

## Dependencies

`./util` (`normPath`, `samePath`, `isAbsolutePath`, `fullPath`) and the engine calls `$.session.cwd`, `$.session.root`, `$.fs.stat`, `$.fs.read`. No import from any feature; the branch feature draws what this module says.

## Public Contract

- `readWhere` and `editPlace` never throw and start no process.
- A `.git` entry that cannot be read counts as absent; a `.git` file that cannot be read, or has no `gitdir:` line, gives `kind: 'none'` rather than a guess.
- Only edits by the four edit tools are counted; files written by a shell command are not seen, and the pane says so.

## Change Notes

- New module, used by `hooks/branches/pane.tsx` to show the working path, the repository state and where this session's edits landed.
