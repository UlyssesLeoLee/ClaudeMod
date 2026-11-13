# Technical Design: `hooks/branches/pane.tsx`

Source: `hooks/branches/pane.tsx`

Source-SHA256: `392dc8876c1b08c8d4e623a47017ce0ed7f6fd08e84ad0a3a36fb5eaea202b8a`

## Responsibility

The 分支变更 feature: the `branch-status` pane, the `commit-detail` pane, and `/branch-status`.

- Branch list: master, main, develop, dev, the person's protected additions, or the names typed in the field / given to `/branch-status`. Each branch folds open to its latest commits, time and author on the right; AI commits in red, 🚨 on AI commits of the last 5 days; hover shows the message, 📄 全文 and a row click open the 提交详情 pane focused.
- 🔄 加载Git and 查询分支 are the only things that run git; nothing runs at session start or on redraw.
- 🛡 保护 / 取消保护 adds a queried branch to, or removes it from, the protected list (kept across sessions, store key `protected`).
- ↩ 撤销 on the person's own AI commits only (a merge only when every brought-in commit is their own): asks first, then reverts in a throwaway worktree and pushes `revert/<hash>`; protected branches are never written.
- Worktree list with the current one highlighted; 🗑 删除 first in each row, listing unsaved changes, unmerged commits, commits no branch holds and ignored files before a confirmed delete.
- `.nema` changes: when 提交详情 opens for a commit, git lists the files it changed against its first parent (`git -c core.quotepath=false show --name-only --format= -m --first-parent <sha>`, so non-ASCII paths come back as written); for each (at most 5) the file at the first parent and at the commit (`git show <ref>:<path>`) are parsed and the domains it changed are listed (`domainChanges`, `changeText`): which agent's commit changed which domain, and whether it raised the revision. A file new in the commit has all its domains new; a file the commit deleted has all its domains removed.
- Where the session works: the top of the pane always shows `📍 运行目录`, the project root when it differs, and the Git state (not a repository, a repository, a linked worktree with its main working tree, or a submodule), so a folder that is not a Git repository shows its path too. This is read at session start, again at 加载Git, and whenever a tool call finds the working directory changed (a shell `cd`), with no Git process: `$.session.cwd`, `$.session.root` and file checks only (`hooks/core/where.ts`).
- Where this session's edits landed: the `tool.call` hook counts each finished `Edit`, `Write`, `MultiEdit` and `NotebookEdit` by place — inside the project root, outside it (named by the repository root it is in, else its folder), or in Claude's per-session temp folder — and the pane lists up to six places under the path, newest first, with a line saying that files written by shell commands are not counted. A failed or denied tool call counts nothing.

## Dependencies

- `./logic` (branch rules), `../core/util` (`fullTime`, `relTime`, `samePath`), `../core/files` (`runGit`), `../core/build` (`buildFooter`).
- Engine: `$.process.run` (git), `$.store` (`branches`, `protected`), `$.ui.open`, `$.ui.toast`, `$.command.register`, `$.clock.now`, `$.session.cwd`.

## Public Contract

- `startBranches($)` — resets busy / confirming / delete plan, registers `/branch-status`.
- `registerBranches(on)` — `command.run` `branch-status`, `ui.render` panes `branch-status` and `commit-detail`.
- `openBranchPane($)` — opens the `branch-status` pane (title 分支变更).
- `branchAlarm($): Promise<number>` — AI commits of the last 5 days in the last query, for the band.
- State keys under `dev-cockpit`: `snapshot`, `open`, `branches`, `protectedAdded`, `busy`, `confirming`, `reverts`, `detail`, `alarm`, `wtPlan`, `wtNote`.
- `Detail.nema` (optional): `{ path: string; changes: NemaChange[]; error: string }[]`.
- State keys `where` (`Where | null`; null until session start has read it) and `edits` (`EditPlace[]`).
- The `tool.call` hook is a matched registration on `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and `Bash` (the engine allows one unmatched `tool.call` hook per plugin, and the doc feature holds it). It never blocks, alters or delays a call: it returns `next(e)`'s result, and its own failures are swallowed. A `Bash` call only makes it look at the working directory again; a call made inside a subagent does not move the shown directory.

## Change Notes

- The feature lives in `hooks/branches/`; the band and the session start live in `hooks/main.tsx`.
- Its store keys (`branches`, `protected`) are kept under the `dev-cockpit` store.
- The commit detail lists `.nema` domain changes.
- The pane shows the working path and where edits landed, because a session's folder may not be the folder the person means (a shell `cd`, a worktree, a folder that is not a repository, or an absolute path elsewhere).

