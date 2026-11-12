// Which code a session runs: read once at session start, shown at the foot of every
// pane, so a session that loaded an older copy is told apart at a glance.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { fullTime } from './logic'

const build = atom({ plugin: 'branch-status', key: 'modBuild' } as const, '', { shape: 'modBuild-1' })

/** The manifest's version and the newest file's time under hooks/, as this session loaded them. */
export async function noteBuild($: EngineInterface) {
  const root = $.plugin.root
  const manifest = await $.fs.read(`${root}/.claude-plugin/plugin.json`).catch(() => '')
  let version = ''
  try {
    version = String((JSON.parse(String(manifest)) as { version?: unknown }).version ?? '')
  } catch {
    // A manifest that can't be read leaves the version out.
  }
  const files = await $.fs.list(`${root}/hooks`).catch(() => [])
  const newest = Math.max(0, ...files.map(f => f.mtimeMs))
  const line = `branch-status ${version || '?'} · 代码 ${newest ? fullTime(newest) : '未知'}`
  await update($, build, () => line)
}

export function buildLine($: EngineInterface): Promise<string> {
  return read($, build)
}
