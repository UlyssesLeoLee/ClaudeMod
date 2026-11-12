// Which code a session runs, and whether newer code waits on disk: read once at session
// start, shown at the foot of every pane, so a session running an older copy says so.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ResolveInput } from 'claude-code'

import type { Build } from '../../types'
import { fullTime } from './util'

export const MOD_NAME = 'dev-cockpit'
// How often a redraw may list the mod's files again to look for newer code.
export const STALE_CHECK_MS = 60_000
const CODE_FILE = /\.(tsx?|py|ps1|json)$/i
// loadedMs -1: the session start has not recorded the build yet.
const NOT_NOTED: Build = { version: '', loadedMs: -1 }

const build = atom({ plugin: 'dev-cockpit', key: 'modBuild' } as const, NOT_NOTED, { shape: 'modBuild-2' })

// The last look at the files on disk, reused between checks: a redraw lists nothing.
let lastCheck = { at: Number.NEGATIVE_INFINITY, newest: 0 }

/** The newest modification time of the mod's code files under `dir`, a few folders deep; 0 when none. */
async function newestCode($: EngineInterface, dir: string, depth = 0): Promise<number> {
  let newest = 0
  for (const entry of await $.fs.list(dir).catch(() => [])) {
    if (entry.isLink) continue
    if (entry.kind === 'dir' && depth < 3) {
      newest = Math.max(newest, await newestCode($, `${dir}/${entry.name}`, depth + 1))
    } else if (entry.kind === 'file' && CODE_FILE.test(entry.name)) {
      newest = Math.max(newest, entry.mtimeMs)
    }
  }
  return newest
}

/** The manifest's version and the newest code file's time, as this session loaded them. */
export async function noteBuild($: EngineInterface) {
  const root = $.plugin.root
  const manifest = await $.fs.read(`${root}/.claude-plugin/plugin.json`).catch(() => '')
  let version = ''
  try {
    version = String((JSON.parse(String(manifest)) as { version?: unknown }).version ?? '')
  } catch {
    // A manifest that can't be read leaves the version out.
  }
  const loadedMs = await newestCode($, `${root}/hooks`)
  lastCheck = { at: await $.clock.now(), newest: loadedMs }
  await update($, build, () => ({ version, loadedMs }))
}

/** The footer's line, and a notice when the files on disk are newer than what this session runs. */
export async function buildInfo($: EngineInterface): Promise<{ line: string; stale: string }> {
  const b = await read($, build)
  if (b.loadedMs < 0) return { line: '', stale: '' }
  const line = `${MOD_NAME} ${b.version || '?'} · 代码 ${b.loadedMs > 0 ? fullTime(b.loadedMs) : '未知'}`
  const now = await $.clock.now()
  if (now - lastCheck.at >= STALE_CHECK_MS) {
    // Marked before the listing, so panes drawing at once list the files once.
    lastCheck = { ...lastCheck, at: now }
    lastCheck = { at: now, newest: await newestCode($, `${$.plugin.root}/hooks`) }
  }
  const stale =
    b.loadedMs > 0 && lastCheck.newest > b.loadedMs
      ? `⚠ mod 代码已在 ${fullTime(lastCheck.newest)} 更新，本会话仍在用旧代码：重开会话后生效`
      : ''
  return { line, stale }
}

/** The foot every pane ends with: the build line, and the newer-code notice in yellow. */
export async function buildFooter($: EngineInterface, e: ResolveInput<'Pane'>) {
  const { Box, Text } = $.ui.resolve(e)
  const { line, stale } = await buildInfo($)
  if (line === '') return null
  return (
    <Box flexDirection="column" marginTop={1}>
      {stale !== '' && <Text color="yellow">{stale}</Text>}
      <Text dimColor>{line}</Text>
    </Box>
  )
}
