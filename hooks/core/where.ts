// Where a session works and where its edits land, read without any Git process, so it
// also works in a folder that is not a repository. The branch pane draws what it says.
import type { EngineInterface } from 'claude-code'

import type { EditPlace, Where } from '../../types'
import { fullPath, isAbsolutePath, normPath, samePath } from './util'

export type Note = { text: string; tone: 'info' | 'warn' | 'dim' }
export type Place = { place: string; kind: EditPlace['kind'] }

/** How many folders up from the working directory the working tree's `.git` is looked for. */
const GIT_LEVELS = 12
/** How many folders up from an edited file its repository is looked for. */
const FILE_LEVELS = 10
/** How many places of edits are kept. */
const MAX_PLACES = 6
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Claude's per-session temp folder: `<temp|tmp>/claude…/<…>/scratchpad`.
const TEMP = /^(.*\/(?:temp|tmp)\/claude[^/]*\/.*?\/scratchpad)(?:\/|$)/i

/** A path with forward slashes and no trailing slash (a drive's root keeps its slash). */
function fwd(p: string): string {
  const s = p.trim().replace(/\\/g, '/')
  return s.length > 1 && !/^[A-Za-z]:\/$/.test(s) ? s.replace(/\/+$/, '') : s
}

/** The folder above a path; a root is its own parent. */
function parentDir(p: string): string {
  const up = p.replace(/\/[^/]+\/?$/, '')
  if (/^[A-Za-z]:$/.test(up)) return `${up}/`
  return up === '' ? '/' : up
}

/** `base/rel` with `.` and `..` folded, for a `gitdir:` that is written relative. */
function resolveFrom(base: string, rel: string): string {
  const out = fwd(base).split('/')
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 1) out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/') || '/'
}

/** Whether `path` is `folder` or lies below it, compared at folder boundaries. */
export function isUnder(path: string, folder: string): boolean {
  const p = normPath(path)
  const f = normPath(folder)
  if (f === '') return p === '' || p.startsWith('/')
  return p === f || p.startsWith(`${f}/`)
}

/**
 * What a `.git` file says: a linked worktree (its `gitdir:` is `<main>/.git/worktrees/<name>`,
 * giving the main working tree), a submodule (any other `gitdir:`), or null (no such line).
 * `base` is the folder the file stands in, for a path written relative.
 */
export function gitdirMain(text: string, base = ''): { kind: 'worktree' | 'submodule'; main: string | null } | null {
  const line = /^gitdir:\s*(.+?)\s*$/m.exec(text.replace(/\r/g, ''))
  if (line === null) return null
  const dir = fwd(line[1] ?? '')
  const linked = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(dir)
  if (linked === null) return { kind: 'submodule', main: null }
  const main = linked[1] ?? ''
  if (main === '') return { kind: 'worktree', main: '/' }
  return { kind: 'worktree', main: isAbsolutePath(main) || base === '' ? main : resolveFrom(base, main) }
}

/**
 * Reads where the session works: the working directory, the project root, and the working
 * tree found by looking for `.git` upward. Starts no process; never throws.
 */
export async function readWhere($: EngineInterface): Promise<Where | null> {
  try {
    const cwd = fwd(await $.session.cwd())
    const root = fwd(await $.session.root().catch(() => cwd))
    let dir = cwd
    for (let i = 0; i < GIT_LEVELS; i++) {
      const entry = await $.fs.stat(`${dir}/.git`).catch(() => undefined)
      if (entry?.kind === 'dir') return { cwd, root, top: dir, main: null, kind: 'repo' }
      if (entry?.kind === 'file') {
        const text = await $.fs.read(`${dir}/.git`).catch(() => '')
        const found = typeof text === 'string' ? gitdirMain(text, dir) : null
        return found === null
          ? { cwd, root, top: null, main: null, kind: 'none' }
          : { cwd, root, top: dir, main: found.main, kind: found.kind }
      }
      const up = parentDir(dir)
      if (up === dir) break
      dir = up
    }
    return { cwd, root, top: null, main: null, kind: 'none' }
  } catch {
    return null
  }
}

