import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BranchInfo, Busy, Commit, Detail, Snapshot, Worktree, WorktreePlan } from '../types'
import {
  BUILT_IN_PROTECTED,
  LOG_COUNT,
  LOG_FORMAT,
  MERGE_EXPANSIONS,
  MERGE_SCAN,
  PREVIEW_LINES,
  RECENT_MS,
  RECENT_SCAN,
  baseRefPatterns,
  canDeleteWorktree,
  canRevert,
  fullTime,
  isBranchName,

  mergeRange,
  messageLines,
  parseBranchInput,
  parseLog,
  parseWorktrees,
  protectedBranches,
  recentAiCount,
  relTime,
  shownCommits,
  sinceArg,
  unjudgedMerge,
  withMerged,
} from './logic'
import type { BranchInput } from './logic'
import { openDocPane, registerDocLinks, startDocLinks } from './doc-links'
import { buildLine, noteBuild } from './build'
import { runGit as git } from './files'
import { openOverview, registerOverview, startOverview } from './overview'

const PANE = 'branch-status'
const TITLE = '分支变更'
const STORE_KEY = 'branches'
const PROTECTED_KEY = 'protected'

// How many changed files or commits a delete's details list before "…另有".
const DETAIL_ROWS = 10
// The folder name a revert's throwaway worktree starts with, inside the git directory.
const REVERT_TREE = 'branch-status-revert-'

const EMPTY: Snapshot = { branches: [], worktrees: [], at: 0, error: '', warnings: [], me: '' }

const snapshot = atom({ plugin: 'branch-status', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-10',
})
const open = atom(
  { plugin: 'branch-status', key: 'open' } as const,
  {} as Record<string, boolean>,
  { shape: 'open-1' },
)
// The list last queried in this session; '' until then (the store holds it across sessions).
const branches = atom({ plugin: 'branch-status', key: 'branches' } as const, '', {
  shape: 'branches-2',
})
// Branches the person added to the protected list; null until read from the store.
const added = atom(
  { plugin: 'branch-status', key: 'protectedAdded' } as const,
  null as string[] | null,
  { shape: 'protectedAdded-1' },
)
const busy = atom({ plugin: 'branch-status', key: 'busy' } as const, '' as Busy, {
  shape: 'busy-1',
})
// `<branch>:<sha>` of the revert waiting for its second press, or ''.
const confirming = atom({ plugin: 'branch-status', key: 'confirming' } as const, '', {
  shape: 'confirming-1',
})
// The outcome of each revert, by commit sha.
const reverts = atom(
  { plugin: 'branch-status', key: 'reverts' } as const,
  {} as Record<string, string>,
  { shape: 'reverts-1' },
)

// Recent AI commits of the last query, for the band: counted once per query, not per redraw.
const alarm = atom({ plugin: 'branch-status', key: 'alarm' } as const, 0, { shape: 'alarm-1' })
const wtPlan = atom(
  { plugin: 'branch-status', key: 'wtPlan' } as const,
  null as WorktreePlan | null,
  { shape: 'wtPlan-1' },
)
const wtNote = atom({ plugin: 'branch-status', key: 'wtNote' } as const, '', { shape: 'wtNote-1' })
const detail = atom(
  { plugin: 'branch-status', key: 'detail' } as const,
  null as Detail | null,
  { shape: 'detail-1' },
)

const DETAIL_PANE = 'commit-detail'

// Clicking a commit row: its whole message in a pane of its own (a tab beside this one).
async function openDetail($: EngineInterface, branch: string, commit: Commit) {
  await update($, detail, () => ({ branch, commit }))
  // `focus` brings the tab to the front, so the click visibly opens it.
  await $.ui.open({ id: DETAIL_PANE, title: '提交详情', closeOnEscape: true, focus: true })
}

// The field's text between redraws; a query clears it.
let draft: string | undefined
// One git job at a time: set before the first await, so a second press can't slip in.
let running = false

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}


