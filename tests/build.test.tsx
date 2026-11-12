import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const pane = (requestId: string) =>
  ({
    plugin: 'dev-cockpit',
    component: 'Pane',
    requestId,
    surface: 'desktop',
    props: {
      title: requestId,
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

const PANES = ['branch-status', 'doc-links', 'task-overview']
const slash = (p: string) => p.replace(/\\/g, '/')
const LOADED = new Date(2026, 10, 12, 17, 43).getTime()

type Entry = { name: string; kind: 'file' | 'dir'; mtimeMs: number }
type Mod = {
  manifest: string | undefined
  // Folder under hooks/ ('' for hooks itself) → its entries; undefined: hooks/ can't be listed.
  hooks: Record<string, Entry[]> | undefined
  now: number
  lists: number
}

const file = (name: string, mtimeMs: number): Entry => ({ name, kind: 'file', mtimeMs })
const dir = (name: string): Entry => ({ name, kind: 'dir', mtimeMs: 0 })

function mod(over: Partial<Mod> = {}): Mod {
  return {
    manifest: '{"version":"9.9.9"}',
    hooks: {
      '': [file('main.tsx', LOADED - 120_000), file('hooks.json', LOADED - 300_000), dir('core'), dir('doclinks')],
      core: [file('build.tsx', LOADED), dir('scripts')],
      'core/scripts': [file('file_state.py', LOADED - 600_000)],
      doclinks: [file('pane.tsx', LOADED - 60_000), file('NOTES.md', LOADED + 3_600_000)],
    },
    now: Date.UTC(2026, 10, 12, 9, 50),
    lists: 0,
    ...over,
  }
}

// Stands for the mod's own files and the clock; nothing of a project is touched.
function engine(on: On, m: Mod) {
  mock.store(on)
  on('clock.now', () => ({ value: m.now }))
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (slash(e.path).endsWith('/.claude-plugin/plugin.json') && m.manifest !== undefined) return { value: m.manifest }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.list', (_, e) => {
    const at = /\/hooks(?:\/(.*))?$/.exec(slash(e.path))
    const listed = at && m.hooks ? m.hooks[at[1] ?? ''] : undefined
    if (listed === undefined) throw new Error(`ENOENT: ${e.path}`)
    m.lists++
    return { value: listed.map(x => ({ ...x, size: 1, isLink: false })) }
  })
}

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string }[]>; unmount: () => Promise<void> }
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text)

test('every pane ends with the version and code time the session loaded', async ($, on) => {
  const m = mod()
  engine(on, m)
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  for (const requestId of PANES) {
    const ui = await $.ui.mount(pane(requestId))
    const shown = await texts(ui)
    // The newest code file counts: a newer note (.md) is no code.
    expect(shown).toContain('dev-cockpit 9.9.9 · 代码 2026-11-12 17:43')
    expect(shown.some(t => t.includes('重开会话'))).toBe(false)
    await ui.unmount()
  }
})

test('newer code on disk is reported in every pane', async ($, on) => {
  const m = mod()
  engine(on, m)
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  const changed = new Date(2026, 10, 12, 18, 5).getTime()
  m.hooks!['doclinks'] = [file('pane.tsx', changed)]
  m.now += 61_000
  for (const requestId of PANES) {
    const ui = await $.ui.mount(pane(requestId))
    const shown = await texts(ui)
    expect(shown).toContain('⚠ mod 代码已在 2026-11-12 18:05 更新，本会话仍在用旧代码：重开会话后生效')
    expect(shown).toContain('dev-cockpit 9.9.9 · 代码 2026-11-12 17:43')
    await ui.unmount()
  }
})

test('the newer-code check lists files at most once a minute', async ($, on) => {
  const m = mod()
  engine(on, m)
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  const atStart = m.lists
  m.hooks!['doclinks'] = [file('pane.tsx', LOADED + 600_000)]
  m.now += 59_000
  const ui = await $.ui.mount(pane('doc-links'))
  expect((await texts(ui)).some(t => t.includes('重开会话'))).toBe(false)
  expect(m.lists).toBe(atStart)
  await ui.unmount()
  m.now += 2_000
  const again = await $.ui.mount(pane('doc-links'))
  expect((await texts(again)).some(t => t.includes('重开会话'))).toBe(true)
  expect(m.lists).toBeGreaterThan(atStart)
  await again.unmount()
})

test('an unreadable manifest or folder still gives a footer', async ($, on) => {
  const m = mod({ manifest: 'not json', hooks: undefined })
  engine(on, m)
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  m.now += 120_000
  const ui = await $.ui.mount(pane('task-overview'))
  const shown = await texts(ui)
  expect(shown).toContain('dev-cockpit ? · 代码 未知')
  expect(shown.some(t => t.includes('重开会话'))).toBe(false)
  await ui.unmount()
})
