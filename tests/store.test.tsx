import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ancestors, fullPath, isAbsolutePath, projectKey } from '../hooks/core/util'

const NOW = Date.UTC(2026, 10, 12, 10)
const HOUR = 3_600_000

type Entry = { name: string; kind: 'file' | 'dir' }
const file = (name: string): Entry => ({ name, kind: 'file' })
const dir = (name: string): Entry => ({ name, kind: 'dir' })

type World = {
  root: string
  cwd: string
  tree: Record<string, Entry[]>
  store: Record<string, unknown>
  // Paths the model links, with the kind it gives each.
  picks: Record<string, string>
  process: string[][]
}

const slash = (p: string) => p.replace(/\\/g, '/')

// Stands for git, the file system, Python, the model and the store; records processes.
function engine(on: On, w: World) {
  mock.clock(on, { now: NOW })
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'はい、揃える', toolUses: [] }] as never }))
  on('fs.list', (_, e) => {
    const listed = w.tree[slash(e.path)]
    if (listed === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: listed.map(x => ({ ...x, size: 1, mtimeMs: NOW - HOUR, isLink: false })) }
  })
  on('fs.exists', (_, e) => {
    const p = slash(e.path)
    const cut = p.lastIndexOf('/')
    return { value: w.tree[p] !== undefined || (w.tree[p.slice(0, cut)] ?? []).some(x => x.name === p.slice(cut + 1)) }
  })
  on('fs.read', () => ({ value: '# 文書' }))
  on('process.run', (_, e) => {
    w.process.push([...e.argv])
    const answer = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[0] === 'git') return answer(`${w.root}\n`)
    const paths = JSON.parse(e.init?.stdin ?? '[]') as string[]
    return answer(JSON.stringify(Object.fromEntries(paths.map(p => [p, { sha256: 'a'.repeat(64), mtimeMs: NOW, size: 9 }]))))
  })
  on('model.complete', (_, e) => {
    const ids = new Map<string, number>()
    for (const m of e.prompt.matchAll(/^\[(\d+)\] \((\w+|\?)\) (.+)$/gm)) ids.set(m[3] ?? '', Number(m[1]))
    const links = Object.entries(w.picks).map(([path, kind]) => ({ id: ids.get(path) ?? -1, kind, reason: '相关' }))
    return { value: { isAnswered: true, text: JSON.stringify({ links }), usage: {} } as never }
  })
}

const pane = (requestId: string) =>
  ({
    plugin: 'dev-cockpit',
    component: 'Pane',
    requestId,
    surface: 'desktop',
    props: {
      title: requestId,
      isFocused: false,
      bodyColumns: 100,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
  }) as const

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string }[]> }
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text)

const link = (path: string, kind = 'req') => {
  const state = { sha256: 'a'.repeat(64), mtimeMs: NOW - HOUR, size: 9 }
  return { kind, path, reason: '相关', base: state, now: state, isMissing: false }
}
const result = (at: number, task: string, paths: string[]) => ({
  at,
  checkedAt: at,
  root: 'C:/proj',
  task,
  found: paths.length,
  warnings: [],
  error: '',
  links: paths.map(p => link(p)),
})

function world(over: Partial<World> = {}): World {
  return { root: 'C:/proj', cwd: 'C:/proj', tree: {}, store: {}, picks: {}, process: [], ...over }
}

test('a path’s ancestors run up to its root', () => {
  expect(ancestors(String.raw`D:\OA-Partner\docs\architecture`)).toEqual([
    'd:/oa-partner/docs/architecture',
    'd:/oa-partner/docs',
    'd:/oa-partner',
    'd:/',
  ])
  expect(ancestors('/home/me/proj')).toEqual(['/home/me/proj', '/home/me', '/home', '/'])
  expect(ancestors('C:/')).toEqual(['c:/'])
  expect(ancestors('')).toEqual([])
  expect(fullPath('C:/p', 'docs/a.md')).toBe('C:/p/docs/a.md')
  expect(fullPath('C:/p', 'D:/x/a.md')).toBe('D:/x/a.md')
  expect(isAbsolutePath(String.raw`\\server\share\a.md`)).toBe(true)
  expect(isAbsolutePath('docs/a.md')).toBe(false)
  expect(projectKey('docLinks', 'D:\\OA-Partner\\')).toBe('docLinks:d:/oa-partner')
})