// `limits` bound the walk (`-20`, `-1`, `--max-count`, `--since`); `ref` is a branch, a sha or a range.
// A merge found in `known` is reused rather than judged again.
async function readLog(
  $: EngineInterface,
  cwd: string,
  limits: string[],
  ref: string,
  known: ReadonlyMap<string, Commit> = new Map(),
) {
  const out = await git($, cwd, ['log', ...limits, `--format=${LOG_FORMAT}`, ref, '--'])
  const commits: Commit[] = []
  let expanded = 0
  for (const c of parseLog(out.stdout)) {
    const judged = known.get(c.sha)
    if (judged !== undefined || !c.isMerge) {
      commits.push(judged ?? c)
      continue
    }
    if (expanded >= MERGE_EXPANSIONS) {
      // Past the cap a merge keeps its own markers only, and is never offered for revert.
      commits.push(unjudgedMerge(c))
      continue
    }
    expanded++
    // A merge's own message rarely says AI: judge it by what it brought in.
    const brought = await git($, cwd, [
      'log',
      `--max-count=${MERGE_SCAN}`,
      `--format=${LOG_FORMAT}`,
      mergeRange(c),
      '--',
    ])
    commits.push(withMerged(c, parseLog(brought.stdout)))
  }
  return commits
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/** The branches the person added to the protected list, kept across sessions. */
async function readAdded($: EngineInterface): Promise<string[]> {
  const inSession = await read($, added)
  if (inSession !== null) return inSession
  const stored = await $.store.get(PROTECTED_KEY)
  return Array.isArray(stored) ? stored.filter((n): n is string => typeof n === 'string' && isBranchName(n)) : []
}

async function readProtected($: EngineInterface): Promise<string[]> {
  return protectedBranches(await readAdded($))
}

// 🛡 保护 / 取消保护: puts a queried branch on the protected list, or takes it off.
async function setProtected($: EngineInterface, name: string, isOn: boolean) {
  if (!isBranchName(name) || BUILT_IN_PROTECTED.includes(name)) return
  const current = await readAdded($)
  const next = isOn ? [...new Set([...current, name])] : current.filter(n => n !== name)
  await update($, added, () => next)
  await $.store.set(PROTECTED_KEY, next)
}

async function savedBranches($: EngineInterface): Promise<string> {
  const inSession = await read($, branches)
  if (inSession !== '') return inSession
  const stored = await $.store.get(STORE_KEY)
  return typeof stored === 'string' && stored !== '' ? stored : (await readProtected($)).join(' ')
}

// Runs only from 加载Git or 查询分支: nothing else starts git.
// Resolves false when another git job was already running and this one did not run.
async function query($: EngineInterface, text: string): Promise<boolean> {
  if (running) return false
  running = true
  await update($, busy, () => 'query')
  try {
    const input = parseBranchInput(text, await readProtected($))
    const list = input.names.join(' ')
    draft = undefined
    await update($, branches, () => list)
    await $.store.set(STORE_KEY, list)
    const result = await collect($, input).catch(
      async (err): Promise<Snapshot> => ({ ...EMPTY, at: await $.clock.now(), error: String(err) }),
    )
    await update($, snapshot, () => result)
    await update($, alarm, () => recentAiCount(result.branches))
    return true
  } finally {
    running = false
    await update($, busy, () => '')
  }
}

async function collect($: EngineInterface, input: BranchInput): Promise<Snapshot> {
  const warnings = input.invalid.length ? [`已忽略无效分支名：${input.invalid.join(', ')}`] : []
  const at = await $.clock.now()
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    return { ...EMPTY, at, warnings, error: '当前目录不是 Git 仓库，切到项目文件夹后再点「加载Git」。' }
  }
  const worktrees = await listWorktrees($, cwd, top.stdout)
  const fetched = await git($, cwd, ['fetch', '--quiet', 'origin'], 60_000)
  if (fetched.exitCode !== 0) {
    warnings.push(`fetch 失败，下面是本地缓存，可能不是最新：${firstLine(fetched.stderr)}`)
  }
  const me = (await git($, cwd, ['config', 'user.email'])).stdout.trim().toLowerCase()
  const listed = await git($, cwd, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes/origin',
  ])
  const refs = new Set(listed.stdout.split('\n').map(line => line.trim()))
  const found: BranchInfo[] = []
  const missing: string[] = []
  for (const name of input.names) {
    const ref = refs.has(`refs/remotes/origin/${name}`)
      ? `origin/${name}`
      : refs.has(`refs/heads/${name}`)
        ? name
        : ''
    if (ref === '') {
      missing.push(name)
      continue
    }
    // The alarm needs every commit of the window, however many came after it.
    const recent = await readLog($, cwd, [`--max-count=${RECENT_SCAN}`, sinceArg(at)], ref)
    const latest =
      recent.length >= LOG_COUNT
        ? recent.slice(0, LOG_COUNT)
        : await readLog($, cwd, [`-${LOG_COUNT}`], ref, new Map(recent.map(c => [c.sha, c])))
    found.push({
      name,
      commits: shownCommits(latest, recent),
      aiRecent: recent.filter(c => c.ai !== '').map(c => c.sha),
    })
  }
  if (missing.length) warnings.push(`未找到分支：${missing.join(', ')}`)
  return { branches: found, worktrees, at, error: '', warnings, me }
}

