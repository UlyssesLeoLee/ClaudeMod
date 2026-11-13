import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addEdit, editNotes, gitdirMain, isTempPath, isUnder, tempPlace, touchedPath, whereNotes } from '../hooks/core/where'
import type { EditPlace, Where } from '../types'

const TEMP_FILE = 'C:/Users/seiko/AppData/Local/Temp/claude/253ccfc04c8a289f/f6047c6f/scratchpad/fix.py'

test('a .git file tells a linked worktree from a submodule', () => {
  expect(gitdirMain('gitdir: C:/main/.git/worktrees/feat\n')).toEqual({ kind: 'worktree', main: 'C:/main' })
  expect(gitdirMain('gitdir: C:\\main\\.git\\worktrees\\feat\r\n')).toEqual({ kind: 'worktree', main: 'C:/main' })
  expect(gitdirMain('gitdir: /home/me/proj/.git/worktrees/x')).toEqual({ kind: 'worktree', main: '/home/me/proj' })
  // A path written relative is taken from the folder the .git file stands in.
  expect(gitdirMain('gitdir: ../main/.git/worktrees/x', 'C:/work/feat')).toEqual({ kind: 'worktree', main: 'C:/work/main' })
  expect(gitdirMain('gitdir: ../.git/modules/lib')).toEqual({ kind: 'submodule', main: null })
  expect(gitdirMain('hello')).toBeNull()
})

test('a path is under a folder only at a folder boundary', () => {
  expect(isUnder('C:/proj/src/a.ts', 'C:/proj')).toBe(true)
  expect(isUnder('C:/proj', 'C:/proj')).toBe(true)
  expect(isUnder('C:/proj2/a.ts', 'C:/proj')).toBe(false)
  expect(isUnder('c:\\PROJ\\src', 'C:/proj/')).toBe(true)
  expect(isUnder('C:/other', 'C:/proj')).toBe(false)
  expect(isUnder('/home/me', '/')).toBe(true)
})

const where = (over: Partial<Where>): Where => ({
  cwd: 'C:/proj',
  root: 'C:/proj',
  top: 'C:/proj',
  main: null,
  kind: 'repo',
  ...over,
})

test('the notes say where the session runs and what kind of place it is', () => {
  const texts = (w: Where) => whereNotes(w).map(n => `${n.tone}|${n.text}`)
  expect(texts(where({ top: null, kind: 'none' }))).toEqual([
    'info|📍 运行目录：C:/proj',
    'warn|   不是 Git 仓库：分支记录用不了；改动只存在于文件夹里，没有 Git 可以对照',
  ])
  expect(texts(where({}))).toEqual(['info|📍 运行目录：C:/proj', 'dim|   Git 仓库：C:/proj'])
  expect(texts(where({ cwd: 'C:/proj/docs/architecture' }))).toEqual([
    'info|📍 运行目录：C:/proj/docs/architecture',
    'dim|   项目根：C:/proj（终端已进入项目里的子文件夹）',
    'dim|   Git 仓库：C:/proj',
  ])
  expect(texts(where({ cwd: 'D:/elsewhere', top: null, kind: 'none' }))[1]).toBe(
    'warn|   ⚠ 项目根：C:/proj。运行目录不在它下面：命令和相对路径的改动落在运行目录，不在项目根',
  )
  expect(texts(where({ root: 'C:/proj/app' }))[2]).toBe('dim|   Git 仓库：C:/proj（项目根是它里面的子文件夹）')
  expect(texts(where({ root: 'D:/other' }))[2]).toBe('warn|   ⚠ Git 仓库：C:/proj（项目根不在这个仓库里）')
  expect(texts(where({ kind: 'worktree', main: 'C:/main' }))[1]).toBe(
    'warn|   ⚠ Git worktree：C:/proj（主工作区：C:/main）。本会话的改动在这个文件夹里，主工作区看不到，要合并回去',
  )
  expect(texts(where({ kind: 'submodule' }))[1]).toBe('dim|   Git 子模块：C:/proj')
})

test('the file an edit tool call changed, resolved against the working directory', () => {
  expect(touchedPath('Edit', { file_path: 'C:\\proj\\src\\a.ts' }, 'C:/proj')).toBe('C:/proj/src/a.ts')
  expect(touchedPath('Write', { file_path: '/home/me/a.ts' }, '/home/me')).toBe('/home/me/a.ts')
  expect(touchedPath('MultiEdit', { file_path: 'D:/x/b.ts' }, 'C:/proj')).toBe('D:/x/b.ts')
  expect(touchedPath('NotebookEdit', { notebook_path: 'C:/proj/n.ipynb' }, 'C:/proj')).toBe('C:/proj/n.ipynb')
  // A relative path is taken from the working directory, as the tool does.
  expect(touchedPath('Edit', { file_path: './src/a.ts' }, 'C:/proj/')).toBe('C:/proj/src/a.ts')
  expect(touchedPath('Edit', { file_path: 'a.ts' }, 'C:/proj/docs')).toBe('C:/proj/docs/a.ts')
  expect(touchedPath('Bash', { command: 'ls' }, 'C:/proj')).toBe('')
  expect(touchedPath('Read', { file_path: 'C:/proj/a.ts' }, 'C:/proj')).toBe('')
  expect(touchedPath('Edit', { file_path: '  ' }, 'C:/proj')).toBe('')
})

