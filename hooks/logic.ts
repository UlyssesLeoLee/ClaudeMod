// Pure rules of the branch pane: no `$`, no git. Everything here is tested directly.
import type { BranchInfo, Commit, Worktree } from '../types'

// Protected branches that are always on the list; the person adds more with 🛡 保护.
export const BUILT_IN_PROTECTED: readonly string[] = ['master', 'main', 'develop', 'dev']
export const LOG_COUNT = 20
// The alarm scans a branch by time, not count: every commit of the last 5 days, up to this many.
export const RECENT_SCAN = 300
export const MAX_BRANCHES = 20
// How many commits a merge may bring in and still be judged whole.
export const MERGE_SCAN = 200
// How much of a message is kept, and how many brought-in commits a merge lists.
export const BODY_LIMIT = 1500
// How many merges one walk judges by what they brought in (one git call each).
export const MERGE_EXPANSIONS = 40
// How many AI commits older than a branch's latest rows it still lists.
export const EXTRA_AI_SHOWN = 50
export const BROUGHT_SHOWN = 50
// Lines of the message the hover preview shows.
export const PREVIEW_LINES = 12
// The outer alarm (branch row, band button) counts AI commits of the last 5 days only.
export const RECENT_MS = 5 * 24 * 60 * 60 * 1000

// `git log` record: fields split by \x1f, records ended by \x1e.
export const LOG_FORMAT = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%B%x1e'

// Words that name an AI tool, for lines that say a tool generated the change.
const TOOLS = /\b(claude|anthropic|copilot|codex|openai|chatgpt|gemini|cursor|aider|devin|windsurf|cody)\b/i
// A person (author, committer, co-author) is AI only by a bot address or a tool's own name,
// never by a first name: "Claude Opus 5.5" is a tool, "Claude Martin" and "Cody Wang" are people.
const BOT_ADDRESS = /\[bot\]|@anthropic\.com|@openai\.com|\bcopilot\b|\bcodex\b/i
const TOOL_NAME =
  /^(github\s+)?(claude|copilot|codex|chatgpt|gemini|cursor|aider|devin|windsurf)(\s+(code|agent|ai|opus|sonnet|haiku|fable|pro|flash|\d[\w.]*)\b.*)?$/i
const CO_AUTHOR = /^\s*co-authored-by:\s*(.*?)\s*<([^>]*)>/i
const GENERATED = /^\s*generated (with|by)\b|🤖/i

const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/

export type BranchInput = { names: string[]; invalid: string[] }
export type Person = [name: string, email: string]

/** A name git takes as one branch, never as an option or a range. */
export function isBranchName(w: string): boolean {
  return SAFE_NAME.test(w) && !w.includes('..') && !w.endsWith('.lock')
}

/** The protected branches: the built-in ones, then the ones the person added. */
export function protectedBranches(added: readonly string[]): string[] {
  return [...new Set([...BUILT_IN_PROTECTED, ...added.filter(isBranchName)])]
}

/** Splits the field's text into branch names; empty text means `fallback` (the protected list). */
export function parseBranchInput(text: string, fallback: readonly string[]): BranchInput {
  const words = [...new Set(text.split(/[\s,，]+/).filter(Boolean))]
  if (words.length === 0) return parseBranchInput(fallback.join(' '), BUILT_IN_PROTECTED)
  return {
    names: words.filter(isBranchName).slice(0, MAX_BRANCHES),
    invalid: words.filter(w => !isBranchName(w)),
  }
}

function toolOf(text: string, fallback: string): string {
  return (TOOLS.exec(text)?.[1] ?? fallback).toLowerCase()
}

/** The tool a person stands for, or '' for a human. */
export function aiPerson([name, email]: Person): string {
  if (BOT_ADDRESS.test(`${name} ${email}`)) return toolOf(`${name} ${email}`, 'bot')
  return TOOL_NAME.test(name.trim()) ? toolOf(name, 'ai') : ''
}

/** The AI tool behind a commit, lower-cased, or '' for a human one. */
export function detectAi(people: Person[], body: string): string {
  for (const person of people) {
    const tool = aiPerson(person)
    if (tool) return tool
  }
  for (const line of body.split('\n')) {
    const co = CO_AUTHOR.exec(line)
    if (co) {
      const tool = aiPerson([co[1] ?? '', co[2] ?? ''])
      if (tool) return tool
    } else if (GENERATED.test(line)) {
      return toolOf(line, 'ai')
    }
  }
  return ''
}

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split('\x1e')
    .map(rec => rec.replace(/^\n/, ''))
    .filter(Boolean)
    .map(rec => {
      const [sha = '', hash = '', parents = '', author = '', email = '', committer = '',
        committerEmail = '', ct = '0', subject = '', body = ''] = rec.split('\x1f')
      const lowered = email.toLowerCase()
      return {
        sha,
        hash,
        subject,
        author,
        email: lowered,
        ts: Number(ct) * 1000,
        isMerge: parents.trim().split(/\s+/).length > 1,
        ai: detectAi([[author, email], [committer, committerEmail]], body),
        authors: [lowered],
        body: body.trim().slice(0, BODY_LIMIT),
        brought: [],
      }
    })
    .filter(c => c.sha !== '')
}

