// The doc pane's reach outside the module: the mod's Python scripts and the
// person's default app. Each runs only from a button press.
import type { EngineInterface } from 'claude-code'

import type { FileState } from '../types'
import { fullPath } from './doclogic'

export type Sensed = FileState | 'missing'

// No credential dialog or terminal prompt may hold a git call a pane makes.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }

export function runGit($: EngineInterface, cwd: string, args: string[], timeoutMs = 30_000) {
  return $.process.run(['git', ...args], { cwd, env: GIT_ENV, timeoutMs })
}

/** The repository's top level, or the session's folder outside a repository. */
export async function projectRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const top = await runGit($, cwd, ['rev-parse', '--show-toplevel'], 15_000).catch(() => undefined)
  return top?.exitCode === 0 ? top.stdout.trim() : cwd.replace(/\\/g, '/')
}

/** Runs one of the mod's scripts with JSON in and out; undefined when no Python answers. */
export async function runPython($: EngineInterface, cwd: string, script: string, input: unknown) {
  const path = `${$.plugin.root}/hooks/${script}`
  const init = { cwd, env: { PYTHONUTF8: '1' }, stdin: JSON.stringify(input), timeoutMs: 120_000 }
  for (const argv of [['python', '-I', path], ['py', '-3', '-I', path]]) {
    const ran = await $.process.run(argv, init).catch(() => undefined)
    if (ran?.exitCode !== 0) continue
    try {
      return JSON.parse(ran.stdout) as unknown
    } catch {
      return undefined
    }
  }
  return undefined
}

/** SHA256, modification time and size of each path (project-relative or absolute); undefined without Python. */
export async function senseFiles($: EngineInterface, root: string, paths: readonly string[]) {
  const sensed = new Map<string, Sensed>()
  if (paths.length === 0) return sensed
  const raw = (await runPython($, root, 'file_state.py', paths.map(p => fullPath(root, p)))) as
    | Record<string, { sha256?: string; mtimeMs?: number; size?: number; missing?: boolean }>
    | undefined
  if (raw === undefined) return undefined
  for (const p of paths) {
    const one = raw[fullPath(root, p)]
    if (one?.missing) sensed.set(p, 'missing')
    else if (one?.sha256) sensed.set(p, { sha256: one.sha256, mtimeMs: one.mtimeMs ?? 0, size: one.size ?? 0 })
  }
  return sensed
}

export type Opened = 'opened' | 'missing' | 'failed'

/**
 * Shows a document in its folder: Explorer opens the folder with the file selected
 * (Finder reveals it; elsewhere the folder opens). A file that is gone opens its folder.
 */
export async function revealInFolder($: EngineInterface, root: string, path: string): Promise<Opened> {
  const full = fullPath(root, path)
  const folder = full.replace(/\/[^/]+$/, '')
  const hasFile = await $.fs.exists(full).catch(() => false)
  if (!hasFile && !(await $.fs.exists(folder).catch(() => false))) return 'missing'
  const win = (p: string) => p.replace(/\//g, '\\')
  if (/^[A-Za-z]:/.test(full)) {
    // Windows keeps a window a background process opens behind the active one: the
    // mod's script opens Explorer and then brings that window to the front.
    const script = `${$.plugin.root}/hooks/reveal.ps1`
    const ran = await $.process
      .run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', win(full), '-Folder', win(folder)], {
        cwd: root,
        timeoutMs: 20_000,
      })
      .catch(() => undefined)
    const said = ran?.stdout.trim() ?? ''
    if (said === 'front' || said === 'opened') return 'opened'
    if (said === 'missing') return 'missing'
  }
  const candidates = /^[A-Za-z]:/.test(full)
    ? [hasFile ? ['explorer.exe', `/select,${win(full)}`] : ['explorer.exe', win(folder)]]
    : hasFile
      ? [['open', '-R', full], ['xdg-open', folder]]
      : [['open', folder], ['xdg-open', folder]]
  for (const argv of candidates) {
    // explorer.exe exits 1 even when it opened: having started is enough.
    const ran = await $.process.run(argv, { cwd: root, timeoutMs: 15_000 }).catch(() => undefined)
    if (ran !== undefined) return 'opened'
  }
  return 'failed'
}

/** Opens a document in the person's default app (Excel for a workbook). */
export async function openInApp($: EngineInterface, root: string, path: string): Promise<Opened> {
  const full = fullPath(root, path)
  // explorer.exe opens a folder in place of a file that is gone, and exits 1 either way:
  // only a file that exists is handed over, and having started is then success.
  if (!(await $.fs.exists(full).catch(() => false))) return 'missing'
  const candidates = /^[A-Za-z]:/.test(full)
    ? [['explorer.exe', full.replace(/\//g, '\\')]]
    : [['open', full], ['xdg-open', full]]
  for (const argv of candidates) {
    const ran = await $.process.run(argv, { cwd: root, timeoutMs: 15_000 }).catch(() => undefined)
    if (ran !== undefined) return 'opened'
  }
  return 'failed'
}