test('the session’s temp folder is told from project folders', () => {
  expect(isTempPath(TEMP_FILE)).toBe(true)
  expect(tempPlace(TEMP_FILE)).toBe('C:/Users/seiko/AppData/Local/Temp/claude/253ccfc04c8a289f/f6047c6f/scratchpad')
  expect(isTempPath('C:\\Users\\seiko\\AppData\\Local\\Temp\\claude\\aa\\bb\\scratchpad\\x.md')).toBe(true)
  expect(isTempPath('/private/tmp/claude-501/-proj/uuid/scratchpad/x.txt')).toBe(true)
  expect(isTempPath('C:/proj/src/a.ts')).toBe(false)
  expect(isTempPath('C:/other/temp/notes/scratchpad/x')).toBe(false)
  expect(isTempPath('C:/Users/seiko/AppData/Local/Temp/claude/aa/bb/other/x')).toBe(false)
})

test('edit places are counted, capped and said by kind', () => {
  let places: EditPlace[] = []
  places = addEdit(places, { place: 'C:/proj', kind: 'inside' }, 1)
  places = addEdit(places, { place: 'c:\\proj', kind: 'inside' }, 2)
  expect(places).toEqual([{ place: 'C:/proj', kind: 'inside', count: 2, lastMs: 2 }])
  // The same folder as another kind is a place of its own.
  places = addEdit(places, { place: 'C:/proj', kind: 'outside' }, 3)
  expect(places).toHaveLength(2)

  for (let i = 0; i < 6; i++) places = addEdit(places, { place: `D:/repo${i}`, kind: 'outside' }, 10 + i)
  expect(places).toHaveLength(6)
  // The place touched longest ago (C:/proj inside, at 2) was dropped first, then C:/proj outside.
  expect(places.some(p => p.place === 'C:/proj')).toBe(false)
  expect(places.map(p => p.place).sort()).toEqual(['D:/repo0', 'D:/repo1', 'D:/repo2', 'D:/repo3', 'D:/repo4', 'D:/repo5'])

  const said = editNotes([
    { place: 'C:/proj', kind: 'inside', count: 12, lastMs: 3 },
    { place: 'D:/repo', kind: 'outside', count: 3, lastMs: 9 },
    { place: 'C:/t/claude/a/b/scratchpad', kind: 'temp', count: 1, lastMs: 5 },
  ]).map(n => `${n.tone}|${n.text}`)
  expect(said).toEqual([
    'warn|⚠ D:/repo · 3 次（不在项目根下）',
    'dim|🗂 临时目录 C:/t/claude/a/b/scratchpad · 1 次（Claude 放中间文件的地方）',
    'info|✔ 项目内 C:/proj · 12 次',
  ])
})

// ---- the branch pane, with a faked file system and session ----

type Fs = Record<string, 'dir' | 'file'>
type World = {
  cwd: string
  root: string
  // `<folder>/.git` entries by lower-case path: a folder or a .git file.
  git: Fs
  gitFiles: Record<string, string>
  // While set, reading the working directory fails.
  cwdFails?: boolean
  processes: string[][]
  calls: { stat: string[] }
}

const slash = (p: string) => p.replace(/\\/g, '/')

