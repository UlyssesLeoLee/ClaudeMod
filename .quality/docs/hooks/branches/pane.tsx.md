# Technical Design: `hooks/branches/pane.tsx`

Source: `hooks/branches/pane.tsx`

Source-SHA256: `25626620bb7389d16467370138a53b274fca8e3ebc17cc1e218fbab44983a1b6`

## Responsibility

The 分支变更 feature: the `branch-status` pane, the `commit-detail` pane, and `/branch-status`.

- Branch list: master, main, develop, dev, the person's protected additions, or the names typed in the field / given to `/branch-status`. Each branch folds open to its latest commits, time and author on the right; AI commits in red, 🚨 on AI commits of the last 5 days; hover shows the message, 📄 全文 and a row click open the 提交详情 pane focused.
- 🔄 加载Git and 查询分支 are the only things that run git; nothing runs at session start or on redraw.
- 🛡 保护 / 取消保护 adds a queried branch to, or removes it from, the protected list (kept across sessions, store key `protected`).
- ↩ 撤销 on the person's own AI commits only (a merge only when every brought-in commit is their own): asks first, then reverts in a throwaway worktree and pushes `revert/<hash>`; protected branches are never written.
- Worktree list with the current one highlighted; 🗑 删除 first in each row, listing unsaved changes, unmerged commits, commits no branch holds and ignored files before a confirmed delete.
- `.nema` changes: when 提交详情 opens for a commit, git lists the `.nema` files it changed (`git show --name-only --format= <sha>`); for each (at most 5) the file at the first parent and at the commit (`git show <ref>:<path>`) are parsed and the domains it changed are listed (`domainChanges`, `changeText`): which agent's commit changed which domain, and whether it raised the revision. A file new in the commit has all its domains new; a file the commit deleted has all its domains removed.

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

## Change Notes

- The feature lives in `hooks/branches/`; the band and the session start live in `hooks/main.tsx`.
- Its store keys (`branches`, `protected`) are kept under the `dev-cockpit` store.
- The commit detail lists `.nema` domain changes.

