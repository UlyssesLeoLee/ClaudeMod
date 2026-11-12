import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { projectKey } from '../hooks/logic'
import {
  WBS_HEADER_ROW,
  buildCreatePrompt,
  capSummary,
  completion,
  fallbackSummary,
  localDate,
  parseWbs,
  unfinished,
} from '../hooks/wbs'

const NOW = Date.UTC(2026, 10, 12, 12)
const TODAY = localDate(NOW)
const ROOT = 'C:/proj'
const SURFACES = ['terminal', 'desktop'] as const

const WBS = [
  '# WBS',
  '',
  WBS_HEADER_ROW,
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 设计 | 张三 | | | | 10 | 50 | 进行中 |',
  '| 1.1 | 要件定义书 | 张三 | 2026-11-01 | 2026-11-03 | 2026-11-03 | 2 | 100 | 已完成 |',
  '| 1.2 | 机能设计书 | 李四 | 2026-11-04 | 2026-11-10 | | 4 | 50 | 进行中 |',
  '| 1.10 | 审批流程设计 | 王五 | 2026-11-20 | 2026-11-25 | | 2 | 0 | 未开始 |',
  '| 2 | 旧方案 | | | | | 3 | 0 | 已取消 |',
].join('\n')

type World = {
  // The WBS file's text, or undefined when docs/ has none; 'unreadable' makes the read fail.
  wbs: string | undefined
  answer: string | 'fail'
  calls: { fs: string[]; process: string[][]; model: string[]; submitted: string[] }
}

function world(over: Partial<World> = {}): World {
  return {
    wbs: WBS,
    answer: JSON.stringify({ summary: 'AI 写的概要：设计过半，机能设计书逾期。', mismatches: [] }),
    calls: { fs: [], process: [], model: [], submitted: [] },
    ...over,
  }
}

// Stands for the file system, git, the model and the prompt box; records every call.
function engine(on: On, w: World, stored: Record<string, never> = {}) {
  mock.clock(on, { now: NOW })
  mock.store(on, stored)
  const slash = (p: string) => p.replace(/\\/g, '/')
  on('session.cwd', () => ({ value: ROOT }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'task-overview' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.list', (_, e) => {
    w.calls.fs.push(`list ${slash(e.path)}`)
    const files = w.wbs === undefined ? [] : [{ name: 'WBS.md', kind: 'file' as const }]
    const entries = slash(e.path) === `${ROOT}/docs` ? [...files, { name: 'design', kind: 'dir' as const }] : []
    return { value: entries.map(x => ({ ...x, size: 1, mtimeMs: NOW - 3_600_000, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    w.calls.fs.push(`read ${slash(e.path)}`)
    if (w.wbs === 'unreadable') throw new Error('file is over 4 MiB')
    return { value: w.wbs ?? '' }
  })
  on('process.run', (_, e) => {
    w.calls.process.push([...e.argv])
    const answer = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const args = e.argv.slice(1)
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return answer(`${ROOT}\n`)
    if (args[0] === 'rev-parse') return answer('feature/approval\n')
    if (args[0] === 'log') return answer('abc1234 2026-11-11 机能设计书 审批部分\ndef5678 2026-11-09 要件定义书 定稿\n')
    if (args[0] === 'status') return answer(' M docs/design/机能设计书.md\n')
    return answer('')
  })
  on('model.complete', (_, e) => {
    w.calls.model.push(e.prompt)
    if (w.answer === 'fail') return { value: { isAnswered: false, reason: 'api-error', status: 500, error: {} } as never }
    return { value: { isAnswered: true, text: w.answer, usage: {} } as never }
  })
  on('prompt.submit', (_, e) => {
    w.calls.submitted.push(e.text)
    return { text: e.text } as never
  })
}

function pane(surface: (typeof SURFACES)[number]) {
  return {
    plugin: 'branch-status',
    component: 'Pane',
    requestId: 'task-overview',
    surface,
    props: {
      title: '任务概要',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  } as const
}

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string }[]> }
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const has = async (ui: Ui, part: string) => (await texts(ui)).some(t => t.includes(part))

test('nothing is read, run or asked before 生成概要 is pressed', async ($, on) => {
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await has(ui, '点「生成概要」')).toBe(true)
    await ui.unmount()
  }
  // Session start reads only the mod's own manifest, for the version line; no project file.
  const project = { ...w.calls, fs: w.calls.fs.filter(c => !c.includes('branch-status')) }
  expect(project).toEqual({ fs: [], process: [], model: [], submitted: [] })
})

test('completion counts leaves by 工数, leaves out 已取消, and lists open tasks overdue first', async ($, on) => {
  const w = world()
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'ov-run' })
    const all = await texts(ui)
    expect(all.some(t => t.startsWith('完成度 50%'))).toBe(true)
    expect(all).toContain('已完成 1/3 项 · 按工数加权')
    expect(all).toContain('未完成任务（2）')
    const open = all.filter(t => /^(⚠ 逾期 )?\d/.test(t))
    expect(open[0]).toBe('⚠ 逾期 1.2 机能设计书')
    expect(open[1]).toBe('1.10 审批流程设计')
    expect(all.some(t => t.includes('设计') && t.startsWith('1 '))).toBe(false)
    expect(all).toContain('AI 写的概要：设计过半，机能设计书逾期。')
    await ui.unmount()
  }
  // The project is read locally: log, status and branch, never a fetch.
  expect(w.calls.process.some(a => a.includes('fetch'))).toBe(false)
  expect(w.calls.model[0]).toContain('abc1234 2026-11-11 机能设计书 审批部分')
  expect(w.calls.model[0]).toContain('M docs/design/机能设计书.md')
})

