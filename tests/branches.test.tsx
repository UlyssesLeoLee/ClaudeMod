import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BUILT_IN_PROTECTED, canRevert, detectAi, parseBranchInput, parseWorktrees, protectedBranches } from '../hooks/branches/logic'
import { relTime } from '../hooks/core/util'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 12, 12)
const ME = 'me@corp.com'
const SURFACES = ['terminal', 'desktop'] as const

type Fake = {
  sha: string
  author?: string
  email?: string
  daysAgo: number
  body?: string
  isMerge?: boolean
}
type World = {
  isRepo: boolean
  fetchOk: boolean
  me: string
  refs: string[]
  logs: Record<string, Fake[]>
  // What each merge (by its fake sha name) brought in from its second parent.
  merged: Record<string, Fake[]>
  // The worktrees, main first; C:/repo is the session's own.
  trees: Tree[]
  calls: string[][]
  // Pane ids the mod opened.
  opened: string[]
  // While set, `git fetch` waits for it: a query the test holds mid-run.
  gate?: Promise<void>
  // What `git show` answers: the files a commit changed, and file text by `<rev>:<path>`.
  show?: { files: string[]; texts: Record<string, string> }
}
type Tree = {
  path: string
  head: string
  branch?: string
  locked?: boolean
  prunable?: boolean
  dirty?: string[]
  unmerged?: string[]
  // Commits only a detached HEAD holds, and paths git ignores.
  orphaned?: string[]
  ignored?: string[]
  // `git log` in this tree fails.
  logFails?: boolean
}

function world(over: Partial<World> = {}): World {
  return {
    isRepo: true,
    fetchOk: true,
    me: ME,
    refs: ['refs/remotes/origin/master', 'refs/remotes/origin/develop', 'refs/heads/master'],
    logs: { 'origin/master': [], 'origin/develop': [] },
    merged: {},
    trees: [
      { path: 'C:/repo', head: 'aaa', branch: 'develop' },
      { path: 'C:/wt/feature-x', head: 'bbb', branch: 'feature/x', locked: true },
      { path: 'C:/wt/old', head: 'ccc', prunable: true },
    ],
    calls: [],
    opened: [],
    ...over,
  }
}

function porcelain(trees: Tree[]): string {
  return trees
    .map(t =>
      [
        `worktree ${t.path}`,
        `HEAD ${sha(t.head)}`,
        t.branch ? `branch refs/heads/${t.branch}` : 'detached',
        ...(t.locked ? ['locked'] : []),
        ...(t.prunable ? ['prunable gitdir file points to non-existent location'] : []),
      ].join('\n') + '\n\n',
    )
    .join('')
}

const sha = (s: string) => s.padEnd(40, '0')

function record(c: Fake): string {
  const author = c.author ?? 'Me'
  const email = c.email ?? ME
  const ct = String(Math.floor((NOW - c.daysAgo * DAY) / 1000))
  const parents = c.isMerge ? 'p1 p2' : 'p1'
  const subject = `change ${c.sha}`
  return (
    [sha(c.sha), sha(c.sha).slice(0, 7), parents, author, email, author, email, ct, subject,
      `${subject}\n\n${c.body ?? ''}`].join('\x1f') + '\x1e\n'
  )
}

const AI_TRAILER = 'Co-Authored-By: Claude Opus <noreply@anthropic.com>'