function engine(on: On, w: World) {
  mock.clock(on, { now: Date.UTC(2026, 10, 12, 12) })
  mock.store(on)
  on('session.cwd', () => {
    if (w.cwdFails) throw new Error('no working directory')
    return { value: w.cwd }
  })
  on('session.root', () => ({ value: w.root }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.stat', (_, e) => {
    const p = slash(e.path)
    w.calls.stat.push(p)
    const kind = w.git[p.toLowerCase()]
    if (kind === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind, size: 1, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const text = w.gitFiles[slash(e.path).toLowerCase()]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => {
    w.processes.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Every tool call succeeds unless its path says it fails.
  on('tool.call', (_, e) => {
    const failed = String((e as unknown as { file_path?: unknown }).file_path ?? '').includes('fails')
    return { result: { ok: !failed }, ...(failed ? { isError: true } : {}) } as never
  })
}

const world = (over: Partial<World> = {}): World => ({
  cwd: 'C:/proj',
  root: 'C:/proj',
  git: {},
  gitFiles: {},
  processes: [],
  calls: { stat: [] },
  ...over,
})

const pane = {
  plugin: 'dev-cockpit',
  component: 'Pane',
  requestId: 'branch-status',
  surface: 'desktop',
  props: {
    title: '分支变更',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string }[]>; unmount: () => Promise<void> }
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const edit = (path: string) => ({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' }) as never
const write = (path: string) => ({ tool: 'Write', file_path: path, content: 'x' }) as never

test('the branch pane shows the path before any git runs, even outside a repository', async ($, on) => {
  const w = world({ cwd: 'D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL', root: 'D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL' })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane)
  const shown = await texts(ui)
  expect(shown).toContain('📍 运行目录：D:/OA_PARTNER_V40_UI_DOCS_MOCK_FINAL')
  expect(shown).toContain('   不是 Git 仓库：分支记录用不了；改动只存在于文件夹里，没有 Git 可以对照')
  // Nothing has been edited yet: no list of places.
  expect(shown.some(t => t.includes('本会话改过的文件落在'))).toBe(false)
  expect(w.processes).toEqual([])
  await ui.unmount()
})

test('a linked worktree is named with its main working tree', async ($, on) => {
  const w = world({
    cwd: 'C:/main/.claude/worktrees/feat/src',
    root: 'C:/main/.claude/worktrees/feat',
    git: { 'c:/main/.claude/worktrees/feat/.git': 'file' },
    gitFiles: { 'c:/main/.claude/worktrees/feat/.git': 'gitdir: C:/main/.git/worktrees/feat\n' },
  })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane)
  const shown = await texts(ui)
  expect(shown).toContain('📍 运行目录：C:/main/.claude/worktrees/feat/src')
  expect(shown).toContain(
    '   ⚠ Git worktree：C:/main/.claude/worktrees/feat（主工作区：C:/main）。本会话的改动在这个文件夹里，主工作区看不到，要合并回去',
  )
  expect(w.processes).toEqual([])
  await ui.unmount()
})

test('edits are recorded where they land: inside the project, in another repository, in the temp folder', async ($, on) => {
  const w = world({ git: { 'c:/proj/.git': 'dir', 'd:/tools/cockpit/.git': 'dir' } })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  await $.tool.call(edit('C:/proj/src/a.ts'))
  await $.tool.call(edit('C:\\proj\\src\\b.ts'))
  await $.tool.call(edit('D:/tools/cockpit/hooks/core/x.ts'))
  await $.tool.call(write(TEMP_FILE))
  // A failed edit counts nothing, and neither do tools that edit nothing.
  await $.tool.call(edit('C:/proj/src/fails.ts'))
  await $.tool.call({ tool: 'Bash', command: 'echo hi > out.txt' } as never)

  const ui = await $.ui.mount(pane)
  const shown = await texts(ui)
  expect(shown).toContain('本会话改过的文件落在：')
  expect(shown).toContain('  ✔ 项目内 C:/proj · 2 次')
  expect(shown).toContain('  ⚠ D:/tools/cockpit · 1 次（不在项目根下）')
  expect(shown).toContain(
    '  🗂 临时目录 C:/Users/seiko/AppData/Local/Temp/claude/253ccfc04c8a289f/f6047c6f/scratchpad · 1 次（Claude 放中间文件的地方）',
  )
  expect(shown).toContain('只统计 Edit/Write 类工具改的文件；用命令行（Bash）写的文件不在其中。')
  expect(shown.filter(t => t.includes('次'))).toHaveLength(3)
  expect(w.processes).toEqual([])
  await ui.unmount()
})

test('a working directory that cannot be read shows no path rather than a wrong one', async ($, on) => {
  const w = world({ cwdFails: true })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane)
  const shown = await texts(ui)
  expect(shown.some(t => t.includes('📍'))).toBe(false)
  expect(shown.some(t => t.includes('不是 Git 仓库'))).toBe(false)
  expect(w.processes).toEqual([])
  await ui.unmount()
})

test('a shell cd moves the shown working directory', async ($, on) => {
  const w = world({ git: { 'c:/proj/.git': 'dir' } })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount(pane)
  expect(await texts(ui)).toContain('📍 运行目录：C:/proj')
  await ui.unmount()

  w.cwd = 'C:/proj/docs/architecture'
  await $.tool.call({ tool: 'Bash', command: 'cd docs/architecture' } as never)
  ui = await $.ui.mount(pane)
  const shown = await texts(ui)
  expect(shown).toContain('📍 运行目录：C:/proj/docs/architecture')
  expect(shown).toContain('   项目根：C:/proj（终端已进入项目里的子文件夹）')
  expect(shown).toContain('   Git 仓库：C:/proj')
  await ui.unmount()
})