/** The range of commits a merge brought in from its second parent. */
export function mergeRange(merge: Commit): string {
  return `${merge.sha}^1..${merge.sha}^2`
}

/**
 * A merge takes on what it brought in: AI if any brought-in commit is, and every
 * brought-in author, so reverting it can never undo someone else's work.
 */
export function withMerged(merge: Commit, brought: Commit[]): Commit {
  const ai = merge.ai || (brought.find(c => c.ai !== '')?.ai ?? '')
  const unseen = brought.length >= MERGE_SCAN ? ['?'] : []
  const authors = [...new Set([...merge.authors, ...brought.map(c => c.email), ...unseen])]
  const list = brought.slice(0, BROUGHT_SHOWN).map(c => `${c.ai ? '🚨 ' : ''}${c.hash} ${c.subject} · ${c.author}`)
  return { ...merge, ai, authors, brought: list }
}

/** The message below its subject line: what the row doesn't already show. */
export function messageLines(c: Commit): string[] {
  const lines = c.body.split('\n')
  const rest = lines[0]?.trim() === c.subject.trim() ? lines.slice(1) : lines
  while (rest.length > 0 && rest[0]?.trim() === '') rest.shift()
  return rest
}

/** Local `YYYY-MM-DD HH:mm`. */
export function fullTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Only one's own AI change may be reverted: never a person's, never another's AI. */
export function canRevert(c: Commit, me: string): boolean {
  const mine = me.toLowerCase()
  return c.ai !== '' && mine !== '' && c.authors.every(a => a === mine)
}

/** A path the way Windows compares it: either slash, any case, no trailing slash. */
export function normPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b)
}

/** The store key a pane keeps one project's result under, across sessions. */
export function projectKey(kind: string, cwd: string): string {
  return `${kind}:${normPath(cwd)}`
}

/** Reads `git worktree list --porcelain`; `current` is this session's top level. */
export function parseWorktrees(porcelain: string, current: string): Worktree[] {
  return porcelain
    .split(/\r?\n\r?\n/)
    .map(block => block.split(/\r?\n/).filter(Boolean))
    .filter(lines => lines[0]?.startsWith('worktree '))
    .map((lines, index) => {
      const field = (name: string) => lines.find(l => l === name || l.startsWith(`${name} `))
      const value = (name: string) => field(name)?.slice(name.length + 1) ?? ''
      const path = value('worktree')
      return {
        path,
        branch: value('branch').replace(/^refs\/heads\//, ''),
        head: value('HEAD').slice(0, 7),
        isCurrent: samePath(path, current),
        isMain: index === 0,
        isLocked: field('locked') !== undefined,
        isPrunable: field('prunable') !== undefined,
      }
    })
}

/** Refs of the protected branches, local and on origin: a commit in any of them counts as merged. */
export function baseRefPatterns(protectedNames: readonly string[]): string[] {
  return protectedNames.flatMap(b => [`refs/heads/${b}`, `refs/remotes/origin/${b}`])
}

/** A worktree may be deleted from the pane unless it is this one or the main checkout. */
export function canDeleteWorktree(t: Worktree): boolean {
  return !t.isCurrent && !t.isMain
}

/** git's `--since` for the alarm window; `@<seconds>` is the one form git always reads. */
export function sinceArg(now: number): string {
  return `--since=@${Math.floor((now - RECENT_MS) / 1000)}`
}

/**
 * The rows a branch shows: its latest commits, plus the AI commits of the window older
 * than those, at most EXTRA_AI_SHOWN of them, newest first.
 */
export function shownCommits(latest: readonly Commit[], recent: readonly Commit[]): Commit[] {
  const seen = new Set(latest.map(c => c.sha))
  const older = recent.filter(c => c.ai !== '' && !seen.has(c.sha)).slice(0, EXTRA_AI_SHOWN)
  return [...latest, ...older].sort((a, b) => b.ts - a.ts)
}

/** A merge past the expansion cap: its own markers only, and an unknown author so no revert. */
export function unjudgedMerge(c: Commit): Commit {
  return { ...c, authors: [...new Set([...c.authors, '?'])] }
}

/** AI commits of the 5-day window across branches, each counted once though merged into several. */
export function recentAiCount(branches: readonly BranchInfo[]): number {
  return new Set(branches.flatMap(b => b.aiRecent)).size
}

export function relTime(ts: number, now: number): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  if (min < 24 * 60) return `${Math.floor(min / 60)}小时前`
  if (min < 30 * 24 * 60) return `${Math.floor(min / 1440)}天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