// Stands for git: answers each argv from the world and records it.
function fakeGit(on: On, w: World) {
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', async (_, e) => {
    const argv = e.argv.slice(1)
    if (argv[0] === 'fetch' && w.gate) await w.gate
    w.calls.push([...argv])
    const args = argv[0] === '-C' ? argv.slice(2) : argv
    const inTree = argv[0] === '-C' ? w.trees.find(t => t.path === argv[1]) : undefined
    const answer = (exitCode: number, stdout = '', stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const all = [...Object.values(w.logs), ...Object.values(w.merged)].flat()
    const shown = args[0] === '-c' ? args.slice(2) : args
    if (shown[0] === 'show') {
      if (shown.includes('--name-only')) return answer(0, (w.show?.files ?? []).map(f => `${f}\n`).join(''))
      const text = w.show?.texts[shown[1] ?? '']
      return text === undefined ? answer(128, '', 'fatal: path does not exist') : answer(0, text)
    }
    switch (args[0]) {
      case 'rev-parse':
        if (args[1] === '--show-toplevel') {
          return w.isRepo ? answer(0, 'C:/repo\n') : answer(128, '', 'fatal: not a git repository')
        }
        if (args[1] === '--path-format=absolute') return answer(0, '/repo/.git\n')
        return answer(0)
      case 'fetch':
        return w.fetchOk ? answer(0) : answer(128, '', 'fatal: could not read from remote')
      case 'config':
        return answer(0, `${w.me}\n`)
      case 'for-each-ref':
        if (args[1] === '--format=%(refname:short)') return answer(0, 'master\norigin/master\norigin/develop\n')
        return answer(0, w.refs.join('\n') + '\n')
      case 'status': {
        const ignored = (inTree?.ignored ?? []).map(p => `!! ${p}`)
        return answer(0, [...(inTree?.dirty ?? []), ...ignored].map(l => `${l}\n`).join(''))
      }
      case 'log': {
        if (args.includes('HEAD')) {
          if (inTree?.logFails) return answer(128, '', 'fatal: bad object HEAD')
          const lines = args.includes('--branches') ? inTree?.orphaned : inTree?.unmerged
          return answer(0, (lines ?? []).map(l => `${l}\n`).join(''))
        }
        const ref = args[args.length - 2] ?? ''
        if (args.includes('-1')) {
          const one = all.find(c => sha(c.sha) === ref)
          return answer(0, one ? record(one) : '')
        }
        if (ref.includes('^1..')) {
          const name = Object.keys(w.merged).find(n => ref.startsWith(sha(n)))
          return answer(0, (name ? (w.merged[name] ?? []) : []).map(record).join(''))
        }
        // As git: newest first, `-N` / `--max-count` cut, `--since=@<seconds>` by commit time.
        const since = args.find(a => a.startsWith('--since=@'))
        const from = since ? Number(since.slice('--since=@'.length)) * 1000 : -Infinity
        const count = args.find(a => /^-\d+$/.test(a) || a.startsWith('--max-count='))
        const max = count ? Number(count.replace('--max-count=', '').replace('-', '')) : Infinity
        const commits = (w.logs[ref] ?? []).filter(c => NOW - c.daysAgo * DAY >= from).slice(0, max)
        return answer(0, commits.map(record).join(''))
      }
      case 'ls-remote':
        return answer(2)
      case 'worktree': {
        if (args[1] === 'list') return answer(0, porcelain(w.trees))
        if (args[1] === 'prune') {
          w.trees = w.trees.filter(t => !t.prunable)
          return answer(0)
        }
        if (args[1] === 'remove') {
          // As git does: a locked tree is refused, a dirty one needs --force.
          const path = args[args.length - 1]
          const tree = w.trees.find(t => t.path === path)
          if (tree?.locked) return answer(128, '', 'fatal: cannot remove a locked working tree')
          if (tree?.dirty?.length && !args.includes('--force')) {
            return answer(128, '', 'fatal: contains modified or untracked files, use --force to delete it')
          }
          w.trees = w.trees.filter(t => t.path !== path)
          return answer(0)
        }
        return answer(0)
      }
      default:
        return answer(0)
    }
  })
}

