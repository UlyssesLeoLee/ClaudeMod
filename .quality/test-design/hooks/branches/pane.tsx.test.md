# Test Design: `hooks/branches/pane.tsx`

Source: `hooks/branches/pane.tsx`

Source-SHA256: `c0994e8b30ebf6146fb892c74c8b74f0ced7750bc2f0c1dd6d93cc83e35e56bf`

## Test Strategy

Integration tests in tests/branches.test.tsx with the `claude-code/testing` kit: a fake git (`process.run`) answering `rev-parse`, `log`, `worktree list --porcelain`, `status`, `revert`, `push` per argv; `mock.clock` at a fixed time; `mock.store` for the protected list. Assertions on pane text, buttons, `ui.open` calls and recorded git argv.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Session start, pane mounted | No `process.run` | tests/branches.test.tsx#no git runs until 加载Git is pressed |
| TC-002 | 加载Git, then a branch typed in the field and 查询分支 | Defaults queried, then the typed branch | tests/branches.test.tsx#加载Git queries the defaults, then what the field holds |
| TC-003 | `/branch-status master develop` | List set and queried | tests/branches.test.tsx#/branch-status <names> sets the list and queries it, for surfaces without a field |
| TC-004 | AI commits inside and outside the 5-day window | The band counts the recent ones; rows show both, 🚨 on the recent ones only | tests/branches.test.tsx#outer alarm counts AI of the last 5 days, inner rows show every AI commit; tests/branches.test.tsx#🚨 marks exactly the rows the alarm counts: AI commits of the 5-day window |
| TC-005 | Own AI commit vs another person's | ↩ 撤销 on own only; confirm pushes `revert/<hash>` from a throwaway worktree | tests/branches.test.tsx#撤销 is offered on one’s own AI commits only; tests/branches.test.tsx#撤销 asks first, then pushes revert/<hash> from a throwaway worktree |
| TC-006 | Three worktrees, session in the second | All listed, second highlighted; 🗑 删除 on others, never this or the main one | tests/branches.test.tsx#every worktree is listed under the branches, this one highlighted; tests/branches.test.tsx#删除 is offered on other worktrees only, never this one or the main one |
| TC-007 | Dirty worktree with unmerged commits and ignored files | Details listed before a forced delete | tests/branches.test.tsx#unsaved changes and unmerged commits are listed before a forced delete; tests/branches.test.tsx#files git ignores are listed before a delete takes them |
| TC-008 | Row click / 📄 全文 | `ui.open` `commit-detail` with `focus: true`; full message shown | tests/branches.test.tsx#clicking a commit row opens its whole message in a pane of its own; tests/branches.test.tsx#every row has a visible 全文 button, and the hover preview a real one |
| TC-009 | 🛡 保护 on a queried branch | Joins the default list; kept across sessions | tests/branches.test.tsx#a queried branch can be protected, and then joins the default list; tests/branches.test.tsx#the protected list is kept across sessions |
| TC-010 | Detail of a commit that changed one `.nema` file: one domain revised, one changed without revision, one added | The detail lists the file and the three domain changes; no git runs before the row is clicked | tests/branches.test.tsx#the detail of a commit that changed a .nema file lists the domains it changed |
| TC-011 | Session start, branch pane mounted, no `.git` above the working directory | The path and `不是 Git 仓库` are shown and no process ran | tests/where.test.tsx#the branch pane shows the path before any git runs, even outside a repository |
| TC-012 | Working directory inside a linked worktree | The pane names the worktree and its main working tree | tests/where.test.tsx#a linked worktree is named with its main working tree |
| TC-013 | Edits inside the project, in another repository and in the temp folder, and a failed edit | Places listed with counts; the failed edit is not counted | tests/where.test.tsx#edits are recorded where they land: inside the project, in another repository, in the temp folder |
| TC-014 | A shell command after which the working directory is a subfolder | The shown running directory follows | tests/where.test.tsx#a shell cd moves the shown working directory |

## Boundary & Failure Cases

- Not a repository / failed fetch: said plainly ("not a repository, and a failed fetch, are said plainly").
- A query while one runs: `/branch-status` says it did not run ("/branch-status during a query says it did not run, instead of claiming it did").
- A read that fails stops a delete ("a read that fails stops the delete instead of calling it safe").
- More than 40 merges / 50 older AI rows: capped while the alarm counts all ("one walk judges at most 40 merges …"; "older AI rows are capped at 50 …").
- A leftover revert worktree is cleared first ("a revert worktree left by a run cut short is cleared before the next revert").
- Before the first read, or when reading fails, the pane shows no path block rather than a wrong one (TC-011 fixture without `session.root`).

## Regression Scope

The band's alarm (hooks/main.tsx), worktree path matching (core/util), git environment (core/files).