test('a summary longer than 140 characters is cut, whatever the model says', async ($, on) => {
  const w = world({ answer: JSON.stringify({ summary: '进'.repeat(200), mismatches: [] }) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'ov-run' })
  const shown = (await texts(ui)).find(t => t.startsWith('进')) ?? ''
  expect([...shown].length).toBe(140)
  expect(shown.endsWith('…')).toBe(true)
  expect(await has(ui, 'AI 概要 · 140/140 字')).toBe(true)
  await ui.unmount()
})

test('without the model, the summary comes from the numbers, within 140, and says so', async ($, on) => {
  const w = world({ answer: 'fail' })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'ov-run' })
  expect(await has(ui, 'AI 核对失败（api-error）')).toBe(true)
  expect(await has(ui, '完成度 50%（按工数加权），已完成 1/3 项，未完成 2 项，其中逾期 1 项。')).toBe(true)
  expect(await has(ui, '按统计生成')).toBe(true)
  await ui.unmount()
})

test('only mismatches naming a task of the WBS, of a known kind, are shown', async ($, on) => {
  const w = world({
    answer: JSON.stringify({
      summary: '概要',
      mismatches: [
        { id: '1.10', kind: 'changed-but-not-updated', note: '已有审批相关提交' },
        { id: '9.9', kind: 'done-without-change', note: '编造的编号' },
        { id: '1.1', kind: 'something-else', note: '编造的种类' },
      ],
    }),
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'ov-run' })
  const all = await texts(ui)
  expect(all).toContain('需要核对（AI 判断，仅供参考）（1）')
  expect(all.some(t => t.includes('1.10 审批流程设计：已有相关改动，但 WBS 没更新——已有审批相关提交'))).toBe(true)
  expect(all.some(t => t.includes('编造'))).toBe(false)
  await ui.unmount()
})

test('without a WBS, 新建 asks first, looks again, and sends only the fixed prompt', async ($, on) => {
  const w = world({ wbs: undefined })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'ov-run' })
  expect(await has(ui, '项目里没有 docs/WBS.md')).toBe(true)
  expect(w.calls.model).toEqual([])

  await ui.press({ key: 'ov-create' })
  await ui.press({ key: 'ov-create-cancel' })
  expect(w.calls.submitted).toEqual([])

  await ui.press({ key: 'ov-create' })
  await ui.press({ key: 'ov-create-confirm' })
  expect(w.calls.submitted).toEqual([buildCreatePrompt()])
  expect(await has(ui, '已把新建 docs/WBS.md 交给 Claude')).toBe(true)

  // A WBS that appeared meanwhile is never overwritten: nothing is sent.
  w.wbs = WBS
  await ui.press({ key: 'ov-create' })
  await ui.press({ key: 'ov-create-confirm' })
  expect(w.calls.submitted).toHaveLength(1)
  expect(await has(ui, 'docs/WBS.md 已经存在，没有发出新建指令')).toBe(true)
  await ui.unmount()
})

const KEPT = {
  at: NOW - 86_400_000,
  root: ROOT,
  wbsPath: 'docs/WBS.md',
  wbsMtime: NOW - 90_000_000,
  tasks: [],
  percent: 40,
  byEffort: false,
  done: 2,
  total: 5,
  summary: '昨天的概要',
  isAiSummary: true,
  mismatches: [],
  warnings: [],
  error: '',
}