test('a result saved for the project is found from a subfolder', async ($, on) => {
  const w = world({
    cwd: 'C:/proj/docs/architecture',
    store: { 'docLinks:c:/proj': result(NOW - HOUR, '旧任务', ['docs/a.md', 'docs/b.md']) },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('doc-links'))
  expect((await texts(ui)).some(t => t.includes('关联 2 份'))).toBe(true)
  expect(w.process).toEqual([])
  await ui.unmount()
})

test('the latest result among the folders above wins', async ($, on) => {
  const w = world({
    cwd: 'C:/proj/docs/x',
    store: {
      'docLinks:c:/proj': result(NOW - 2 * HOUR, '项目根的任务', ['docs/a.md']),
      'docLinks:c:/proj/docs': result(NOW - HOUR, '较新的任务', ['docs/a.md', 'docs/b.md']),
      // Of another shape: skipped, though nearest.
      'docLinks:c:/proj/docs/x': { at: NOW, links: 'broken' },
    },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('doc-links'))
  const shown = await texts(ui)
  expect(shown.some(t => t.includes('任务：较新的任务'))).toBe(true)
  await ui.unmount()
})

test('a new result is kept under the project’s root', async ($, on) => {
  const w = world({
    cwd: 'C:/proj/docs',
    tree: { 'C:/proj': [dir('docs')], 'C:/proj/docs': [file('要件定義書.md')], 'C:/': [dir('proj')] },
    picks: { 'docs/要件定義書.md': 'req' },
  })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('doc-links'))
  await ui.press({ key: 'doc-link' })
  expect(Object.keys(w.store).filter(k => k.startsWith('docLinks:'))).toEqual(['docLinks:c:/proj'])
  await ui.unmount()
})

test('an overview saved for the project is found from a subfolder', async ($, on) => {
  const w = world({
    cwd: 'C:/proj/src',
    store: {
      'overview:c:/proj': {
        at: NOW - HOUR, root: 'C:/proj', wbsPath: 'docs/WBS.md', wbsMtime: NOW - HOUR, tasks: [],
        percent: 40, byEffort: false, done: 2, total: 5, summary: '项目根保存的概要', isAiSummary: true,
        mismatches: [], warnings: [], error: '',
      },
    },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('task-overview'))
  expect((await texts(ui)).some(t => t.includes('项目根保存的概要'))).toBe(true)
  expect(w.process).toEqual([])
  await ui.unmount()
})

// The layout of a project whose test designs sit in another folder beside it.
const PROJECT = 'D:/OA-Partner'
const V40 = 'D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL/docs'
const JA = `${PROJECT}/docs/architecture/docs/ja-JP`
const UT = `${V40}/04_unit-test/UT-V40-01_mfg-unit-test-design.md`
const IT = `${V40}/05_integration-test/IT-V40-01_mfg-integration-test-design.md`
const ST = `${V40}/06_system-test/ST-V40-01_mfg-system-test-design.md`

test('a session inside a subfolder links the project’s test designs from its extra folder', async ($, on) => {
  const w = world({
    root: PROJECT,
    cwd: `${PROJECT}/docs/architecture`,
    store: { 'docFolders:d:/oa-partner': [V40] },
    tree: {
      [PROJECT]: [dir('docs'), dir('src')],
      [`${PROJECT}/docs`]: [dir('architecture')],
      [`${PROJECT}/docs/architecture`]: [file('README.md'), dir('docs')],
      [`${PROJECT}/docs/architecture/docs`]: [dir('ja-JP')],
      [JA]: [file('01_要件定義.md'), file('02_基本設計.md'), file('03_詳細設計.md'), file('09_テスト設計.md')],
      'D:/': [dir('OA-Partner'), dir('OA-Partner_mock'), dir('OA_PARTNER_V40_UI_DOCS_MOCK_FINAL'), dir('Windows')],
      'D:/OA-Partner_mock': [dir('docs')],
      'D:/OA-Partner_mock/docs': [file('mock-notes.md')],
      'D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL': [dir('docs')],
      [V40]: [dir('01_requirements'), dir('04_unit-test'), dir('05_integration-test'), dir('06_system-test')],
      [`${V40}/01_requirements`]: [file('RD-V40-01_requirements-definition.md')],
      [`${V40}/04_unit-test`]: [file('UT-V40-01_mfg-unit-test-design.md')],
      [`${V40}/05_integration-test`]: [file('IT-V40-01_mfg-integration-test-design.md')],
      [`${V40}/06_system-test`]: [file('ST-V40-01_mfg-system-test-design.md')],
    },
    // As in the run that missed them: the model links the project's own design set only.
    picks: {
      'docs/architecture/docs/ja-JP/01_要件定義.md': 'req',
      'docs/architecture/docs/ja-JP/09_テスト設計.md': 'st',
    },
  })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('doc-links'))
  await ui.press({ key: 'doc-link' })

  // Folded: kinds and counts, no document name.
  const folded = await texts(ui)
  expect(folded.some(t => t.includes('UT 测试设计（1）'))).toBe(true)
  expect(folded.some(t => t.includes('IT 测试设计（1）'))).toBe(true)
  expect(folded.some(t => /\.md\b/.test(t))).toBe(false)

  await ui.press({ key: 'doc-kind-ut' })
  await ui.press({ key: 'doc-kind-it' })
  expect(await ui.find({ type: 'Button', key: `doc-open-${UT}` })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `doc-open-${IT}` })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `doc-open-${ST}` })).toBeUndefined()

  const kept = w.store['docLinks:d:/oa-partner'] as { links: { kind: string; path: string }[] } | undefined
  expect(kept?.links.filter(l => l.kind === 'ut' || l.kind === 'it').map(l => l.path)).toEqual([UT, IT])
  expect(w.store['docLinks:d:/oa-partner/docs/architecture']).toBeUndefined()
  await ui.unmount()
})
