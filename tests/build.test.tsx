import { expect, mock, test } from 'claude-code/testing'

const pane = {
  plugin: 'branch-status',
  component: 'Pane',
  requestId: 'branch-status',
  surface: 'desktop',
  props: {
    title: '分支变更',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const slash = (p: string) => p.replace(/\\/g, '/')

test('every pane ends with the version and code time the session loaded', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 12, 12) })
  mock.store(on)
  const loaded = new Date(2026, 10, 12, 17, 43).getTime()
  on('fs.read', (_, e) => {
    if (slash(e.path).endsWith('.claude-plugin/plugin.json')) return { value: '{"version":"9.9.9"}' }
    throw new Error('not here')
  })
  on('fs.list', (_, e) => {
    if (!slash(e.path).endsWith('/hooks')) throw new Error('not here')
    const at = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, size: 1, mtimeMs, isLink: false })
    return { value: [at('a.ts', loaded - 60_000), at('b.tsx', loaded)] }
  })
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  for (const requestId of ['branch-status', 'doc-links', 'task-overview']) {
    const ui = await $.ui.mount({ ...pane, requestId })
    expect((await ui.find({ type: 'Text', text: /^branch-status / }))?.text).toBe(
      'branch-status 9.9.9 · 代码 2026-11-12 17:43',
    )
    await ui.unmount()
  }
})
