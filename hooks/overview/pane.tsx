import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Overview } from '../../types'
import { buildFooter } from '../core/build'
import { projectRoot, runGit } from '../core/files'
import { loadNearest, saveForProject } from '../core/store'
import { fullTime, relTime } from '../core/util'
import {
  CHECK_SYSTEM,
  MISMATCH_TEXT,
  SUMMARY_LIMIT,
  WBS_NEMA_PATH,
  WBS_PATH,
  buildCheckPrompt,
  buildCreatePrompt,
  completion,
  fallbackSummary,
  isOverdue,
  localDate,
  parseCheck,
  parseWbs,
  restoredOverview,
  unfinished,
  wbsFromNema,
} from './wbs'
import type { ProjectState } from './wbs'

export const OVERVIEW_PANE = 'task-overview'
const TITLE = '任务概要'
const CHECK_MODEL = 'haiku'
// Open tasks listed before "…另有".
const OPEN_SHOWN = 30

const EMPTY: Overview = {
  at: 0, root: '', wbsPath: '', wbsMtime: 0, tasks: [], percent: null, byEffort: false, done: 0, total: 0,
  summary: '', isAiSummary: false, mismatches: [], warnings: [], error: '',
}

const result = atom({ plugin: 'dev-cockpit', key: 'ovResult' } as const, EMPTY, { shape: 'ovResult-1' })
const busy = atom({ plugin: 'dev-cockpit', key: 'ovBusy' } as const, false, { shape: 'ovBusy-1' })
const confirm = atom({ plugin: 'dev-cockpit', key: 'ovConfirm' } as const, false, { shape: 'ovConfirm-1' })
const note = atom({ plugin: 'dev-cockpit', key: 'ovNote' } as const, '', { shape: 'ovNote-1' })
// The unfinished tasks past OPEN_SHOWN are listed; tasks whose full text is pinned open.
const showAll = atom({ plugin: 'dev-cockpit', key: 'ovShowAll' } as const, false, { shape: 'ovShowAll-1' })
const openTasks = atom(
  { plugin: 'dev-cockpit', key: 'ovOpenTasks' } as const,
  {} as Record<string, boolean>,
  { shape: 'ovOpenTasks-1' },
)

// One run at a time: set before the first await.
let working = false

export function openOverview($: EngineInterface) {
  return $.ui.open({ id: OVERVIEW_PANE, title: TITLE })
}

// The store kind overviews are kept under, by project root.
const OVERVIEW_KIND = 'overview'

/**
 * This session's overview, else the latest kept for the session folder or a folder
 * above it (the project's root), from an earlier session.
 */
async function loadOverview($: EngineInterface): Promise<Overview> {
  const inSession = await read($, result)
  if (inSession.at !== 0 || inSession.error !== '') return inSession
  return (await loadNearest($, OVERVIEW_KIND, restoredOverview, o => o.at)) ?? EMPTY
}

// Keeps a good overview in this session and, under the project's root, for later ones;
// an error is never stored.
async function saveOverview($: EngineInterface, next: Overview) {
  const kept = { ...next, error: '' }
  await update($, result, () => kept)
  await saveForProject($, OVERVIEW_KIND, kept.root || (await $.session.cwd()), kept)
}

/** The project's WBS: `docs/WBS.md`, else `docs/WBS.nema`, any case. */
async function findWbs($: EngineInterface, root: string) {
  const entries = await $.fs.list(`${root}/docs`).catch(() => [])
  const hit =
    entries.find(e => e.kind === 'file' && /^wbs\.md$/i.test(e.name)) ??
    entries.find(e => e.kind === 'file' && /^wbs\.nema$/i.test(e.name))
  return hit ? { path: `docs/${hit.name}`, mtimeMs: hit.mtimeMs } : undefined
}

// What the project shows of its work, read locally: no fetch, nothing written.
async function projectState($: EngineInterface, root: string): Promise<ProjectState> {
  const lines = (ran: { exitCode: number; stdout: string } | undefined) =>
    ran?.exitCode === 0 ? ran.stdout.split('\n').map(line => line.trimEnd()).filter(Boolean) : []
  const branch = await runGit($, root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)
  const log = await runGit($, root, ['log', '-60', '--date=short', '--format=%h %ad %s']).catch(() => undefined)
  const status = await runGit($, root, ['status', '--porcelain']).catch(() => undefined)
  return { branch: lines(branch)[0] ?? '', commits: lines(log), changed: lines(status) }
}

