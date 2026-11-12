// Pure rules of the task overview: the WBS format, how it is read and counted, the
// 140-character summary, and the prompts. No `$`, no files: everything here is tested directly.
import type { Mismatch, MismatchKind, Overview, WbsStatus, WbsTask } from '../../types'

export const WBS_PATH = 'docs/WBS.md'
export const SUMMARY_LIMIT = 140
export const MAX_ROWS = 200
const MAX_COMMITS = 60
const MAX_PATHS = 30
const NOTE_LIMIT = 40

// The one table format: the parser reads it and the create prompt asks Claude for it.
export const WBS_COLUMNS = ['编号', '任务', '负责人', '预定开始', '预定结束', '实际结束', '工数(人日)', '进度%', '状态'] as const
export const WBS_STATUSES: readonly WbsStatus[] = ['未开始', '进行中', '已完成', '已取消']
export const WBS_HEADER_ROW = `| ${WBS_COLUMNS.join(' | ')} |`
export const WBS_RULE_ROW = `|${WBS_COLUMNS.map(() => '---').join('|')}|`
export const WBS_EXAMPLE_ROW = '| 1.1 | 要件定义书评审 | 张三 | 2026-11-01 | 2026-11-05 | 2026-11-04 | 2 | 100 | 已完成 |'

type Field = 'id' | 'name' | 'owner' | 'start' | 'due' | 'finished' | 'effort' | 'progress' | 'status'

// Header names each field answers to, after normHeader: the format's own first.
const HEADERS: Record<Field, readonly string[]> = {
  id: ['编号', 'no', 'id', 'wbs', '番号'],
  name: ['任务', '任务名', 'task', 'タスク', '作業'],
  owner: ['负责人', '担当', '担当者', 'owner'],
  start: ['预定开始', '计划开始', '开始', '開始予定', 'start'],
  due: ['预定结束', '计划结束', '结束', '期限', '終了予定', 'due', 'end'],
  finished: ['实际结束', '完成日', '実績終了', 'finished'],
  effort: ['工数(人日)', '工数', '人日', 'effort'],
  progress: ['进度%', '进度', '進捗', '進捗率', 'progress', '%'],
  status: ['状态', '状態', 'status', 'ステータス'],
}

const STATUS_WORDS: Record<string, WbsStatus> = {
  未开始: '未开始', 未着手: '未开始', todo: '未开始',
  进行中: '进行中', 作業中: '进行中', 対応中: '进行中', doing: '进行中',
  已完成: '已完成', 完成: '已完成', 完了: '已完成', done: '已完成',
  已取消: '已取消', 取消: '已取消', 中止: '已取消', cancelled: '已取消', canceled: '已取消',
}

/** A header cell as matched: no spaces, half-width brackets and percent, lower-cased. */
export function normHeader(cell: string): string {
  return cell
    .trim()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/％/g, '%')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** The cells of one table row: outer pipes optional, `\|` kept inside a cell. */
export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return body.split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim())
}

const RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/

function columnsOf(header: string[]): Partial<Record<Field, number>> {
  const found: Partial<Record<Field, number>> = {}
  header.forEach((cell, index) => {
    const name = normHeader(cell)
    for (const field of Object.keys(HEADERS) as Field[]) {
      if (found[field] === undefined && HEADERS[field].includes(name)) found[field] = index
    }
  })
  return found
}

/** YYYY-MM-DD from `2026-11-05`, `2026/11/5` and the like; '' when it is no date. */
export function normDate(cell: string): string | undefined {
  if (cell === '') return ''
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(cell)
  if (!m) return undefined
  const [, y, mo, d] = m
  return `${y}-${(mo ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`
}

export type ParsedWbs = { tasks: WbsTask[]; warnings: string[]; hasTable: boolean }