/** The pane's lines about where the session works. */
export function whereNotes(w: Where): Note[] {
  const notes: Note[] = [{ text: `📍 运行目录：${w.cwd}`, tone: 'info' }]
  if (!samePath(w.cwd, w.root)) {
    notes.push(
      isUnder(w.cwd, w.root)
        ? { text: `   项目根：${w.root}（终端已进入项目里的子文件夹）`, tone: 'dim' }
        : {
            text: `   ⚠ 项目根：${w.root}。运行目录不在它下面：命令和相对路径的改动落在运行目录，不在项目根`,
            tone: 'warn',
          },
    )
  }
  const top = w.top ?? ''
  if (w.kind === 'none') {
    notes.push({ text: '   不是 Git 仓库：分支记录用不了；改动只存在于文件夹里，没有 Git 可以对照', tone: 'warn' })
  } else if (w.kind === 'worktree') {
    notes.push({
      text: `   ⚠ Git worktree：${top}（主工作区：${w.main ?? '未知'}）。本会话的改动在这个文件夹里，主工作区看不到，要合并回去`,
      tone: 'warn',
    })
  } else if (w.kind === 'submodule') {
    notes.push({ text: `   Git 子模块：${top}`, tone: 'dim' })
  } else if (samePath(top, w.root)) {
    notes.push({ text: `   Git 仓库：${top}`, tone: 'dim' })
  } else if (isUnder(w.root, top)) {
    notes.push({ text: `   Git 仓库：${top}（项目根是它里面的子文件夹）`, tone: 'dim' })
  } else {
    notes.push({ text: `   ⚠ Git 仓库：${top}（项目根不在这个仓库里）`, tone: 'warn' })
  }
  return notes
}

/** The file an edit tool call changed: absolute, forward slashes (a relative one is taken from `cwd`); else ''. */
export function touchedPath(tool: string, input: Record<string, unknown>, cwd: string): string {
  if (!EDIT_TOOLS.has(tool)) return ''
  const raw = input.file_path ?? input.notebook_path
  if (typeof raw !== 'string' || raw.trim() === '') return ''
  const file = isAbsolutePath(raw) ? raw : fullPath(fwd(cwd), raw)
  return fwd(file).replace(/\/\.\//g, '/')
}

/** Claude's per-session temp folder a file is in (the `scratchpad` folder), or null. */
export function tempPlace(path: string): string | null {
  return TEMP.exec(fwd(path))?.[1] ?? null
}

export function isTempPath(path: string): boolean {
  return tempPlace(path) !== null
}

/** One more edit at `at`; at most six places are kept, the one touched longest ago dropped. */
export function addEdit(places: readonly EditPlace[], at: Place, now: number): EditPlace[] {
  const found = places.find(p => p.kind === at.kind && samePath(p.place, at.place))
  const next = found
    ? places.map(p => (p === found ? { ...p, count: p.count + 1, lastMs: now } : p))
    : [...places, { place: at.place, kind: at.kind, count: 1, lastMs: now }]
  return next.length > MAX_PLACES ? [...next].sort((a, b) => b.lastMs - a.lastMs).slice(0, MAX_PLACES) : next
}

/** The pane's lines about where edits landed, newest place first. */
export function editNotes(places: readonly EditPlace[]): Note[] {
  return places
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.lastMs - a.p.lastMs || b.i - a.i)
    .map(({ p }): Note => {
      if (p.kind === 'inside') return { text: `✔ 项目内 ${p.place} · ${p.count} 次`, tone: 'info' }
      if (p.kind === 'temp') {
        return { text: `🗂 临时目录 ${p.place} · ${p.count} 次（Claude 放中间文件的地方）`, tone: 'dim' }
      }
      return { text: `⚠ ${p.place} · ${p.count} 次（不在项目根下）`, tone: 'warn' }
    })
}

// The repository root found for a folder, remembered so a run of edits looks once.
const repoOf = new Map<string, string>()
const REPO_CACHE = 300

function remember(keys: readonly string[], value: string) {
  if (repoOf.size > REPO_CACHE) repoOf.clear()
  for (const k of keys) repoOf.set(k, value)
}

/** The nearest folder at or above the file that holds `.git`, else the file's own folder. */
async function repoRootOf($: EngineInterface, file: string): Promise<string> {
  const start = parentDir(fwd(file))
  const below: string[] = []
  let dir = start
  for (let i = 0; i < FILE_LEVELS; i++) {
    const key = normPath(dir)
    const known = repoOf.get(key)
    if (known !== undefined) {
      remember(below, known)
      return known
    }
    below.push(key)
    const entry = await $.fs.stat(`${dir}/.git`).catch(() => undefined)
    if (entry?.kind === 'dir' || entry?.kind === 'file') {
      remember(below, dir)
      return dir
    }
    const up = parentDir(dir)
    if (up === dir) break
    dir = up
  }
  remember([normPath(start)], start)
  return start
}

/** Where one edited file belongs: the temp folder, the project, or the repository it is in. */
export async function editPlace($: EngineInterface, file: string, w: Where): Promise<Place> {
  const temp = tempPlace(file)
  if (temp !== null) return { place: temp, kind: 'temp' }
  if (isUnder(file, w.root)) return { place: w.root, kind: 'inside' }
  return { place: await repoRootOf($, file), kind: 'outside' }
}