async function listWorktrees($: EngineInterface, cwd: string, top: string): Promise<Worktree[]> {
  const listed = await git($, cwd, ['worktree', 'list', '--porcelain'])
  return parseWorktrees(listed.stdout, top)
}

// First press of 删除: reads what the delete would lose, deletes nothing.
async function inspectWorktree($: EngineInterface, t: Worktree) {
  if (running || !canDeleteWorktree(t)) return
  running = true
  await update($, busy, () => 'worktree')
  try {
    const plan = await worktreeDetails($, t).catch(
      (err): WorktreePlan => ({
        path: t.path, dirty: [], unmerged: [], orphaned: [], ignored: [], bases: [], isPrune: false, error: String(err),
      }),
    )
    await update($, wtPlan, () => plan)
  } finally {
    running = false
    await update($, busy, () => '')
  }
}

async function worktreeDetails($: EngineInterface, t: Worktree): Promise<WorktreePlan> {
  const plan: WorktreePlan = {
    path: t.path, dirty: [], unmerged: [], orphaned: [], ignored: [], bases: [], isPrune: t.isPrunable, error: '',
  }
  if (t.isPrunable) return plan
  const cwd = await $.session.cwd()
  const lines = (text: string) => text.split('\n').map(line => line.trimEnd()).filter(Boolean)
  // Any read that fails stops the delete: the pane never says "safe" on a guess.
  const failed = (what: string, ran: { stderr: string }) => ({ ...plan, error: `读不到${what}：${firstLine(ran.stderr)}` })

  const status = await git($, cwd, ['-C', t.path, 'status', '--porcelain', '--ignored'])
  if (status.exitCode !== 0) return failed('这个 worktree 的状态', status)
  const all = lines(status.stdout)
  const ignored = all.filter(line => line.startsWith('!! ')).map(line => line.slice(3))
  const dirty = all.filter(line => !line.startsWith('!! '))

  if (t.branch === '') {
    // Detached: commits that no branch, remote or tag holds are gone once the folder is.
    const log = await git($, cwd, [
      '-C', t.path, 'log', '--max-count=50', '--format=%h %s', 'HEAD', '--not', '--branches', '--remotes', '--tags',
    ])
    if (log.exitCode !== 0) return failed('未保存的提交', log)
    return { ...plan, dirty, ignored, orphaned: lines(log.stdout) }
  }

  const listed = await git($, cwd, [
    'for-each-ref',
    '--format=%(refname:short)',
    ...baseRefPatterns(await readProtected($)),
  ])
  if (listed.exitCode !== 0) return failed('受保护分支', listed)
  const bases = lines(listed.stdout)
  const log = await git($, cwd, [
    '-C', t.path, 'log', '--max-count=50', '--format=%h %s', 'HEAD', '--not', ...(bases.length ? bases : ['--remotes']),
  ])
  if (log.exitCode !== 0) return failed('未合并的提交', log)
  return { ...plan, dirty, ignored, bases, unmerged: lines(log.stdout) }
}

type DeleteSection = { title: string; lines: string[]; color: string }

const many = (n: number) => (n >= 50 ? '50+' : String(n))

// What a delete would lose (red) or leave on its branch (yellow), each listed in full.
function deleteSections(plan: WorktreePlan): DeleteSection[] {
  const parts: DeleteSection[] = [
    { title: `未提交的改动 ${plan.dirty.length} 处，删除后会丢失：`, lines: plan.dirty, color: 'red' },
    { title: `不在任何分支上的提交 ${many(plan.orphaned.length)} 个，删除后无法找回：`, lines: plan.orphaned, color: 'red' },
    { title: `被 Git 忽略的文件 ${plan.ignored.length} 处（如 .env、构建产物），删除后会一起消失：`, lines: plan.ignored, color: 'red' },
    {
      title: `未合并到 ${plan.bases.length ? plan.bases.join('、') : '任何远端分支'} 的提交 ${many(plan.unmerged.length)} 个（分支保留，提交不会丢）：`,
      lines: plan.unmerged,
      color: 'yellow',
    },
  ]
  return parts.filter(part => part.lines.length > 0)
}

