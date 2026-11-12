import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { UPDATE_HEADER } from '../hooks/doclogic'
import { editedPath, isCodePath, isReviewText, unchangedDocs } from '../hooks/reviewlogic'

const NOW = Date.UTC(2026, 10, 12, 12)
const ROOT = 'C:/proj'
const REQ = 'docs/要件定義書_勤怠.xlsx'
const BASIC = 'docs/概要設計書_勤怠.xlsx'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

type World = {
  // Each doc's SHA256 by project-relative path ('a'×64 when not set).
  files: Record<string, string>
  messages: { role: 'user' | 'assistant'; text: string }[]
  submitted: string[]
  modelCalls: number
}

function world(): World {
  return { files: {}, messages: [{ role: 'user', text: '给勤怠申请画面加二级审批' }], submitted: [], modelCalls: 0 }
}

// Stands for the files, Python, the model and the prompt box beneath the plugin.
function engine(on: On, w: World) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const slash = (p: string) => p.replace(/\\/g, '/')
  const tree: Record<string, string[]> = { [`${ROOT}/docs`]: ['要件定義書_勤怠.xlsx', '概要設計書_勤怠.xlsx'] }
  on('session.cwd', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: w.messages.map(m => ({ toolUses: [], ...m })) as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: tree[slash(e.path)] !== undefined }))
  on('fs.list', (_, e) => ({
    value: (tree[slash(e.path)] ?? []).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[0] === 'git') return answer(0, `${ROOT}\n`)
    const paths = JSON.parse(e.init?.stdin ?? '[]') as string[]
    if ((e.argv[e.argv.length - 1] ?? '').endsWith('file_state.py')) {
      const states = Object.fromEntries(
        paths.map(p => [p, { sha256: w.files[p.slice(ROOT.length + 1)] ?? SHA_A, mtimeMs: NOW, size: 10 }]),
      )
      return answer(0, JSON.stringify(states))
    }
    return answer(0, JSON.stringify(Object.fromEntries(paths.map(p => [p, { sheets: [], text: '勤怠申請' }]))))
  })
  on('model.complete', (_, e) => {
    w.modelCalls++
    const ids = [...e.prompt.matchAll(/^\[(\d+)\]/gm)].map(m => ({ id: Number(m[1]), reason: '相关' }))
    return { value: { isAnswered: true, text: JSON.stringify({ links: ids }), usage: {} } as never }
  })
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') w.submitted.push(e.text)
    w.messages.push({ role: 'user', text: e.text })
    return { text: e.text } as never
  })
  // The engine's own start and end of a turn, beneath the plugin.
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  // Every edit succeeds unless its path says it fails.
  on('tool.call', (_, e) => {
    const failed = String((e as unknown as { file_path?: unknown }).file_path ?? '').includes('fails')
    return { result: { ok: !failed }, ...(failed ? { isError: true } : {}) } as never
  })
  return clock
}

const pane = {
  plugin: 'branch-status',
  component: 'Pane',
  requestId: 'doc-links',
  surface: 'desktop',
  props: {
    title: '关联文档',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const ask = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
const edit = (path: string) => ({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' }) as never
const turnEnd = (more: Record<string, unknown> = {}) =>
  ({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer', ...more }) as never

async function endTurn($: Engine, clock: { settle: () => Promise<void> }, more: Record<string, unknown> = {}) {
  await $.turn.complete(turnEnd(more))
  await clock.settle()
}

// The turn the session runs for a prompt: the update prompt, or the person's own words.
async function startTurn($: Engine, text: string) {
  await $.turn.start({ text, turnId: 'u' } as never)
}

test('a review, then code changed: the turn’s end links docs and hands Claude their update', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.prompt.submit(ask('帮我 review 一下审批的代码'))
  await $.tool.call(edit(`${ROOT}/src/approval.ts`))
  await endTurn($, clock)
  expect(w.modelCalls).toBe(1)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toContain(UPDATE_HEADER)
  expect(w.submitted[0]).toContain(REQ)
  expect(w.submitted[0]).toContain(BASIC)
})

test('after the update turn, a doc whose SHA256 did not move gets the 手动更新 button', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.prompt.submit(ask('code review 之后改一下'))
  await $.tool.call(edit(`${ROOT}/src/approval.ts`))
  await endTurn($, clock)

  // A question asked while the update prompt waits is not the update turn: nothing is verified.
  await startTurn($, '顺便问一下进度')
  await endTurn($, clock)
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ type: 'Text', text: /等 Claude 更新文档/ })) !== undefined).toBe(true)

  // Claude's update turn: only 要件定義書 changes.
  await startTurn($, w.submitted[0] ?? '')
  w.files[REQ] = SHA_B
  await endTurn($, clock)
  expect((await ui.find({ type: 'Text', text: /有 1 份文档的 SHA256 没有变化/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'doc-sync-retry' }))?.props.label).toBe('📝 手动更新这些文档（1）')

  await ui.press({ key: 'doc-sync-retry' })
  expect(w.submitted).toHaveLength(2)
  expect(w.submitted[1]).toContain(BASIC)
  expect(w.submitted[1]).not.toContain(REQ)

  // The retry turn changes it: verified, and the button is gone.
  await startTurn($, w.submitted[1] ?? '')
  w.files[BASIC] = SHA_B
  await endTurn($, clock)
  expect((await ui.find({ type: 'Text', text: /文档已更新：1 份的 SHA256 都已变化/ })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'doc-sync-retry' })).toBeUndefined()
  await ui.unmount()
})

