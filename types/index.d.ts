export type Commit = {
  sha: string
  hash: string
  subject: string
  author: string
  email: string
  ts: number
  isMerge: boolean
  ai: string
  // Who wrote the change: the author, plus every author a merge brought in.
  authors: string[]
  // The whole commit message, capped.
  body: string
  // `<hash> <subject>` of each commit a merge brought in, capped; [] otherwise.
  brought: string[]
}
// The commit the detail pane shows, and the branch it was picked from.
export type Detail = { branch: string; commit: Commit }
export type BranchInfo = {
  name: string
  // The rows shown: capped, so they never stand for a count.
  commits: Commit[]
  // Every AI commit of the 5-day window at query time, by sha: what the alarms count.
  aiRecent: string[]
}
export type Worktree = {
  path: string
  // Short branch name, or '' when detached.
  branch: string
  head: string
  isCurrent: boolean
  // The repository's own checkout, listed first; git never removes it.
  isMain: boolean
  isLocked: boolean
  isPrunable: boolean
}
// What deleting one worktree would lose or leave, read before the person confirms.
export type WorktreePlan = {
  path: string
  // `git status --porcelain` lines: lost on delete.
  dirty: string[]
  // `<hash> <subject>` of commits in no base branch: kept on the branch.
  unmerged: string[]
  // `<hash> <subject>` of commits on a detached HEAD that no branch or tag holds: lost on delete.
  orphaned: string[]
  // Paths git ignores (.env, build output): deleted with the folder.
  ignored: string[]
  bases: string[]
  // The folder is already gone: only git's record is cleaned up.
  isPrune: boolean
  error: string
}
export type Snapshot = {
  branches: BranchInfo[]
  worktrees: Worktree[]
  at: number
  error: string
  warnings: string[]
  me: string
}
// What the pane is doing now: '' idle, 'query', 'revert' or 'worktree'.
export type Busy = '' | 'query' | 'revert' | 'worktree'

// The six kinds of project document the doc pane links to a task.
// 'other': related to the task, yet none of the named kinds.
export type DocKind = 'req' | 'basic' | 'detail' | 'ut' | 'it' | 'st' | 'spec' | 'plan' | 'other'
export type FileState = { sha256: string; mtimeMs: number; size: number }
export type DocLink = {
  kind: DocKind
  // Relative to the project root, forward slashes.
  path: string
  reason: string
  // The file as it was when linked (or last accepted), and as last checked.
  base: FileState | null
  now: FileState | null
  isMissing: boolean
}
export type DocResult = {
  at: number
  // When the files' state was last read; 0 never.
  checkedAt: number
  root: string
  // The person's latest request when the links were made.
  task: string
  links: DocLink[]
  // How many classified documents the scan found.
  found: number
  // Folders beside the project that look like its documents, not yet added: one click adds one.
  suggestions?: string[]
  warnings: string[]
  error: string
}

export type WbsStatus = '未开始' | '进行中' | '已完成' | '已取消'
export type WbsTask = {
  // `1`, `1.1`, `1.1.1`: the dots give the hierarchy.
  id: string
  name: string
  owner: string
  // YYYY-MM-DD, or '' when blank.
  start: string
  due: string
  finished: string
  // Person-days, or null when blank.
  effort: number | null
  // 0–100.
  progress: number
  status: WbsStatus
  // No other task's id starts with this one's plus a dot.
  isLeaf: boolean
}
export type MismatchKind = 'done-without-change' | 'changed-but-not-updated'
export type Mismatch = { id: string; kind: MismatchKind; note: string }
export type Overview = {
  at: number
  root: string
  // Project-relative path of the WBS read, or '' when the project has none.
  wbsPath: string
  wbsMtime: number
  tasks: WbsTask[]
  // 0–100, or null when the WBS has no task to count.
  percent: number | null
  // Weighted by 工数 when every counted task has one; else by task count.
  byEffort: boolean
  done: number
  total: number
  // At most 140 characters.
  summary: string
  isAiSummary: boolean
  mismatches: Mismatch[]
  warnings: string[]
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'branch-status': {
      snapshot: Shaped<Snapshot>
      open: Shaped<Record<string, boolean>>
      branches: Shaped<string>
      // Branches the person added to the protected list; null until read from the store.
      protectedAdded: Shaped<string[] | null>
      busy: Shaped<Busy>
      confirming: Shaped<string>
      reverts: Shaped<Record<string, string>>
      detail: Shaped<Detail | null>
      // AI commits of the window at the last query, for the band.
      alarm: Shaped<number>
      // The delete waiting for confirmation, or null.
      wtPlan: Shaped<WorktreePlan | null>
      // The outcome of the last worktree delete.
      wtNote: Shaped<string>
      docResult: Shaped<DocResult>
      // '' idle, 'link' or 'check'.
      docBusy: Shaped<string>
      // Linked docs the person switched off for the update, by path.
      docSkip: Shaped<Record<string, boolean>>
      docConfirm: Shaped<boolean>
      // When the update prompt was last handed to Claude; 0 never.
      docSentAt: Shaped<number>
      // A review happened and its code changes have not yet triggered a doc update.
      syncReview: Shaped<boolean>
      // Code files the main loop changed in the running turn.
      syncEdited: Shaped<string[]>
      // '' idle; 'submitted' once an update prompt is sent; 'update-turn' while Claude runs it.
      syncPhase: Shaped<string>
      // Each doc's SHA256 before the update was sent ('' when unreadable), by path.
      syncBefore: Shaped<Record<string, string>>
      // Docs the last update left unchanged: what 手动更新 sends again.
      syncUnchanged: Shaped<string[]>
      // What the last review sync did, for the pane.
      syncNote: Shaped<string>
      // The project's extra document folders once changed in this session; null: read the store.
      docFolders: Shaped<string[] | null>
      // The doc kinds the person opened in the pane; every kind starts folded.
      docKindOpen: Shaped<Record<string, boolean>>
      // Which code this session loaded: version and newest file time, shown at each pane's foot.
      modBuild: Shaped<string>
      // The task overview: this session's copy (the store keeps each project's).
      ovResult: Shaped<Overview>
      ovBusy: Shaped<boolean>
      // The create-WBS prompt waiting for its second press.
      ovConfirm: Shaped<boolean>
      // What became of the last create-WBS press.
      ovNote: Shaped<string>
    }
  }
}