async function gather($: EngineInterface): Promise<Overview> {
  const at = await $.clock.now()
  const today = localDate(at)
  const root = await projectRoot($)
  const found = await findWbs($, root)
  // No WBS is a state of the project, not a failure: the pane offers to create one.
  if (found === undefined) return { ...EMPTY, at, root }
  const base = { ...EMPTY, at, root, wbsPath: found.path, wbsMtime: found.mtimeMs }
  const text: unknown = await $.fs.read(`${root}/${found.path}`).catch((err: unknown) => err)
  if (typeof text !== 'string') return { ...base, error: `读不到 ${found.path}：${String(text)}` }
  // A .nema WBS: its task table domain, as the table parseWbs reads.
  const fromNema = /\.nema$/i.test(found.path) ? wbsFromNema(text) : undefined
  if (fromNema !== undefined && 'error' in fromNema) return { ...base, error: fromNema.error }
  const parsed = parseWbs(fromNema?.table ?? text)
  if (!parsed.hasTable) {
    return { ...base, error: `${found.path} 里没找到 WBS 表：表头要有「任务」列，以及「进度%」或「状态」列。` }
  }
  const counted = completion(parsed.tasks)
  const warnings = [...parsed.warnings]
  let summary = fallbackSummary(counted, unfinished(parsed.tasks, today), today)
  let isAiSummary = false
  let mismatches: Overview['mismatches'] = []
  if (parsed.tasks.length > 0) {
    const state = await projectState($, root)
    const answer = await $.model
      .complete({
        model: CHECK_MODEL,
        system: CHECK_SYSTEM,
        prompt: buildCheckPrompt(today, parsed.tasks, state),
        maxTokens: 1200,
        timeoutMs: 90_000,
      })
      .catch(() => undefined)
    const check = answer?.isAnswered ? parseCheck(answer.text, parsed.tasks) : undefined
    if (check) {
      summary = check.summary
      isAiSummary = true
      mismatches = check.mismatches
    } else {
      const why = answer === undefined ? '调用失败' : answer.isAnswered ? '回复无法解析' : answer.reason
      warnings.push(`AI 核对失败（${why}），概要按统计数据生成，没有对照实际改动。`)
    }
  }
  return { ...base, tasks: parsed.tasks, ...counted, summary, isAiSummary, mismatches, warnings }
}

// 生成概要: reads the WBS, counts it, and asks the model for the summary and a cross-check.
async function summarize($: EngineInterface) {
  if (working) return
  working = true
  await update($, busy, () => true)
  try {
    const before = await loadOverview($)
    const next = await gather($).catch(
      async (err): Promise<Overview> => ({ ...EMPTY, at: await $.clock.now(), error: String(err) }),
    )
    if (next.error !== '') {
      // A run that failed says why, here only: the last good overview stays, stored and shown.
      await update($, result, () => ({ ...before, error: next.error, warnings: next.warnings }))
      return
    }
    await saveOverview($, next)
    await update($, note, () => '')
    // A fresh count starts folded again.
    await update($, showAll, () => false)
    await update($, openTasks, () => ({}))
  } finally {
    working = false
    await update($, busy, () => false)
  }
}

// 确认新建: looks again for a WBS, and only without one hands Claude the fixed prompt.
async function createWbs($: EngineInterface) {
  await update($, confirm, () => false)
  if ((await findWbs($, await projectRoot($))) !== undefined) {
    await update($, note, () => `${WBS_PATH} 已经存在，没有发出新建指令。点「📊 生成概要」读取它。`)
    return
  }
  await $.prompt.submit({ text: buildCreatePrompt(), asUser: true })
  await update($, note, () => `已把新建 ${WBS_PATH} 交给 Claude，进度见对话。建好后点「📊 生成概要」。`)
  $.ui.toast(`已把新建 ${WBS_PATH} 交给 Claude`)
}

// The overview pane's part of session start, called from the plugin's one session.start hook.
export async function startOverview($: EngineInterface) {
  await update($, busy, () => false)
  await update($, confirm, () => false)
  await $.command.register({
    name: 'task-overview',
    description: '打开任务概要面板（点「生成概要」才会读取 WBS 和调用模型）',
  })
}