function pane(surface: (typeof SURFACES)[number]) {
  return {
    plugin: 'dev-cockpit',
    component: 'Pane',
    requestId: 'branch-status',
    surface,
    props: {
      title: '分支变更',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  } as const
}

function band(surface: (typeof SURFACES)[number]) {
  return {
    plugin: 'dev-cockpit',
    component: 'AbovePrompt',
    surface,
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  } as const
}

function engine(on: On, w: World, stored: Record<string, never> = {}) {
  mock.clock(on, { now: NOW })
  mock.store(on, stored)
  fakeGit(on, w)
  on('command.register', () => ({ value: { command: 'branch-status' } }))
  on('ui.open', (_, e) => {
    w.opened.push(e.focus ? `${e.id} (focus)` : e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

// The branches a query read: one time-bounded scan per branch.
const logCalls = (w: World) =>
  w.calls.filter(a => a[0] === 'log' && a.some(x => x.startsWith('--since='))).map(a => a[a.length - 2])

test('no git runs until 加载Git is pressed', async ($, on) => {
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ type: 'Text', text: /不点不会运行/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
  expect(w.calls).toEqual([])
})

test('加载Git queries the defaults, then what the field holds', async ($, on) => {
  const w = world({ refs: ['refs/remotes/origin/master', 'refs/heads/dev'] })
  engine(on, w)
  for (const surface of SURFACES) {
    w.calls.length = 0
    const ui = await $.ui.mount(pane(surface))
    await ui.input({ key: 'branch-names', text: '', kind: 'submit' })
    expect(logCalls(w)).toEqual(['origin/master', 'dev'])
    expect((await ui.find({ type: 'Text', text: /未找到分支：main, develop/ })) !== undefined).toBe(true)

    w.calls.length = 0
    await ui.input({ key: 'branch-names', text: 'master feat..x', kind: 'change' })
    await ui.press({ key: 'refresh' })
    expect(logCalls(w)).toEqual(['origin/master'])
    expect((await ui.find({ type: 'Text', text: /已忽略无效分支名：feat\.\.x/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

test('/branch-status <names> sets the list and queries it, for surfaces without a field', async ($, on) => {
  const w = world()
  engine(on, w)
  await $.command.run({ command: 'branch-status', args: 'develop' } as never)
  expect(logCalls(w)).toEqual(['origin/develop'])
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ type: 'Button', key: 'toggle-develop' })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'toggle-master' })).toBeUndefined()
  await ui.unmount()
})

test('a draft survives a redraw before 加载Git', async ($, on) => {
  const w = world()
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.input({ key: 'branch-names', text: 'develop', kind: 'change' })
  await ui.press({ key: 'toggle-master' })
  w.calls.length = 0
  await ui.press({ key: 'refresh' })
  expect(logCalls(w)).toEqual(['origin/develop'])
  await ui.unmount()
})

test('outer alarm counts AI of the last 5 days; inner rows show every AI commit', async ($, on) => {
  const w = world({
    logs: {
      'origin/master': [
        { sha: 'a1', daysAgo: 1, body: AI_TRAILER },
        { sha: 'b2', daysAgo: 6, author: 'Other', email: 'o@corp.com', body: AI_TRAILER },
        { sha: 'c3', daysAgo: 7 },
      ],
      'origin/develop': [{ sha: 'a1', daysAgo: 1, body: AI_TRAILER }],
    },
  })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    // One recent AI commit, merged into both branches, is one alarm.
    expect((await ui.find({ type: 'Text', text: /近5天 AI 提交 1 条/ })) !== undefined).toBe(true)
    expect(await ui.findAll({ type: 'Text', text: /AI×1/ })).toHaveLength(2)

    await ui.press({ key: 'toggle-master' })
    expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(2)
    expect((await ui.find({ type: 'Text', text: /1天前 · Me/ })) !== undefined).toBe(true)
    await ui.press({ key: 'toggle-master' })
    expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(0)

    const top = await $.ui.mount(band(surface))
    expect((await top.find({ type: 'Button', key: 'open-branches' }))?.props.label).toBe(
      '🚨 分支记录 · 近5天 AI×1',
    )
    await top.unmount()
    await ui.unmount()
  }
})

test('only an old AI commit raises no outer alarm', async ($, on) => {
  const w = world({ logs: { 'origin/master': [{ sha: 'b2', daysAgo: 6, body: AI_TRAILER }] } })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  expect(await ui.findAll({ type: 'Text', text: /AI×/ })).toHaveLength(0)
  const top = await $.ui.mount(band('desktop'))
  expect((await top.find({ type: 'Button', key: 'open-branches' }))?.props.label).toBe('🌿 分支记录')
  await top.unmount()
  await ui.unmount()
})

test('not a repository, and a failed fetch, are said plainly', async ($, on) => {
  const w = world({ isRepo: false })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /不是 Git 仓库/ })) !== undefined).toBe(true)

  w.isRepo = true
  w.fetchOk = false
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /fetch 失败/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'toggle-master' })) !== undefined).toBe(true)
  await ui.unmount()
})

test('撤销 is offered on one’s own AI commits only', async ($, on) => {
  const w = world({
    logs: {
      'origin/master': [
        { sha: 'a1', daysAgo: 1, body: AI_TRAILER },
        { sha: 'b2', daysAgo: 1 },
        { sha: 'c3', daysAgo: 1, author: 'Other', email: 'o@corp.com', body: AI_TRAILER },
        { sha: 'd4', daysAgo: 1, author: 'Other', email: 'o@corp.com' },
      ],
    },
  })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'toggle-master' })
    const buttons = await ui.findAll({ type: 'Button' })
    const offered = buttons.map(b => b.key ?? '').filter(k => k.startsWith('revert-'))
    expect(offered).toEqual([`revert-master:${sha('a1')}`])
    await ui.press({ key: 'toggle-master' })
    await ui.unmount()
  }
})