/** Reads the first table whose header names a task and a progress or status column. */
export function parseWbs(text: string): ParsedWbs {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const warnings: string[] = []
  const start = lines.findIndex(line => {
    if (!line.includes('|')) return false
    const cols = columnsOf(splitRow(line))
    return cols.name !== undefined && (cols.progress !== undefined || cols.status !== undefined)
  })
  if (start < 0) return { tasks: [], warnings, hasTable: false }
  const cols = columnsOf(splitRow(lines[start] ?? ''))
  const rows: Omit<WbsTask, 'isLeaf'>[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.includes('|')) break
    if (RULE.test(line.trim())) continue
    if (rows.length >= MAX_ROWS) {
      warnings.push(`WBS 超过 ${MAX_ROWS} 行，只统计了前 ${MAX_ROWS} 行。`)
      break
    }
    const cells = splitRow(line)
    const at = (field: Field) => {
      const index = cols[field]
      return index === undefined ? '' : (cells[index] ?? '')
    }
    const row = i + 1
    const name = at('name')
    if (name === '') {
      warnings.push(`第 ${row} 行没有任务名，已跳过。`)
      continue
    }
    const id = at('id') || `#${rows.length + 1}`

    const progressText = at('progress').replace(/%$/, '').trim()
    let progress = progressText === '' ? null : Number(progressText)
    if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      warnings.push(`第 ${row} 行（${id}）的进度「${at('progress')}」不是 0–100 的数，按 0 计。`)
      progress = 0
    }

    const statusText = at('status')
    let status = STATUS_WORDS[statusText.toLowerCase()] ?? STATUS_WORDS[statusText]
    if (status === undefined) {
      if (statusText !== '') warnings.push(`第 ${row} 行（${id}）的状态「${statusText}」不认识，按进度推断。`)
      status = progress === 100 ? '已完成' : (progress ?? 0) > 0 ? '进行中' : '未开始'
    }
    if (progress === null) progress = status === '已完成' ? 100 : 0
    if (status === '已完成' && progress < 100) {
      warnings.push(`第 ${row} 行（${id}）状态是已完成，进度却是 ${progress}%。`)
    }
    if (status === '未开始' && progress > 0) {
      warnings.push(`第 ${row} 行（${id}）状态是未开始，进度却是 ${progress}%。`)
    }

    const dates = { start: at('start'), due: at('due'), finished: at('finished') }
    const norm = { start: '', due: '', finished: '' }
    for (const key of ['start', 'due', 'finished'] as const) {
      const value = normDate(dates[key])
      if (value === undefined) warnings.push(`第 ${row} 行（${id}）的日期「${dates[key]}」看不懂，已忽略。`)
      norm[key] = value ?? ''
    }

    const effortText = at('effort')
    let effort: number | null = effortText === '' ? null : Number(effortText)
    if (effort !== null && (!Number.isFinite(effort) || effort < 0)) {
      warnings.push(`第 ${row} 行（${id}）的工数「${effortText}」不是数，已忽略。`)
      effort = null
    }
    rows.push({ id, name, owner: at('owner'), ...norm, effort, progress, status })
  }
  const tasks = rows.map(t => ({
    ...t,
    isLeaf: !rows.some(other => other.id !== t.id && other.id.startsWith(`${t.id}.`)),
  }))
  return { tasks, warnings, hasTable: true }
}

export type Completion = { percent: number | null; byEffort: boolean; done: number; total: number }

/**
 * Leaves only (a parent's own numbers never count twice), 已取消 left out. Weighted by
 * 工数 when every counted task has one; otherwise each task counts the same.
 */
export function completion(tasks: readonly WbsTask[]): Completion {
  const counted = tasks.filter(t => t.isLeaf && t.status !== '已取消')
  const done = counted.filter(t => t.status === '已完成').length
  if (counted.length === 0) return { percent: null, byEffort: false, done, total: 0 }
  const byEffort = counted.every(t => t.effort !== null && t.effort > 0)
  const weight = (t: WbsTask) => (byEffort ? (t.effort ?? 0) : 1)
  const total = counted.reduce((sum, t) => sum + weight(t), 0)
  const reached = counted.reduce((sum, t) => sum + weight(t) * t.progress, 0)
  return { percent: Math.round(reached / total), byEffort, done, total: counted.length }
}

/** Local YYYY-MM-DD of a moment. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isOverdue(t: WbsTask, today: string): boolean {
  return t.due !== '' && t.due < today && t.status !== '已完成' && t.status !== '已取消'
}

/** Open leaf tasks: overdue first, then by due date (none last), then by id. */
export function unfinished(tasks: readonly WbsTask[], today: string): WbsTask[] {
  const open = tasks.filter(t => t.isLeaf && t.status !== '已完成' && t.status !== '已取消')
  return open.sort(
    (a, b) =>
      Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
      (a.due || '9999').localeCompare(b.due || '9999') ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  )
}

/** Cut to 140 characters (code points, not UTF-16 units): 139 and an ellipsis past it. */
export function capSummary(text: string): string {
  const chars = [...text.trim().replace(/\s+/g, ' ')]
  return chars.length <= SUMMARY_LIMIT ? chars.join('') : `${chars.slice(0, SUMMARY_LIMIT - 1).join('')}…`
}

/** The summary from the numbers alone, for when the model cannot write one. */
export function fallbackSummary(c: Completion, open: readonly WbsTask[], today: string): string {
  if (c.percent === null) return 'WBS 里还没有可统计的任务。'
  const late = open.filter(t => isOverdue(t, today)).length
  const how = c.byEffort ? '按工数加权' : '按任务数'
  return capSummary(
    `完成度 ${c.percent}%（${how}），已完成 ${c.done}/${c.total} 项，未完成 ${open.length} 项` +
      (late ? `，其中逾期 ${late} 项。` : '。'),
  )
}

export const CHECK_SYSTEM =
  "You review a project's WBS against its git history and working tree. Reply with JSON only, no prose."

export type ProjectState = { branch: string; commits: string[]; changed: string[] }