function bar(percent: number): string {
  const filled = Math.round(percent / 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`
}

export function registerOverview(on: On) {
  on('command.run', { command: 'task-overview' }, async $ => {
    await openOverview($)
    return { text: '已打开任务概要面板，点「生成概要」才会开始。' }
  })

  on('ui.render', { component: 'Pane', requestId: OVERVIEW_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const r = await loadOverview($)
    const isBusy = await read($, busy)
    const asking = await read($, confirm)
    const said = await read($, note)
    const footer = await buildFooter($, e)
    const now = await $.clock.now()
    const today = localDate(now)
    const open = unfinished(r.tasks, today)
    const hasWbs = r.wbsPath !== ''
    const names = new Map(r.tasks.map(t => [t.id, t.name]))
    const isAll = await read($, showAll)
    const pinned = await read($, openTasks)
    const listed = isAll ? open : open.slice(0, OPEN_SHOWN)

    const status = isBusy
      ? '⏳ 正在读取 WBS 并请 AI 核对…'
      : r.at === 0
        ? `点「生成概要」：读取 ${WBS_PATH}（或 ${WBS_NEMA_PATH}），统计完成度和未完成任务，并请 AI 对照 Git 核对。`
        : `上次统计 ${relTime(r.at, now)} · ${hasWbs ? `${r.wbsPath}（修改于 ${fullTime(r.wbsMtime)}）` : '项目里还没有 WBS'}`

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="ov-run" label={isBusy ? '⏳ 统计中…' : '📊 生成概要'} onPress={() => summarize($)} />
          {r.at !== 0 && !hasWbs && !asking && (
            <Button key="ov-create" label="📝 新建 WBS" onPress={() => update($, confirm, () => true)} />
          )}
        </Box>
        <Text dimColor>{status}</Text>
        {r.warnings.map(w => (
          <Text color="yellow">⚠ {w}</Text>
        ))}
        {r.error !== '' && <Text color="red">{r.error}</Text>}
        {r.at !== 0 && !hasWbs && r.error === '' && (
          <Text color="yellow">项目里没有 {WBS_PATH}。点「📝 新建 WBS」，让 Claude 按项目现状建立。</Text>
        )}
        {asking && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">将让 Claude 阅读项目后新建 {WBS_PATH}（不覆盖已有文件，不提交）。</Text>
            <Box>
              <Button key="ov-create-confirm" label="确认新建" onPress={() => createWbs($)} />
              <Button key="ov-create-cancel" label="取消" onPress={() => update($, confirm, () => false)} />
            </Box>
          </Box>
        )}
        {said !== '' && <Text dimColor>{said}</Text>}

        {hasWbs && r.summary !== '' && (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
            <Text wrap="wrap">{r.summary}</Text>
            <Text dimColor>
              {r.isAiSummary ? 'AI 概要' : '按统计生成'} · {[...r.summary].length}/{SUMMARY_LIMIT} 字
            </Text>
          </Box>
        )}

        {hasWbs && r.percent !== null && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              完成度 {r.percent}% {bar(r.percent)}
            </Text>
            <Text dimColor>
              已完成 {r.done}/{r.total} 项 · {r.byEffort ? '按工数加权' : '按任务数（有任务没填工数）'}
            </Text>
          </Box>
        )}
        {hasWbs && r.at !== 0 && r.percent === null && <Text dimColor>WBS 里还没有任务。</Text>}

        {hasWbs && open.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>未完成任务（{open.length}）</Text>
            {listed.map(t => {
              const late = isOverdue(t, today)
              const isPinned = pinned[t.id] === true
              // Hidden until the pointer is over the row; a press of the row keeps it open
              // (then it is simply shown: a hover may only reveal what is hidden).
              const full = (
                <Box
                  display={isPinned ? 'flex' : 'none'}
                  {...(isPinned ? {} : { hover: { display: 'flex' as const } })}
                  flexDirection="column"
                  borderStyle="round"
                  borderDimColor
                  paddingX={1}
                  marginLeft={2}
                >
                  <Text wrap="wrap">
                    📋 {t.id} {t.name}
                  </Text>
                  <Text dimColor wrap="wrap">
                    负责人 {t.owner || '未分配'} · 预定 {t.start || '—'} → {t.due || '—'} · 实际结束 {t.finished || '—'}
                  </Text>
                  <Text dimColor wrap="wrap">
                    工数 {t.effort === null ? '—' : `${t.effort} 人日`} · 进度 {t.progress}% · {t.status}
                    {late ? ' · ⚠ 已逾期' : ''}
                  </Text>
                </Box>
              )
              return (
                <Box key={`ov-task-${t.id}`} flexDirection="column">
                  <Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Button
                        key={`ov-task-open-${t.id}`}
                        plain
                        onPress={() => update($, openTasks, all => ({ ...all, [t.id]: !all[t.id] }))}
                      >
                        <Text color={late ? 'red' : undefined} wrap="truncate-end">
                          {isPinned ? '▼ ' : ''}
                          {late ? '⚠ 逾期 ' : ''}
                          {t.id} {t.name}
                        </Text>
                      </Button>
                    </Box>
                    <Box flexShrink={0} marginLeft={1}>
                      <Text color={late ? 'red' : undefined} dimColor={!late}>
                        {t.owner || '未分配'} · 预定 {t.due || '—'} · {t.progress}% {t.status}
                      </Text>
                    </Box>
                  </Box>
                  {full}
                </Box>
              )
            })}
            {open.length > OPEN_SHOWN && (
              <Box>
                <Button
                  key="ov-more"
                  label={isAll ? '▲ 收起' : `▶ 另有 ${open.length - OPEN_SHOWN} 项`}
                  plain
                  onPress={() => update($, showAll, v => !v)}
                />
              </Box>
            )}
          </Box>
        )}

        {hasWbs && r.mismatches.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="yellow">
              需要核对（AI 判断，仅供参考）（{r.mismatches.length}）
            </Text>
            {r.mismatches.map(m => (
              <Text color="yellow" wrap="wrap">
                {m.id} {names.get(m.id) ?? ''}：{MISMATCH_TEXT[m.kind]}
                {m.note ? `——${m.note}` : ''}
              </Text>
            ))}
          </Box>
        )}
        {footer}
      </Box>
    )
  })
}