function confirmLabel(plan: WorktreePlan): string {
  if (plan.isPrune) return '确认清理'
  if (plan.dirty.length > 0) return '强制删除（丢弃改动）'
  if (plan.orphaned.length > 0 || plan.ignored.length > 0) return '删除（丢弃以上内容）'
  return '确认删除'
}

// Second press: removes the folder (forced only when the person saw the changes it drops).
async function removeWorktree($: EngineInterface) {
  const plan = await read($, wtPlan)
  if (running || plan === null || plan.error !== '') return
  running = true
  await update($, busy, () => 'worktree')
  let message: string
  try {
    const cwd = await $.session.cwd()
    const top = (await git($, cwd, ['rev-parse', '--show-toplevel'])).stdout
    const target = (await listWorktrees($, cwd, top)).find(t => t.path === plan.path)
    if (!target || !canDeleteWorktree(target)) {
      message = '这个 worktree 已不存在，或是当前/主 worktree，没有删除。'
    } else if (plan.isPrune) {
      const pruned = await git($, cwd, ['worktree', 'prune'])
      message = pruned.exitCode === 0 ? `已清理失效记录 ${plan.path}` : `清理失败：${firstLine(pruned.stderr)}`
    } else {
      const force = plan.dirty.length > 0 ? ['--force'] : []
      const removed = await git($, cwd, ['worktree', 'remove', ...force, plan.path], 120_000)
      message =
        removed.exitCode === 0
          ? `已删除 ${plan.path}${target.branch ? `，分支 ${target.branch} 保留` : ''}`
          : `删除失败：${firstLine(removed.stderr)}`
    }
    const worktrees = await listWorktrees($, cwd, top)
    await update($, snapshot, s => ({ ...s, worktrees }))
  } catch (err) {
    message = `删除失败：${String(err)}`
  } finally {
    running = false
    await update($, busy, () => '')
  }
  await update($, wtPlan, () => null)
  await update($, wtNote, () => message)
  $.ui.toast(message)
}

async function revert($: EngineInterface, branch: string, c: Commit) {
  if (running) return
  running = true
  await update($, busy, () => 'revert')
  await update($, confirming, () => '')
  let message: string
  try {
    message = await pushRevert($, branch, c)
  } catch (err) {
    message = `撤销失败：${String(err)}`
  } finally {
    running = false
    await update($, busy, () => '')
  }
  await update($, reverts, all => ({ ...all, [c.sha]: message }))
  $.ui.toast(message)
}

// Makes the revert in a throwaway worktree and pushes it as revert/<hash>:
// the watched branch and the person's own checkout are never touched.
async function pushRevert($: EngineInterface, branch: string, c: Commit): Promise<string> {
  const cwd = await $.session.cwd()
  // Ask git again rather than trust the pane's copy of the commit.
  const me = (await git($, cwd, ['config', 'user.email'])).stdout.trim().toLowerCase()
  const commit = (await readLog($, cwd, ['-1'], c.sha))[0]
  if (!commit || !canRevert(commit, me)) return '只能撤销完全由自己写的 AI 改动，已拒绝。'
  const target = `revert/${commit.hash}`
  const remote = await git($, cwd, ['ls-remote', '--exit-code', '--heads', 'origin', target], 60_000)
  if (remote.exitCode === 0) return `远端已有分支 ${target}，没有重复推送。`
  const base = (await git($, cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]))
    .exitCode === 0
    ? `origin/${branch}`
    : branch
  const gitDir = (await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
    .stdout.trim()
  // A revert cut short (the app quit mid-push) leaves its worktree behind: clear those first,
  // and give each run a folder of its own, so a leftover never blocks a later revert.
  for (const left of await listWorktrees($, cwd, '')) {
    if (left.path.includes(`${gitDir}/${REVERT_TREE}`)) await git($, cwd, ['worktree', 'remove', '--force', left.path])
  }
  await git($, cwd, ['worktree', 'prune'])
  const tree = `${gitDir}/${REVERT_TREE}${commit.hash}-${await $.clock.now()}`
  const added = await git($, cwd, ['worktree', 'add', '--detach', tree, base])
  if (added.exitCode !== 0) return `无法创建临时工作区：${firstLine(added.stderr)}`
  try {
    const mainline = commit.isMerge ? ['-m', '1'] : []
    const reverted = await git($, cwd, ['-C', tree, 'revert', '--no-edit', ...mainline, commit.sha])
    if (reverted.exitCode !== 0) {
      await git($, cwd, ['-C', tree, 'revert', '--abort'])
      return `撤销有冲突，没有推送：${firstLine(reverted.stderr || reverted.stdout)}`
    }
    const pushed = await git($, cwd, ['-C', tree, 'push', 'origin', `HEAD:refs/heads/${target}`], 120_000)
    if (pushed.exitCode !== 0) return `推送失败：${firstLine(pushed.stderr)}`
    return `已推送 ${target}，请提 PR 合并到 ${branch}。`
  } finally {
    await git($, cwd, ['worktree', 'remove', '--force', tree])
  }
}