export function buildCheckPrompt(today: string, tasks: readonly WbsTask[], state: ProjectState): string {
  const rows = tasks
    .slice(0, MAX_ROWS)
    .map(t => `${t.id} | ${t.name} | ${t.status} | ${t.progress}% | ${t.due || '-'}`)
  return [
    `今天：${today}`,
    `当前分支：${state.branch || '（不明）'}`,
    '',
    'WBS（编号 | 任务 | 状态 | 进度 | 预定结束）：',
    ...rows,
    '',
    `最近的 Git 提交（短哈希 日期 标题），最多 ${MAX_COMMITS} 条：`,
    ...(state.commits.length ? state.commits.slice(0, MAX_COMMITS) : ['（没有）']),
    '',
    `工作区未提交的改动（git status），最多 ${MAX_PATHS} 条：`,
    ...(state.changed.length ? state.changed.slice(0, MAX_PATHS) : ['（没有）']),
    '',
    `1. 用不超过 ${SUMMARY_LIMIT} 字的中文写项目任务概要：整体进展、当前重点、主要风险。`,
    '2. 找出 WBS 与实际不符的任务：',
    '   done-without-change：WBS 写已完成，但提交和改动里看不到对应的工作；',
    '   changed-but-not-updated：提交或改动里已有明显的相关工作，但 WBS 仍是未开始或进度明显偏低。',
    '   没有把握就不要列。',
    `只输出 JSON：{"summary":"...","mismatches":[{"id":"编号","kind":"done-without-change","note":"不超过${NOTE_LIMIT}字"}]}`,
  ].join('\n')
}

export type Check = { summary: string; mismatches: Mismatch[] }

/** Reads the model's JSON; only ids of the WBS and the two kinds survive, every text capped. */
export function parseCheck(text: string, tasks: readonly WbsTask[]): Check | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: { summary?: unknown; mismatches?: unknown }
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as typeof parsed
  } catch {
    return undefined
  }
  if (typeof parsed.summary !== 'string' || parsed.summary.trim() === '') return undefined
  const ids = new Set(tasks.map(t => t.id))
  const kinds: readonly MismatchKind[] = ['done-without-change', 'changed-but-not-updated']
  const mismatches: Mismatch[] = []
  for (const item of Array.isArray(parsed.mismatches) ? parsed.mismatches : []) {
    const m = item as { id?: unknown; kind?: unknown; note?: unknown }
    const id = String(m.id ?? '')
    const kind = kinds.find(k => k === m.kind)
    if (!ids.has(id) || kind === undefined || mismatches.some(x => x.id === id)) continue
    mismatches.push({ id, kind, note: [...String(m.note ?? '').replace(/\s+/g, ' ')].slice(0, NOTE_LIMIT).join('') })
  }
  return { summary: capSummary(parsed.summary), mismatches }
}

export const MISMATCH_TEXT: Record<MismatchKind, string> = {
  'done-without-change': 'WBS 写已完成，但看不到对应改动',
  'changed-but-not-updated': '已有相关改动，但 WBS 没更新',
}

/** A stored overview from this version of the pane, or undefined for anything else. */
export function restoredOverview(value: unknown): Overview | undefined {
  const r = value as Partial<Overview> | null | undefined
  const fits =
    typeof r?.at === 'number' &&
    typeof r.root === 'string' &&
    typeof r.wbsPath === 'string' &&
    typeof r.summary === 'string' &&
    Array.isArray(r.tasks) &&
    Array.isArray(r.mismatches) &&
    Array.isArray(r.warnings)
  return fits ? (r as Overview) : undefined
}

// The first line of the create prompt.
export const CREATE_HEADER = `请为这个项目新建 WBS：${WBS_PATH}（由「任务概要」窗格发起）。`

/**
 * The prompt the 新建 WBS button hands to Claude as the person's own words: this
 * template alone, with the table format the parser reads.
 */
export function buildCreatePrompt(): string {
  return [
    CREATE_HEADER,
    '',
    '要求：',
    '1. 先阅读项目的要件定义、设计书、测试设计、代码结构和 Git 历史，再拆分任务。',
    `2. 只新建 ${WBS_PATH}（docs 目录不存在就建），不修改其他文件；如果它已经存在，不要覆盖，告诉我。`,
    '3. 正文是一张表，表头和列的顺序必须和下面完全一致；编号用 1、1.1、1.1.1 表示层级：',
    '',
    WBS_HEADER_ROW,
    WBS_RULE_ROW,
    WBS_EXAMPLE_ROW,
    '',
    `4. 状态只用：${WBS_STATUSES.join('、')}；日期用 YYYY-MM-DD；进度填 0–100 的整数；不确定的单元格留空。`,
    '5. 已能从 Git 历史或现有文档确认完成的任务，标为已完成、进度 100，实际结束填完成日期。',
    '6. 文档只写最终状态，不写过程说明。不要提交或推送。完成后简要说明拆分依据。',
  ].join('\n')
}