test('without a review, a code change triggers nothing', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.prompt.submit(ask('给审批加一个字段'))
  await $.tool.call(edit(`${ROOT}/src/approval.ts`))
  await endTurn($, clock)
  expect(w.submitted).toEqual([])
  expect(w.modelCalls).toBe(0)
})

test('a review followed by doc edits only, a failed edit, or a subagent’s turn triggers nothing', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.prompt.submit(ask('请审查这段代码'))
  await $.tool.call(edit(`${ROOT}/docs/設計/memo.md`))
  await $.tool.call(edit(`${ROOT}/src/fails.ts`))
  await endTurn($, clock)
  expect(w.submitted).toEqual([])

  await $.tool.call(edit(`${ROOT}/src/approval.ts`))
  await endTurn($, clock, { agentId: 'a1' })
  expect(w.submitted).toEqual([])

  // The main loop's own turn end still sees the review and the code change.
  await endTurn($, clock)
  expect(w.submitted).toHaveLength(1)
})

test('one review triggers one update', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.prompt.submit(ask('review 一下'))
  await $.tool.call(edit(`${ROOT}/src/a.ts`))
  await endTurn($, clock)
  await endTurn($, clock)
  await $.tool.call(edit(`${ROOT}/src/b.ts`))
  await endTurn($, clock)
  expect(w.submitted).toHaveLength(1)
})

test('the review sync’s rules', () => {
  expect(isReviewText('帮我 review 一下')).toBe(true)
  expect(isReviewText('/mattpocock-skills:code-review')).toBe(true)
  expect(isReviewText('请审核')).toBe(true)
  expect(isReviewText('reviewer 的名字')).toBe(false)
  expect(isReviewText('加一个字段')).toBe(false)

  expect(editedPath('Edit', { file_path: 'C:/p/a.ts' })).toBe('C:/p/a.ts')
  expect(editedPath('NotebookEdit', { notebook_path: 'C:/p/n.ipynb' })).toBe('C:/p/n.ipynb')
  expect(editedPath('Read', { file_path: 'C:/p/a.ts' })).toBe('')

  expect(isCodePath('C:/p/src/a.ts')).toBe(true)
  expect(isCodePath('C:\\p\\docs\\x.ts')).toBe(false)
  expect(isCodePath('C:/p/.quality/docs/a.md')).toBe(false)
  expect(isCodePath('C:/p/README.md')).toBe(false)
  expect(isCodePath('C:/p/設計.xlsx')).toBe(false)

  const after = new Map<string, { sha256: string } | 'missing'>([
    ['a', { sha256: SHA_B }],
    ['b', { sha256: SHA_A }],
    ['c', 'missing'],
    ['e', { sha256: SHA_A }],
  ])
  expect(unchangedDocs({ a: SHA_A, b: SHA_A, c: SHA_A, d: SHA_A, e: '' }, after)).toEqual(['b', 'c', 'd'])
})