test('撤销 asks first, then pushes revert/<hash> from a throwaway worktree', async ($, on) => {
  const w = world({
    logs: { 'origin/master': [{ sha: 'a1', daysAgo: 1, body: AI_TRAILER, isMerge: true }] },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  const id = `master:${sha('a1')}`

  w.calls.length = 0
  await ui.press({ key: `revert-${id}` })
  expect(w.calls).toEqual([])
  await ui.press({ key: `cancel-${id}` })
  await ui.press({ key: `revert-${id}` })
  await ui.press({ key: `confirm-${id}` })

  // Each run gets a folder of its own, named for the commit and the time.
  const tree = `/repo/.git/branch-status-revert-a100000-${NOW}`
  expect(w.calls).toContainEqual(['worktree', 'add', '--detach', tree, 'origin/master'])
  expect(w.calls).toContainEqual(['-C', tree, 'revert', '--no-edit', '-m', '1', sha('a1')])
  expect(w.calls).toContainEqual(['-C', tree, 'push', 'origin', 'HEAD:refs/heads/revert/a100000'])
  expect(w.calls).toContainEqual(['worktree', 'remove', '--force', tree])
  expect(w.calls.some(a => a.includes('push') && a.some(x => x.endsWith(':master')))).toBe(false)
  expect((await ui.find({ type: 'Text', text: /已推送 revert\/a100000/ })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Button', key: `revert-${id}` })).toBeUndefined()
  await ui.unmount()
})

test('撤销 is refused when git no longer says the commit is one’s own', async ($, on) => {
  const w = world({ logs: { 'origin/master': [{ sha: 'a1', daysAgo: 1, body: AI_TRAILER }] } })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  const id = `master:${sha('a1')}`
  w.me = 'someone@else.com'
  await ui.press({ key: `revert-${id}` })
  w.calls.length = 0
  await ui.press({ key: `confirm-${id}` })
  expect(w.calls.some(a => a[0] === 'worktree' || a.includes('push'))).toBe(false)
  expect((await ui.find({ type: 'Text', text: /只能撤销完全由自己写的 AI 改动/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('every worktree is listed under the branches, this one highlighted', async ($, on) => {
  const w = world()
  engine(on, w)
  const before = await $.ui.mount(pane('desktop'))
  expect(await before.find({ type: 'Text', text: /Worktree/ })).toBeUndefined()
  await before.unmount()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ type: 'Text', text: /Worktree（3）/ })) !== undefined).toBe(true)
    const current = await ui.find({ type: 'Text', text: /← 当前/ })
    expect(current?.text).toContain('develop')
    expect(current?.props.color).toBe('green')
    expect((await ui.find({ type: 'Text', text: /feature\/x 🔒/ }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /detached ccc0000\) \(已失效\)/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

test('worktree paths match across slashes and case', () => {
  const list = 'worktree C:/Repo/App\nHEAD ' + sha('a') + '\nbranch refs/heads/main\n\n'
  expect(parseWorktrees(list, 'c:\\repo\\app\\')[0]).toEqual({
    path: 'C:/Repo/App',
    branch: 'main',
    head: 'a000000',
    isCurrent: true,
    isMain: true,
    isLocked: false,
    isPrunable: false,
  })
})

const BODY = 'Approval now has two levels.\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>'

test('hovering a commit row reveals its message in place', async ($, on) => {
  const w = world({ logs: { 'origin/master': [{ sha: 'a1', daysAgo: 1, body: BODY }] } })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'toggle-master' })
    const row = await ui.find({ type: 'Box', key: `row-master:${sha('a1')}` })
    expect(row !== undefined).toBe(true)
    const hidden = (await ui.findAll({ type: 'Box' })).filter(b => b.props.display === 'none')
    expect(hidden).toHaveLength(1)
    expect(hidden[0]?.text).toContain('Approval now has two levels.')
    expect(hidden[0]?.text).toContain('📄 打开全文')
    // The drawing carries the hover beside the props: shown while the pointer is on the row.
    type Drawn = { props?: { display?: string }; hover?: unknown }
    const reveal = (row?.children as Drawn[] | undefined)?.find(k => k.props?.display === 'none')
    expect(reveal?.hover).toEqual({ display: 'flex' })
    await ui.press({ key: 'toggle-master' })
    await ui.unmount()
  }
})

test('clicking a commit row opens its whole message in a pane of its own', async ($, on) => {
  const w = world({
    logs: { 'origin/master': [{ sha: 'm1', daysAgo: 1, isMerge: true }] },
    merged: { m1: [{ sha: 'x1', daysAgo: 2, body: BODY }, { sha: 'x2', daysAgo: 2, author: 'Other', email: 'o@corp.com' }] },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  await ui.press({ key: `open-master:${sha('m1')}` })
  // Opened with focus, so the tab comes to the front.
  expect(w.opened).toContain('commit-detail (focus)')
  await ui.unmount()

  for (const surface of SURFACES) {
    const detail = await $.ui.mount({
      ...pane(surface),
      requestId: 'commit-detail',
      props: { ...pane(surface).props, title: '提交详情' },
    })
    const texts = (await detail.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.some(t => t.includes('change m1'))).toBe(true)
    expect(texts.some(t => t.includes('Me <me@corp.com>'))).toBe(true)
    expect(texts.some(t => t.includes('AI 提交（claude）：这次合并带入了 AI 提交'))).toBe(true)
    expect(texts.some(t => t.includes('合并带入的提交（2）'))).toBe(true)
    expect(texts.some(t => t.includes('🚨 x100000 change x1 · Me'))).toBe(true)
    expect(texts.some(t => t.includes('x200000 change x2 · Other'))).toBe(true)
    expect(texts.some(t => t.includes(sha('m1')))).toBe(true)
    await detail.unmount()
  }
})

test('the detail pane before any click says how to fill it', async ($, on) => {
  engine(on, world())
  const detail = await $.ui.mount({ ...pane('desktop'), requestId: 'commit-detail' })
  expect((await detail.find({ type: 'Text', text: /点一条提交/ })) !== undefined).toBe(true)
  await detail.unmount()
})

const DELETE_TREES: Tree[] = [
  { path: 'C:/main', head: 'aaa', branch: 'master' },
  { path: 'C:/repo', head: 'bbb', branch: 'develop' },
  { path: 'C:/wt/a', head: 'ccc', branch: 'feature/a' },
  {
    path: 'C:/wt/b',
    head: 'ddd',
    branch: 'feature/b',
    dirty: [' M src/app.ts', '?? notes.txt'],
    unmerged: ['abc1234 wip approval'],
  },
  { path: 'C:/wt/old', head: 'eee', prunable: true },
]

test('删除 is offered on other worktrees only, never this one or the main one', async ($, on) => {
  const w = world({ trees: DELETE_TREES.map(t => ({ ...t })) })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    const offered = (await ui.findAll({ type: 'Button' }))
      .map(b => b.key ?? '')
      .filter(k => k.startsWith('wt-delete-'))
    expect(offered).toEqual(['wt-delete-C:/wt/a', 'wt-delete-C:/wt/b', 'wt-delete-C:/wt/old'])
    await ui.unmount()
  }
  expect(w.calls.some(a => a.includes('status') || a.includes('remove'))).toBe(false)
})

test('a clean worktree is deleted after confirming; its branch stays', async ($, on) => {
  const w = world({ trees: DELETE_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/a' })
  expect((await ui.find({ type: 'Text', text: /没有未提交、未合并或被忽略的内容，可以放心删除/ })) !== undefined).toBe(true)
  expect(w.calls.some(a => a.includes('remove'))).toBe(false)

  await ui.press({ key: 'wt-confirm-C:/wt/a' })
  expect(w.calls).toContainEqual(['worktree', 'remove', 'C:/wt/a'])
  expect((await ui.find({ type: 'Text', text: /Worktree（4）/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /已删除 C:\/wt\/a，分支 feature\/a 保留/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('unsaved changes and unmerged commits are listed before a forced delete', async ($, on) => {
  const w = world({ trees: DELETE_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/b' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('未提交的改动 2 处，删除后会丢失：')
  expect(texts.some(t => t.includes('M src/app.ts'))).toBe(true)
  expect(texts.some(t => t.includes('?? notes.txt'))).toBe(true)
  expect(texts.some(t => t.includes('未合并到 master、origin/master、origin/develop 的提交 1 个'))).toBe(true)
  expect(texts.some(t => t.includes('abc1234 wip approval'))).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'wt-confirm-C:/wt/b' }))?.props.label).toBe('强制删除（丢弃改动）')

  await ui.press({ key: 'wt-cancel-C:/wt/b' })
  expect(w.calls.some(a => a.includes('remove'))).toBe(false)
  await ui.press({ key: 'wt-delete-C:/wt/b' })
  await ui.press({ key: 'wt-confirm-C:/wt/b' })
  expect(w.calls).toContainEqual(['worktree', 'remove', '--force', 'C:/wt/b'])
  await ui.unmount()
})

test('a worktree whose folder is gone is only pruned', async ($, on) => {
  const w = world({ trees: DELETE_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/old' })
  expect((await ui.find({ type: 'Text', text: /目录已不存在/ })) !== undefined).toBe(true)
  await ui.press({ key: 'wt-confirm-C:/wt/old' })
  expect(w.calls).toContainEqual(['worktree', 'prune'])
  expect(w.calls.some(a => a.includes('remove'))).toBe(false)
  await ui.unmount()
})

test('a default merge is judged by the commits it brought in', async ($, on) => {
  const OTHER = { author: 'Other', email: 'o@corp.com' }
  const w = world({
    logs: {
      'origin/master': [
        { sha: 'm1', daysAgo: 1, isMerge: true },
        { sha: 'm2', daysAgo: 1, isMerge: true },
        { sha: 'm3', daysAgo: 1, isMerge: true, ...OTHER },
        { sha: 'm4', daysAgo: 1, isMerge: true },
        { sha: 'm5', daysAgo: 1, isMerge: true },
      ],
    },
    merged: {
      m1: [{ sha: 'x1', daysAgo: 2, body: AI_TRAILER }],
      m2: [{ sha: 'x2', daysAgo: 2, body: AI_TRAILER, ...OTHER }],
      m3: [{ sha: 'x3', daysAgo: 2, body: AI_TRAILER }],
      m4: [{ sha: 'x4', daysAgo: 2, body: AI_TRAILER }, { sha: 'x5', daysAgo: 2, ...OTHER }],
      m5: [{ sha: 'x6', daysAgo: 2 }],
    },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  // Every merge that brought AI in is flagged; a purely human merge is not.
  expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(4)
  // Only a merge of nothing but one's own work may be reverted.
  const offered = (await ui.findAll({ type: 'Button' }))
    .map(b => b.key ?? '')
    .filter(k => k.startsWith('revert-'))
  expect(offered).toEqual([`revert-master:${sha('m1')}`])
  await ui.unmount()
})

test('AI is told by tool trailers and bot identities, never by a first name', () => {
  const me: [string, string] = ['Me', ME]
  expect(detectAi([['Devin Li', 'devin@corp.com']], 'fix login')).toBe('')
  expect(detectAi([['Cody Wang', 'cody.li@corp.com']], 'cursor fix')).toBe('')
  expect(detectAi([me], 'pair\n\nCo-Authored-By: Cody Wang <cody@corp.com>')).toBe('')
  expect(detectAi([me], 'pair\n\nCo-Authored-By: Claude Martin <claude.martin@corp.com>')).toBe('')
  expect(detectAi([me], `fix\n\n${AI_TRAILER}`)).toBe('claude')
  expect(detectAi([me], 'x\n\nCo-Authored-By: Claude <claude@users.noreply.github.com>')).toBe('claude')
  expect(detectAi([me], 'fix\n\n🤖 Generated with [Claude Code](https://claude.com)')).toBe('claude')
  expect(detectAi([['dependabot[bot]', 'bot@github.com']], 'bump')).toBe('bot')
  expect(detectAi([['Copilot', 'copilot@github.com']], 'x')).toBe('copilot')
})

test('branch input, ownership and relative time', () => {
  expect(parseBranchInput('', BUILT_IN_PROTECTED).names).toEqual(['master', 'main', 'develop', 'dev'])
  expect(parseBranchInput('', ['master', 'release']).names).toEqual(['master', 'release'])
  expect(parseBranchInput('a，b  a -x c..d', BUILT_IN_PROTECTED).names).toEqual(['a', 'b'])
  expect(parseBranchInput('a -x c..d', BUILT_IN_PROTECTED).invalid).toEqual(['-x', 'c..d'])
  expect(protectedBranches(['release', 'master', '-x'])).toEqual(['master', 'main', 'develop', 'dev', 'release'])
  const c = {
    sha: 's', hash: 's', subject: '', author: '', email: ME, ts: 0, isMerge: false, ai: 'claude',
    authors: [ME], body: '', brought: [],
  }
  expect(canRevert(c, 'ME@corp.com')).toBe(true)
  expect(canRevert({ ...c, ai: '' }, ME)).toBe(false)
  expect(canRevert({ ...c, authors: ['o@corp.com'] }, ME)).toBe(false)
  expect(canRevert({ ...c, authors: [ME, 'o@corp.com'] }, ME)).toBe(false)
  expect(canRevert(c, '')).toBe(false)
  expect(relTime(NOW - 30_000, NOW)).toBe('刚刚')
  expect(relTime(NOW - 3 * 3_600_000, NOW)).toBe('3小时前')
  expect(relTime(NOW - 2 * DAY, NOW)).toBe('2天前')
})

test('the two ways to read Git are named for what they do', async ($, on) => {
  engine(on, world())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('🔄 加载Git')
    expect((await ui.find({ type: 'Input', key: 'branch-names' }))?.props.submitLabel).toBe('查询分支')
    await ui.unmount()
  }
})

test('a queried branch can be protected, and then joins the default list', async ($, on) => {
  const w = world({
    refs: ['refs/remotes/origin/master', 'refs/remotes/origin/develop', 'refs/remotes/origin/feature/x'],
    logs: { 'origin/master': [], 'origin/develop': [], 'origin/feature/x': [] },
  })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.input({ key: 'branch-names', text: 'master feature/x', kind: 'submit' })
    // Built-in protected branches carry the mark and no button.
    expect(await ui.find({ type: 'Button', key: 'protect-master' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'unprotect-master' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'protect-feature/x' }))?.props.label).toBe('🛡 保护')

    await ui.press({ key: 'protect-feature/x' })
    expect(await ui.find({ type: 'Button', key: 'protect-feature/x' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'unprotect-feature/x' })) !== undefined).toBe(true)
    expect(await ui.findAll({ type: 'Text', text: /🛡 受保护/ })).toHaveLength(2)

    // An empty field now means the protected list, feature/x included.
    w.calls.length = 0
    await ui.input({ key: 'branch-names', text: '', kind: 'submit' })
    expect(logCalls(w)).toEqual(['origin/master', 'origin/develop', 'origin/feature/x'])

    await ui.press({ key: 'unprotect-feature/x' })
    w.calls.length = 0
    await ui.input({ key: 'branch-names', text: '', kind: 'submit' })
    expect(logCalls(w)).toEqual(['origin/master', 'origin/develop'])
    await ui.unmount()
  }
})

test('a protected branch counts as merged-into when a worktree is deleted', async ($, on) => {
  const w = world({ trees: DELETE_TREES.map(t => ({ ...t })) })
  engine(on, w, { protected: ['release'] as never })
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/b' })
  const asked = w.calls.find(a => a[0] === 'for-each-ref' && a[1] === '--format=%(refname:short)') ?? []
  expect(asked).toContain('refs/heads/release')
  expect(asked).toContain('refs/remotes/origin/release')
  await ui.unmount()
})

test('the protected list is kept across sessions', async ($, on) => {
  engine(on, world(), { protected: ['release'] as never })
  const ui = await $.ui.mount(pane('desktop'))
  const field = await ui.find({ type: 'Input', key: 'branch-names' })
  expect(field?.props.value).toBe('master main develop dev release')
  await ui.unmount()
})

test('an AI commit of the last 5 days past the newest 20 still raises the alarm and is listed', async ($, on) => {
  const busy = Array.from({ length: 25 }, (_, i) => ({ sha: `h${String(i).padStart(2, "0")}`, daysAgo: i * 0.01 }))
  const w = world({ logs: { 'origin/master': [...busy, { sha: 'ai9', daysAgo: 2, body: AI_TRAILER }] } })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ type: 'Text', text: /近5天 AI 提交 1 条/ })) !== undefined).toBe(true)
    expect(await ui.findAll({ type: 'Text', text: /AI×1/ })).toHaveLength(1)
    await ui.press({ key: 'toggle-master' })
    expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(1)
    expect((await ui.find({ type: 'Button', key: `open-master:${sha('ai9')}` })) !== undefined).toBe(true)
    await ui.press({ key: 'toggle-master' })
    await ui.unmount()
  }
})

const RISKY_TREES: Tree[] = [
  { path: 'C:/main', head: 'aaa', branch: 'master' },
  { path: 'C:/repo', head: 'bbb', branch: 'develop' },
  { path: 'C:/wt/d', head: 'ddd', orphaned: ['fff1111 detached work'] },
  { path: 'C:/wt/i', head: 'eee', branch: 'feature/i', ignored: ['.env', 'build/'] },
  { path: 'C:/wt/x', head: 'fff', branch: 'feature/x', logFails: true },
]

const textsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

test('a detached worktree lists the commits no branch holds, as lost on delete', async ($, on) => {
  const w = world({ trees: RISKY_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/d' })
  const texts = await textsOf(ui)
  expect(texts.some(t => t.includes('不在任何分支上的提交 1 个，删除后无法找回'))).toBe(true)
  expect(texts.some(t => t.includes('fff1111 detached work'))).toBe(true)
  expect(texts.some(t => t.includes('分支保留'))).toBe(false)
  expect(texts.some(t => t.includes('可以放心删除'))).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'wt-confirm-C:/wt/d' }))?.props.label).toBe('删除（丢弃以上内容）')
  await ui.press({ key: 'wt-confirm-C:/wt/d' })
  expect(w.calls).toContainEqual(['worktree', 'remove', 'C:/wt/d'])
  await ui.unmount()
})

test('files git ignores are listed before a delete takes them', async ($, on) => {
  const w = world({ trees: RISKY_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/i' })
  const texts = await textsOf(ui)
  expect(texts.some(t => t.includes('被 Git 忽略的文件 2 处'))).toBe(true)
  expect(texts.some(t => t.includes('.env'))).toBe(true)
  expect(texts.some(t => t.includes('build/'))).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'wt-confirm-C:/wt/i' }))?.props.label).toBe('删除（丢弃以上内容）')
  await ui.unmount()
})

test('a read that fails stops the delete instead of calling it safe', async ($, on) => {
  const w = world({ trees: RISKY_TREES.map(t => ({ ...t })) })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'wt-delete-C:/wt/x' })
  const texts = await textsOf(ui)
  expect(texts.some(t => t.includes('读不到未合并的提交'))).toBe(true)
  expect(texts.some(t => t.includes('可以放心删除'))).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'wt-confirm-C:/wt/x' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'wt-cancel-C:/wt/x' })) !== undefined).toBe(true)
  await ui.unmount()
})