test('an overview comes back in a later session without running anything', async ($, on) => {
  const w = world()
  engine(on, w, { [projectKey('overview', ROOT)]: KEPT as never })
  const ui = await $.ui.mount(pane('desktop'))
  expect(await has(ui, '昨天的概要')).toBe(true)
  expect(await has(ui, '上次统计 1天前')).toBe(true)
  expect(w.calls).toEqual({ fs: [], process: [], model: [], submitted: [] })
  await ui.unmount()
})

test('a run that fails keeps the last good overview and says why', async ($, on) => {
  const w = world({ wbs: 'unreadable' })
  engine(on, w, { [projectKey('overview', ROOT)]: KEPT as never })
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'ov-run' })
  expect(await has(ui, '读不到 docs/WBS.md')).toBe(true)
  expect(await has(ui, '昨天的概要')).toBe(true)
  await ui.unmount()
})

test('the table the create prompt asks for reads back with every column', () => {
  const table = buildCreatePrompt()
    .split('\n')
    .filter(line => line.startsWith('|'))
    .join('\n')
  const parsed = parseWbs(table)
  expect(parsed.warnings).toEqual([])
  expect(parsed.tasks).toEqual([
    {
      id: '1.1',
      name: '要件定义书评审',
      owner: '张三',
      start: '2026-11-01',
      due: '2026-11-05',
      finished: '2026-11-04',
      effort: 2,
      progress: 100,
      status: '已完成',
      isLeaf: true,
    },
  ])
})

test('a hand-edited WBS still reads: CRLF, BOM, loose pipes, full-width headers, 40%, slashes', () => {
  const text = [
    '\uFEFF编号 | 任务名 | 担当 | 期限 | 工数（人日） | 进度 | 状态',
    ':--- | --- | --- | ---: | --- | --- | ---',
    '1 | 登录 \\| 注册 | 张三 | 2026/11/5 | 3 | 40% | 进行中',
    '2 | 报表 | 李四 | | 2 | | 完了',
    '3 | 导出 | | | 1 | 30 | 未着手',
    '4 | 搜索 | | | 1 | 40 | 已完成',
    '5 | 通知 | | | 1 | abc | 进行中',
    '6 | 打印 | | | 1 | 0 | 搁置',
  ].join('\r\n')
  const { tasks, warnings } = parseWbs(text)
  expect(tasks.map(t => [t.id, t.name, t.due, t.progress, t.status])).toEqual([
    ['1', '登录 | 注册', '2026-11-05', 40, '进行中'],
    ['2', '报表', '', 100, '已完成'],
    ['3', '导出', '', 30, '未开始'],
    ['4', '搜索', '', 40, '已完成'],
    ['5', '通知', '', 0, '进行中'],
    ['6', '打印', '', 0, '未开始'],
  ])
  expect(warnings).toEqual([
    '第 5 行（3）状态是未开始，进度却是 30%。',
    '第 6 行（4）状态是已完成，进度却是 40%。',
    '第 7 行（5）的进度「abc」不是 0–100 的数，按 0 计。',
    '第 8 行（6）的状态「搁置」不认识，按进度推断。',
  ])
})

test('counting rules: 1.10 is no child of 1.1, unweighted without full 工数, nothing to count', () => {
  const rows = (lines: string[]) => parseWbs([WBS_HEADER_ROW, ...lines].join('\n')).tasks
  const tree = rows(['| 1.1 | a | | | | | 1 | 100 | 已完成 |', '| 1.10 | b | | | | | 1 | 0 | 未开始 |'])
  expect(tree.map(t => t.isLeaf)).toEqual([true, true])

  const mixed = rows(['| 1 | a | | | | | 3 | 100 | 已完成 |', '| 2 | b | | | | | | 50 | 进行中 |', '| 3 | c | | | | | 1 | 30 | 进行中 |'])
  expect(completion(mixed)).toEqual({ percent: 60, byEffort: false, done: 1, total: 3 })

  const none = rows(['| 1 | a | | | | | 1 | 0 | 已取消 |'])
  expect(completion(none)).toEqual({ percent: null, byEffort: false, done: 0, total: 0 })
  expect(fallbackSummary(completion(none), unfinished(none, TODAY), TODAY)).toBe('WBS 里还没有可统计的任务。')
})

test('the cap counts characters, not UTF-16 units', () => {
  const emoji = '🚀'.repeat(150)
  const cut = capSummary(emoji)
  expect([...cut].length).toBe(140)
  expect(capSummary('  短的\n概要  ')).toBe('短的 概要')
})