export const register: Register = on => {
  // Opens the pane empty. No git here: it runs only when the person presses 加载Git or 查询分支.
  on('session.start', async ($, e, next) => {
    await update($, busy, () => '')
    await update($, confirming, () => '')
    await update($, wtPlan, () => null)
    await $.command.register({
      name: 'branch-status',
      description: '打开分支变更面板；带分支名（/branch-status master develop）则按它们查询',
    })
    await startDocLinks($)
    await startOverview($)
    await noteBuild($)
    void openPane($)
    return next(e)
  })

  // `/branch-status master develop` sets the list and queries it: the way to change
  // branches where a surface draws no input field.
  on('command.run', { command: 'branch-status' }, async ($, e) => {
    await openPane($)
    if (e.args.trim() === '') return { text: '已打开分支变更面板，点「加载Git」才会读取 Git。' }
    if (!(await query($, e.args))) return { text: '正在处理上一次操作，等它结束后再试。' }
    return { text: `已按 ${(await read($, branches)) || '默认分支'} 查询。` }
  })

  registerDocLinks(on)
  registerOverview(on)

  on('ui.render', { component: 'Pane', requestId: DETAIL_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, detail)
    if (d === null) return <Text dimColor>在「分支变更」里点一条提交，这里显示它的全文。</Text>
    const c = d.commit
    const lines = messageLines(c)
    return (
      <Box flexDirection="column">
        <Text bold color={c.ai ? 'red' : undefined} wrap="wrap">
          {c.ai ? '🚨 ' : ''}
          {c.subject}
        </Text>
        <Text dimColor>
          {c.hash} · {d.branch} · {fullTime(c.ts)}（{relTime(c.ts, await $.clock.now())}）
        </Text>
        <Text dimColor>{`${c.author} <${c.email}>`}</Text>
        {c.ai !== '' && (
          <Text color="red">
            AI 提交（{c.ai}）{c.isMerge ? '：这次合并带入了 AI 提交' : ''}
          </Text>
        )}
        {lines.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {lines.map(line => (
              <Text wrap="wrap">{line === '' ? ' ' : line}</Text>
            ))}
          </Box>
        )}
        {c.brought.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>合并带入的提交（{c.brought.length}）</Text>
            {c.brought.map(line => (
              <Text color={line.startsWith('🚨') ? 'red' : undefined} wrap="truncate-end">
                {'  '}
                {line}
              </Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>{c.sha}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    // The band redraws often: it reads one number, never the whole snapshot.
    const alarms = await read($, alarm)
    return (
      <Box justifyContent="flex-end">
        <Button key="open-overview" label="📋 任务概要" onPress={() => openOverview($)} />
        <Button key="open-docs" label="📚 关联文档" onPress={() => openDocPane($)} />
        <Button
          key="open-branches"
          label={alarms > 0 ? `🚨 分支记录 · 近5天 AI×${alarms}` : '🌿 分支记录'}
          onPress={() => openPane($)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const opened = await read($, open)
    const state = await read($, busy)
    const asking = await read($, confirming)
    const outcomes = await read($, reverts)
    const plan = await read($, wtPlan)
    const note = await read($, wtNote)
    const built = await buildLine($)
    const saved = await savedBranches($)
    const guarded = await readProtected($)
    const ownGuarded = await readAdded($)
    const now = await $.clock.now()
    const alarms = recentAiCount(s.branches)

    const status =
      state === 'query'
        ? '⏳ 正在查询…'
        : state === 'revert'
          ? '⏳ 正在撤销…'
          : state === 'worktree'
            ? '⏳ 正在处理 worktree…'
            : s.at === 0
            ? '填写分支名（空格分隔），点「加载Git」读取（输入框里按「查询分支」也可以）；不点不会运行任何 Git 命令。'
            : `上次查询 ${relTime(s.at, now)} · ${s.branches.length} 个分支 · 近5天 AI 提交 ${alarms} 条（${fullTime(s.at - RECENT_MS)} 以来，🚨 标出的行）`

    return (
      <Box flexDirection="column">
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Input
              key="branch-names"
              label="分支 "
              placeholder={guarded.join(' ')}
              value={draft ?? saved}
              submitLabel="查询分支"
              onInput={text => {
                draft = text
              }}
              onSubmit={text => query($, text)}
            />
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button
              key="refresh"
              label={state === 'query' ? '⏳ 加载中…' : '🔄 加载Git'}
              onPress={() => query($, draft ?? saved)}
            />
          </Box>
        </Box>
        <Text color={alarms > 0 && state === '' ? 'red' : undefined} dimColor={alarms === 0}>
          {status}
        </Text>
        {s.warnings.map(w => (
          <Text color="yellow">⚠ {w}</Text>
        ))}
        {s.error !== '' && <Text color="red">{s.error}</Text>}

        {s.branches.map(b => {
          const isOpen = opened[b.name] === true
          const top = b.commits[0]
          const badge = b.aiRecent.length
          // 🚨 marks exactly the rows the badge counts: AI commits of the 5-day window.
          const inWindow = new Set(b.aiRecent)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Button
                    key={`toggle-${b.name}`}
                    label={`${isOpen ? '▼' : '▶'} ${b.name}`}
                    onPress={() => update($, open, all => ({ ...all, [b.name]: !all[b.name] }))}
                  />
                  {badge > 0 && (
                    <Text color="red" bold>
                      {' '}🚨 AI×{badge}
                    </Text>
                  )}
                  {guarded.includes(b.name) ? (
                    <Text color="green"> 🛡 受保护</Text>
                  ) : (
                    <Button key={`protect-${b.name}`} label="🛡 保护" onPress={() => setProtected($, b.name, true)} />
                  )}
                  {ownGuarded.includes(b.name) && (
                    <Button
                      key={`unprotect-${b.name}`}
                      label="取消保护"
                      dimColor
                      onPress={() => setProtected($, b.name, false)}
                    />
                  )}
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  <Text dimColor>{top ? `${relTime(top.ts, now)} · ${top.author}` : '没有提交'}</Text>
                </Box>
              </Box>

              {isOpen &&
                b.commits.map(c => {
                  const id = `${b.name}:${c.sha}`
                  const mayRevert = canRevert(c, s.me) && outcomes[c.sha] === undefined
                  const preview = messageLines(c)
                  return (
                    // A keyed Box is a hover scope: the pointer over the row reveals its message.
                    <Box key={`row-${id}`} flexDirection="column" paddingLeft={2}>
                      <Box>
                        <Box flexGrow={1} flexShrink={1}>
                          <Button key={`open-${id}`} plain onPress={() => openDetail($, b.name, c)}>
                            <Text color={c.ai ? 'red' : 'yellow'}>
                              {inWindow.has(c.sha) ? '🚨 ' : ''}
                              {c.hash}
                            </Text>
                            <Text color={c.ai ? 'red' : undefined} wrap="truncate-end">
                              {c.isMerge ? ' ⑂' : ''} {c.subject}
                            </Text>
                          </Button>
                        </Box>
                        <Box flexShrink={0} marginLeft={1}>
                          <Text color={c.ai ? 'red' : undefined} dimColor={!c.ai}>
                            {c.ai ? `[${c.ai}] ` : ''}
                            {relTime(c.ts, now)} · {c.author}
                          </Text>
                          <Button key={`full-${id}`} label="📄 全文" dimColor onPress={() => openDetail($, b.name, c)} />
                          {mayRevert && asking !== id && (
                            <Button
                              key={`revert-${id}`}
                              label="↩ 撤销"
                              onPress={() => update($, confirming, () => id)}
                            />
                          )}
                        </Box>
                      </Box>
                      <Box
                        display="none"
                        hover={{ display: 'flex' }}
                        flexDirection="column"
                        borderStyle="round"
                        borderDimColor
                        paddingX={1}
                        marginLeft={2}
                      >
                        {preview.slice(0, PREVIEW_LINES).map(line => (
                          <Text wrap="wrap">{line === '' ? ' ' : line}</Text>
                        ))}
                        {c.brought.length > 0 && <Text dimColor>合并带入 {c.brought.length} 个提交</Text>}
                        {(preview.length === 0 && c.brought.length === 0) || preview.length > PREVIEW_LINES ? (
                          <Text dimColor>
                            {preview.length === 0 && c.brought.length === 0
                              ? '（只有标题）'
                              : `…还有 ${preview.length - PREVIEW_LINES} 行`}
                          </Text>
                        ) : null}
                        <Box>
                          <Button key={`more-${id}`} label="📄 打开全文" onPress={() => openDetail($, b.name, c)} />
                        </Box>
                      </Box>
                      {mayRevert && asking === id && (
                        <Box paddingLeft={2}>
                          <Text color="yellow">推送分支 revert/{c.hash} 来撤销这条提交？</Text>
                          <Button key={`confirm-${id}`} label="确认" onPress={() => revert($, b.name, c)} />
                          <Button
                            key={`cancel-${id}`}
                            label="取消"
                            onPress={() => update($, confirming, () => '')}
                          />
                        </Box>
                      )}
                      {outcomes[c.sha] !== undefined && (
                        <Box paddingLeft={2}>
                          <Text dimColor>↳ {outcomes[c.sha]}</Text>
                        </Box>
                      )}
                    </Box>
                  )
                })}
            </Box>
          )
        })}

        {s.worktrees.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Worktree（{s.worktrees.length}）</Text>
            {note !== '' && <Text dimColor>↳ {note}</Text>}
            {s.worktrees.map(t => (
              <Box flexDirection="column">
                <Box>
                  {canDeleteWorktree(t) && plan?.path !== t.path && (
                    <Box flexShrink={0} marginRight={1}>
                      <Button
                        key={`wt-delete-${t.path}`}
                        label={t.isPrunable ? '🧹 清理' : '🗑 删除'}
                        onPress={() => inspectWorktree($, t)}
                      />
                    </Box>
                  )}
                  <Box flexShrink={0}>
                    <Text color={t.isCurrent ? 'green' : undefined} bold={t.isCurrent} dimColor={!t.isCurrent}>
                      {t.isCurrent ? '● ' : '○ '}
                      {t.branch !== '' ? t.branch : `(detached ${t.head})`}
                      {t.isCurrent ? '  ← 当前' : ''}
                      {t.isMain && !t.isCurrent ? '  (主)' : ''}
                      {t.isLocked ? ' 🔒' : ''}
                      {t.isPrunable ? ' (已失效)' : ''}
                    </Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} marginLeft={2}>
                    <Text color={t.isCurrent ? 'green' : undefined} dimColor={!t.isCurrent} wrap="truncate-start">
                      {t.path}
                    </Text>
                  </Box>
                </Box>
                {plan?.path === t.path && (
                  <Box flexDirection="column" paddingLeft={2}>
                    {plan.error !== '' && <Text color="red">{plan.error}</Text>}
                    {plan.isPrune && <Text color="yellow">目录已不存在，只清理 git 里的记录。</Text>}
                    {deleteSections(plan).map(part => (
                      <Box flexDirection="column">
                        <Text color={part.color}>{part.title}</Text>
                        {part.lines.slice(0, DETAIL_ROWS).map(line => (
                          <Text color={part.color} wrap="truncate-end">
                            {'  '}
                            {line}
                          </Text>
                        ))}
                        {part.lines.length > DETAIL_ROWS && (
                          <Text color={part.color}>
                            {'  '}…另有 {part.lines.length - DETAIL_ROWS} 项
                          </Text>
                        )}
                      </Box>
                    ))}
                    {plan.error === '' && !plan.isPrune && deleteSections(plan).length === 0 && (
                      <Text dimColor>没有未提交、未合并或被忽略的内容，可以放心删除。</Text>
                    )}
                    <Box>
                      {plan.error === '' && (
                        <Button
                          key={`wt-confirm-${t.path}`}
                          label={confirmLabel(plan)}
                          onPress={() => removeWorktree($)}
                        />
                      )}
                      <Button key={`wt-cancel-${t.path}`} label="取消" onPress={() => update($, wtPlan, () => null)} />
                    </Box>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
        {built !== '' && (
          <Box marginTop={1}>
            <Text dimColor>{built}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
