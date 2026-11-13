# Test Design: `hooks/core/where.ts`

Source: `hooks/core/where.ts`

Source-SHA256: `ba46b29e2a79889f9ee60053766f00bd3f53698f835b58a14819d2da46ebdfb1`

## Test Strategy

Unit tests of the pure functions in tests/where.test.tsx, and integration tests that mount the branch pane with faked `session.cwd`, `session.root`, `fs.stat`, `fs.read` and `process.run` (which records every process, so "no Git" is checked directly) and fire `$.tool.call` for edits and shell commands.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | `.git` file text `gitdir: C:/main/.git/worktrees/feat`, the same with backslashes and a trailing newline, a submodule's `gitdir: ../.git/modules/lib`, and `hello` | worktree with main `C:/main` (both spellings); submodule; `null` | tests/where.test.tsx#a .git file tells a linked worktree from a submodule |
| TC-002 | `isUnder('C:/proj/src', 'C:/proj')`, the folder itself, `C:/proj2`, other case and backslashes | true, true, false, true | tests/where.test.tsx#a path is under a folder only at a folder boundary |
| TC-003 | `whereNotes` for a folder that is no repository; a repository with `cwd` equal to `root`; `cwd` a subfolder of `root`; `cwd` outside `root`; a worktree; a submodule | The texts and tones designed for each case | tests/where.test.tsx#the notes say where the session runs and what kind of place it is |
| TC-004 | `touchedPath` for Edit, Write, MultiEdit, NotebookEdit with absolute and relative paths; for Bash and Read | The absolute forward-slash file; `''` for the other tools | tests/where.test.tsx#the file an edit tool call changed, resolved against the working directory |
| TC-005 | `isTempPath` on a Windows scratchpad file, a macOS `/private/tmp/claude-501/…/scratchpad/x`, a project file, a file under another `temp` folder | true, true, false, false | tests/where.test.tsx#the session’s temp folder is told from project folders |
| TC-006 | `addEdit` repeated for one place, then seven places; `editNotes` | Counts add up; six places kept, the one touched longest ago dropped; notes newest first, worded by kind | tests/where.test.tsx#edit places are counted, capped and said by kind |
| TC-007 | Session start and the pane mounted where no `.git` exists above `cwd` | `📍 运行目录：<cwd>` and `不是 Git 仓库` shown; no process run | tests/where.test.tsx#the branch pane shows the path before any git runs, even outside a repository |
| TC-008 | `cwd` inside a folder whose `.git` is a file pointing at `<main>/.git/worktrees/x` | The pane names the worktree and its main working tree | tests/where.test.tsx#a linked worktree is named with its main working tree |
| TC-009 | `Edit` in the project, `Edit` in another repository's folder, `Write` in the temp scratchpad, a failed `Edit` | Three places with counts (inside, outside named by its repository root, temp); the failed edit is not counted | tests/where.test.tsx#edits are recorded where they land: inside the project, in another repository, in the temp folder |
| TC-010 | A `Bash` tool call after which `session.cwd` answers a subfolder | The shown running directory follows it | tests/where.test.tsx#a shell cd moves the shown working directory |

## Boundary & Failure Cases

- `fs.stat` failing for every folder gives `kind: 'none'` and no throw (TC-007).
- A `.git` file with no `gitdir:` line leaves `none` (TC-001 and TC-007 fixtures).
- A relative edit path is resolved against the working directory read in the hook, so a shell `cd` before the call is honoured (TC-004).
- An edit outside every repository is placed in its own folder (TC-009 fixture).
- A working directory that cannot be read gives no `Where` and so no path block, never a wrong one (tests/where.test.tsx#a working directory that cannot be read shows no path rather than a wrong one).

## Regression Scope

The branch pane's header and state, the session start of every feature (a test file whose fake engine has no `session.root` or `fs.stat` still starts its session, because `readWhere` swallows what those calls reject with), and the existing doc pane `tool.call` hook, which must still see every edit: tests/review-sync.test.tsx runs with both hooks registered.