test('/branch-status during a query says it did not run, instead of claiming it did', async ($, on) => {
  const w = world()
  let release = () => {}
  w.gate = new Promise<void>(done => {
    release = done
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  const pending = ui.press({ key: 'refresh' })
  const reply = (await $.command.run({ command: 'branch-status', args: 'develop' } as never)) as { text?: string }
  expect(reply.text).toBe('正在处理上一次操作，等它结束后再试。')
  release()
  await pending
  // The held query finished on its own list; the command's list never ran.
  expect(logCalls(w)).toEqual(['origin/master', 'origin/develop'])
  await ui.unmount()
})

test('a revert worktree left by a run cut short is cleared before the next revert', async ($, on) => {
  const leftover = '/repo/.git/branch-status-revert-a100000-1'
  const w = world({
    logs: { 'origin/master': [{ sha: 'a1', daysAgo: 1, body: AI_TRAILER }] },
    trees: [{ path: 'C:/repo', head: 'aaa', branch: 'develop' }, { path: leftover, head: 'zzz' }],
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  const id = `master:${sha('a1')}`
  await ui.press({ key: `revert-${id}` })
  w.calls.length = 0
  await ui.press({ key: `confirm-${id}` })
  const removed = w.calls.findIndex(a => a.join(' ') === `worktree remove --force ${leftover}`)
  const added = w.calls.findIndex(a => a[0] === 'worktree' && a[1] === 'add')
  expect(removed).toBeGreaterThan(-1)
  expect(added).toBeGreaterThan(removed)
  expect(w.calls).toContainEqual(['worktree', 'prune'])
  expect((await ui.find({ type: 'Text', text: /已推送 revert\/a100000/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('one walk judges at most 40 merges by what they brought in; the rest are never offered for revert', async ($, on) => {
  const merges = Array.from({ length: 45 }, (_, i) => ({ sha: `m${String(i).padStart(2, "0")}`, daysAgo: i * 0.01, isMerge: true }))
  const w = world({ logs: { 'origin/master': merges } })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  expect(w.calls.filter(a => a[0] === 'log' && (a[a.length - 2] ?? '').includes('^1..'))).toHaveLength(40)
  await ui.unmount()
})

test('older AI rows are capped at 50, while the alarm still counts every AI commit of the window', async ($, on) => {
  const human = Array.from({ length: 20 }, (_, i) => ({ sha: `h${String(i).padStart(2, "0")}`, daysAgo: i * 0.001 }))
  const ai = Array.from({ length: 60 }, (_, i) => ({ sha: `a${String(i).padStart(2, "0")}`, daysAgo: 1 + i * 0.01, body: AI_TRAILER }))
  const w = world({ logs: { 'origin/master': [...human, ...ai] } })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /近5天 AI 提交 60 条/ })) !== undefined).toBe(true)
  expect(await ui.findAll({ type: 'Text', text: /AI×60/ })).toHaveLength(1)
  await ui.press({ key: 'toggle-master' })
  expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(50)
  const top = await $.ui.mount(band('desktop'))
  expect((await top.find({ type: 'Button', key: 'open-branches' }))?.props.label).toBe('🚨 分支记录 · 近5天 AI×60')
  await top.unmount()
  await ui.unmount()
})

test('🚨 marks exactly the rows the alarm counts: AI commits of the 5-day window', async ($, on) => {
  const w = world({
    logs: {
      'origin/master': [
        { sha: 'a1', daysAgo: 1, body: AI_TRAILER },
        { sha: 'b2', daysAgo: 6, body: AI_TRAILER },
        { sha: 'c3', daysAgo: 2 },
      ],
    },
  })
  engine(on, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ type: 'Text', text: /近5天 AI 提交 1 条（.* 以来，🚨 标出的行）/ })) !== undefined).toBe(true)
    await ui.press({ key: 'toggle-master' })
    const marked = await ui.findAll({ type: 'Text', text: /^🚨 [0-9a-f]{7}$/ })
    expect(marked.map(t => t.text)).toEqual(['🚨 a100000'])
    // The older AI commit is still red and tagged inside, without the alarm mark.
    expect(await ui.findAll({ type: 'Text', text: /\[claude\]/ })).toHaveLength(2)
    expect((await ui.find({ type: 'Text', text: /^b200000$/ }))?.props.color).toBe('red')
    await ui.press({ key: 'toggle-master' })
    await ui.unmount()
  }
})

test('every row has a visible 全文 button, and the hover preview a real one', async ($, on) => {
  const w = world({ logs: { 'origin/master': [{ sha: 'a1', daysAgo: 1, body: 'Approval now has two levels.' }] } })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  const id = `master:${sha('a1')}`
  expect((await ui.find({ type: 'Button', key: `full-${id}` }))?.props.label).toBe('📄 全文')
  expect((await ui.find({ type: 'Button', key: `more-${id}` }))?.props.label).toBe('📄 打开全文')
  await ui.press({ key: `full-${id}` })
  expect(w.opened).toContain('commit-detail (focus)')
  w.opened.length = 0
  await ui.press({ key: `more-${id}` })
  expect(w.opened).toContain('commit-detail (focus)')
  await ui.unmount()
})

test('the detail of a commit that changed a .nema file lists the domains it changed', async ($, on) => {
  const c = sha('n1')
  const w = world({
    logs: { 'origin/master': [{ sha: 'n1', daysAgo: 1 }] },
    show: {
      files: ['src/app.ts', 'docs/分工.nema'],
      texts: {
        [`${c}^:docs/分工.nema`]: ' \\1 2\nA B\n \\2 1\nC D\n',
        [`${c}:docs/分工.nema`]: ' \\1 3\nA X\n \\2 1\nC E\n \\3 1\nNEW\n',
      },
    },
  })
  engine(on, w)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-master' })
  // Git reads a commit's files only on the click.
  expect(w.calls.some(a => a.includes('show'))).toBe(false)
  await ui.press({ key: `open-master:${c}` })
  await ui.unmount()

  const detail = await $.ui.mount({
    ...pane('desktop'),
    requestId: 'commit-detail',
    props: { ...pane('desktop').props, title: '提交详情' },
  })
  const texts = (await detail.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('.nema 领域变化'))).toBe(true)
  expect(texts.some(t => t.includes('📐 docs/分工.nema'))).toBe(true)
  expect(texts.some(t => t.includes('\\1 修订 2→3 已修改'))).toBe(true)
  expect(texts.some(t => t.includes('\\2 内容已改，修订号未增加（仍为 1）'))).toBe(true)
  expect(texts.some(t => t.includes('\\3 新增（修订 1）'))).toBe(true)
  // Only the .nema file was read, at the parent and at the commit.
  expect(w.calls.filter(a => a[0] === 'show').map(a => a[1])).toEqual([`${c}^:docs/分工.nema`, `${c}:docs/分工.nema`])
  await detail.unmount()
})
