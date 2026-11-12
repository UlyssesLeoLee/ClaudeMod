import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const band = (hasSurvey = false) =>
  ({
    plugin: 'dev-cockpit',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: {
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

function engine(on: On, opened: string[], registered: string[]) {
  mock.clock(on, { now: Date.UTC(2026, 10, 12, 12) })
  mock.store(on)
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => {
    throw new Error('not here')
  })
  on('fs.list', () => {
    throw new Error('not here')
  })
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
}

test('session start registers every feature’s command and opens the branch pane', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  engine(on, opened, registered)
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  expect([...registered].sort()).toEqual(['branch-status', 'doc-links', 'task-overview'])
  expect(opened).toEqual(['branch-status'])
})

test('the band holds one button per feature, each opening its pane', async ($, on) => {
  const opened: string[] = []
  engine(on, opened, [])
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  opened.length = 0
  const ui = await $.ui.mount(band())
  const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels).toEqual(['📋 任务概要', '📚 关联文档', '🌿 分支记录'])
  await ui.press({ key: 'open-overview' })
  await ui.press({ key: 'open-docs' })
  await ui.press({ key: 'open-branches' })
  expect(opened).toEqual(['task-overview', 'doc-links', 'branch-status'])
  await ui.unmount()
})

test('a survey above the prompt takes the band', async ($, on) => {
  engine(on, [], [])
  await $.session.start({ cwd: 'C:/proj', surface: 'desktop', isInteractive: true })
  // The mod hands the band on (next(e)); with nothing after it, nothing of the mod is drawn.
  const drawn = await $.ui.mount(band(true)).then(
    async ui => {
      const buttons = await ui.findAll({ type: 'Button' })
      await ui.unmount()
      return buttons.length > 0
    },
    () => false,
  )
  expect(drawn).toBe(false)
})
