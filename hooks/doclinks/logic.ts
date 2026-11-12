// Pure rules of the doc pane: which file is which kind of document, what the
// task is, how the model's ranking is read, and the update prompt's text.
import type { DocKind, DocLink, DocResult, FileState } from '../../types'
import { projectKey } from '../core/util'

export { fullPath, isAbsolutePath } from '../core/util'

// Where documents are looked for, relative to the project root; any top-level folder
// whose name looks like documents is looked through as well (DOC_FOLDER).
export const DOC_ROOTS = ['docs', 'doc', '.quality/docs', '.quality/test-design']
const DOC_FOLDER =
  /設計|设计|design|spec|仕様|规格|規格|テスト|测试|試験|test|要件|需求|requirement|wbs|計画|计划|plan|資料|资料|文档|ドキュメント|(^|[^a-z])docs?([^a-z]|$)/i
export const DOC_EXTS = ['.xlsx', '.xlsm', '.xls', '.md', '.markdown', '.txt', '.nema']

/** A .nema document: domains several agents edit, tracked by domain as well as by SHA256. */
export function isNemaPath(path: string): boolean {
  return /\.nema$/i.test(path)
}
export const MAX_DEPTH = 6
export const MAX_FILES = 2000
export const MAX_CANDIDATES = 300
// Content is read for the best this many candidates overall, and for the best few of each kind.
export const SNIPPETS_TOTAL = 16
export const SNIPPETS_PER_KIND = 2
// The first pass leans to recall: up to this many links of each kind.
export const LINKS_PER_KIND = 5
// How many of the person's latest requests in the session record make up the task.
export const TASK_MESSAGES = 6

export const KINDS: ReadonlyArray<{ kind: DocKind; label: string }> = [
  { kind: 'req', label: '要件定义' },
  { kind: 'basic', label: '基本设计' },
  { kind: 'detail', label: '详细设计' },
  { kind: 'ut', label: 'UT 测试设计' },
  { kind: 'it', label: 'IT 测试设计' },
  { kind: 'st', label: 'ST 测试设计' },
  { kind: 'spec', label: 'SPEC 规格说明' },
  { kind: 'plan', label: 'PLAN 计划' },
  { kind: 'other', label: '其他相关文档' },
]

const KIND_NAMES = new Set<string>(KINDS.map(k => k.kind))

/** A top-level folder of the project worth looking through for documents. */
export function isDocFolder(name: string): boolean {
  return !name.startsWith('.') && name !== 'node_modules' && DOC_FOLDER.test(name)
}

export function kindLabel(kind: DocKind): string {
  return KINDS.find(k => k.kind === kind)?.label ?? kind
}

// Tests first, so "結合テスト仕様書" under a design folder is still a test design.
// UT/IT/ST/BD/DD count only as whole tokens, never inside a word like "edit".
const token = (t: string) => `(^|[^a-z])${t}([^a-z]|$)`
// Japanese teams write テスト or 試験, Chinese ones 测试 or 试验: every level takes all four.
const RULES: ReadonlyArray<[DocKind, RegExp]> = [
  [
    'ut',
    new RegExp(
      `単体テスト|単体試験|ユニットテスト|ユニット試験|单体测试|单体试验|单元测试|单元试验|单测|模块测试|unit[ _-]?test|${token('ut')}|(^|/)\\.quality/test-design/`,
    ),
  ],
  [
    'it',
    new RegExp(
      `結合テスト|結合試験|结合测试|结合试验|集成测试|集成试验|联调|接口测试|integration[ _-]?test|${token('it')}`,
    ),
  ],
  [
    'st',
    new RegExp(
      `総合テスト|総合試験|システムテスト|システム試験|系统测试|系统试验|综合测试|综合试验|system[ _-]?test|${token('st')}`,
    ),
  ],
  ['req', /要件定義|要件定义|要求定義|需求|requirements?/],
  ['basic', new RegExp(`基本設計|基本设计|概要設計|概要设计|外部設計|外部设计|basic[ _-]?design|${token('bd')}`)],
  [
    'detail',
    new RegExp(`詳細設計|详细设计|機能設計|功能设计|内部設計|内部设计|detail(ed)?[ _-]?design|${token('dd')}|(^|/)\\.quality/docs/`),
  ],
  // Last, after every named level and every design: a test document that names no level
  // (テスト仕様兼結果書, 試験仕様書, 测试用例) is most often a unit test design.
  [
    'ut',
    /テスト仕様|試験仕様|テストケース|テスト項目|試験項目|テスト観点|测试用例|测试设计|测试方案|测试规格|测试规范|试验规格|test[ _-]?(case|spec|design)/,
  ],
  // Then specifications and plans, which no test or design name above has claimed.
  ['spec', new RegExp(`仕様|规格说明|规格书|規格書|说明书|specification|${token('specs?')}`)],
  ['plan', new RegExp(`計画|计划|ロードマップ|スケジュール|进度表|roadmap|${token('plans?')}|${token('wbs')}`)],
]

/** The words of a folder name, lower-cased, three letters or more: `OA-Partner` → ['partner']. */
export function nameWords(name: string): string[] {
  return (name.toLowerCase().match(/[a-z]{3,}|[\u3040-\u30ff\u4e00-\u9fff]{2,}/g) ?? []).filter(
    w => !['docs', 'doc', 'final', 'mock', 'the', 'and', 'project'].includes(w),
  )
}

/**
 * A folder beside the project that may hold its documents: one whose name shares a
 * word with the project's (SHOP_V2_UI_DOCS ↔ Shop-App), or looks like documents.
 */
export function isRelatedFolder(projectName: string, name: string): boolean {
  if (name.startsWith('.') || name.toLowerCase() === projectName.toLowerCase()) return false
  const own = new Set(nameWords(projectName))
  return nameWords(name).some(w => own.has(w)) || isDocFolder(name)
}

/** The folder a path lies in; a drive's root keeps its slash (`C:/`). */
export function parentOf(path: string): string {
  const up = path.replace(/\/[^/]+\/?$/, '')
  return /^[A-Za-z]:$/.test(up) ? `${up}/` : up
}

/** An extra folder as kept: forward slashes, no quotes, no trailing slash. */
export function folderOf(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/** The kind of document a project-relative path is, or undefined for any other file. */
export function classify(relPath: string): DocKind | undefined {
  const p = relPath.replace(/\\/g, '/').toLowerCase()
  return RULES.find(([, rule]) => rule.test(p))?.[0]
}

export function isDocFile(name: string): boolean {
  const lower = name.toLowerCase()
  return !name.startsWith('~$') && DOC_EXTS.some(ext => lower.endsWith(ext))
}

// The first line of the prompt the update button sends: never read back as the task.
export const UPDATE_HEADER = '请根据当前任务的实际代码改动，更新下面这些关联文档（由「关联文档」窗格选出）：'

export type SessionLine = { role: 'user' | 'assistant'; text: string; toolResults?: readonly unknown[] }

// The tags the engine wraps around what it adds to a user message (reminders, notices,
// command echoes). Only these are stripped: a tag the person typed stays in their words.
const ENGINE_TAGS =
  /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|command-message|command-name|command-args|task-notification|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)\b[^>]*>[\s\S]*?<\/\1>/gi
const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/i
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/i
// User messages no one typed: a skill's body, an interruption marker, a compaction summary.
const NOT_TYPED = /^(base directory for this skill:|\[request interrupted|this session is being continued from a previous conversation)/i

/**
 * The person's own words in one session message, or '' for anything else. A slash
 * command counts by what was typed after it: `/kinoshekeisho-gen 勤怠の機能設計書`.
 * The record names no origin, so this is a best reading: it feeds only the ranking
 * model, never a prompt sent in the person's name.
 */
export function personText(m: SessionLine): string {
  if (m.role !== 'user' || (m.toolResults?.length ?? 0) > 0) return ''
  const command = COMMAND_NAME.exec(m.text)
  if (command) {
    const args = COMMAND_ARGS.exec(m.text)?.[1]?.trim() ?? ''
    return args ? `${command[1] ?? ''} ${args}`.trim() : ''
  }
  const text = m.text.replace(ENGINE_TAGS, '').trim()
  if (text === '' || NOT_TYPED.test(text) || text.startsWith(UPDATE_HEADER)) return ''
  return text
}

export type Task = {
  // The person's latest requests, oldest first.
  asked: string[]
  // Claude's latest reply, as context for ranking only.
  reply: string
}

/** The task as the session record states it. */
export function taskFrom(messages: readonly SessionLine[]): Task {
  const asked = messages.map(personText).filter(Boolean).slice(-TASK_MESSAGES)
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')
  return { asked, reply: last?.text.trim().slice(0, 800) ?? '' }
}

/** The person's requests as the ranking model reads them, capped. */
export function taskText(asked: readonly string[]): string {
  return asked.map(p => p.trim().slice(0, 500)).join('\n---\n')
}

/** What the ranking model reads as the task: the requests, then the latest reply. */
export function rankingTask(task: Task): string {
  const reply = task.reply ? `\n\n（助手最近的回复，仅供参考）\n${task.reply}` : ''
  return `${taskText(task.asked)}${reply}`
}

/** ASCII words and CJK bigrams of a text, lower-cased. */
export function keywords(text: string): Set<string> {
  const words = new Set((text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []).filter(w => !/^\d+$/.test(w)))
  for (const run of text.match(/[぀-ヿ一-鿿]+/g) ?? []) {
    if (run.length === 1) continue
    for (let i = 0; i + 2 <= run.length; i++) words.add(run.slice(i, i + 2))
  }
  return words
}

export function keywordScore(words: Set<string>, hay: string): number {
  const lower = hay.toLowerCase()
  let hits = 0
  for (const w of words) if (lower.includes(w)) hits++
  return hits
}

export type Candidate = {
  id: number
  path: string
  // The kind its name suggests, 'other' when it suggests none: a hint, the model decides.
  kind: DocKind
  mtimeMs: number
  snippet: string
  score: number
}

/** Highest keyword score first, then the most recently changed. */
export function byRelevance(a: Candidate, b: Candidate): number {
  return b.score - a.score || b.mtimeMs - a.mtimeMs
}

export const RANK_SYSTEM =
  'You link a software development task to the project documents it touches. ' +
  'Documents may be Japanese or Chinese while the task may be Chinese: match by meaning ' +
  '(e.g. 设计/設計, 测试/テスト, 定义/定義). Reply with JSON only, no prose.'

export function buildRankPrompt(task: string, candidates: readonly Candidate[]): string {
  const lines = candidates.map(c => {
    const head = `[${c.id}] (${c.kind === 'other' ? '?' : c.kind}) ${c.path}`
    return c.snippet ? `${head}\n    内容: ${c.snippet.replace(/\s+/g, ' ').slice(0, 400)}` : head
  })
  return [
    '任务（开发者最近的提问）:',
    task,
    '',
    '候选文档（[编号] (按文件名猜的类型，? 表示猜不出) 路径）。类型：',
    'req=要件定义 basic=基本设计 detail=详细设计 ut=单元测试设计 it=结合测试设计 st=系统/综合测试设计 spec=规格说明/仕様書 plan=计划/計画書/WBS other=其他相关文档',
    ...lines,
    '',
    '这是第一轮关联，宁可多选也不要漏选：文件名不规范、只能从路径或内容看出可能相关的文档也要选上。',
    '按文件名猜的类型只是提示，请根据路径和内容自己判断每份文档属于哪一类；归不进以上各类但相关的标 other。',
    `每种类型最多 ${LINKS_PER_KIND} 份，按相关度从高到低；明显无关的不要选。`,
    '只输出 JSON: {"links":[{"id":编号,"kind":"类型","reason":"不超过30字的中文理由"}]}',
  ].join('\n')
}

/** Reads the model's JSON; only ids from the candidate list survive, so no path is invented. */
export function parseRanking(text: string, candidates: readonly Candidate[]): DocLink[] | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  const raw = (parsed as { links?: unknown }).links
  if (!Array.isArray(raw)) return undefined
  const byId = new Map(candidates.map(c => [c.id, c]))
  const links: DocLink[] = []
  for (const item of raw) {
    const pick = item as { id?: unknown; kind?: unknown; reason?: unknown }
    const c = byId.get(Number(pick.id))
    if (!c || links.some(l => l.path === c.path)) continue
    // The model's kind wins; one it can't name falls back to the name's hint.
    const said = String(pick.kind ?? '')
    const kind = KIND_NAMES.has(said) ? (said as DocKind) : c.kind
    if (links.filter(l => l.kind === kind).length >= LINKS_PER_KIND) continue
    const reason = String(pick.reason ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 60)
    links.push(newLink(kind, c.path, reason))
  }
  return links
}

export const COVER_REASON = '按类型补充：AI 未判定与本任务直接相关'

/**
 * Every named kind the scan found documents of gets at least one link: the best of that
 * kind by keywords and recency, marked as filled in by kind rather than chosen.
 */
export function coverKinds(links: readonly DocLink[], candidates: readonly Candidate[]): DocLink[] {
  const out = [...links]
  for (const { kind } of KINDS) {
    if (kind === 'other' || out.some(l => l.kind === kind)) continue
    const best = candidates.filter(c => c.kind === kind && !out.some(l => l.path === c.path)).sort(byRelevance)[0]
    if (best) out.push(newLink(kind, best.path, COVER_REASON))
  }
  return out
}

/** Without the model: the best keyword matches of each kind, those with any hit only. */
export function fallbackRanking(candidates: readonly Candidate[]): DocLink[] {
  return KINDS.flatMap(({ kind }) =>
    candidates
      .filter(c => c.kind === kind && c.score > 0)
      .sort(byRelevance)
      .slice(0, LINKS_PER_KIND)
      .map(c => newLink(kind, c.path, `关键词命中 ${c.score} 处`)),
  )
}

export function newLink(kind: DocKind, path: string, reason: string): DocLink {
  return { kind, path, reason, base: null, now: null, isMissing: false }
}

export type DocStatus = 'same' | 'changed' | 'missing' | 'unknown'

/** Whether a linked document changed since it was linked or last accepted. */
export function docStatus(l: DocLink): DocStatus {
  if (l.isMissing) return 'missing'
  if (l.base === null || l.now === null) return 'unknown'
  return l.base.sha256 === l.now.sha256 ? 'same' : 'changed'
}

export const STATUS_TEXT: Record<DocStatus, string> = {
  same: '未变化',
  changed: '关联后已修改',
  missing: '文件已不存在',
  unknown: '无法计算 SHA256',
}

/**
 * Lays freshly read file states onto the links. A link's first state becomes its
 * base; after that the base moves only when the person accepts the change.
 */
export function withSensed(links: readonly DocLink[], sensed: ReadonlyMap<string, FileState | 'missing'>): DocLink[] {
  return links.map(l => {
    const s = sensed.get(l.path)
    if (s === undefined) return l
    if (s === 'missing') return { ...l, now: null, isMissing: true }
    return { ...l, now: s, base: l.base ?? s, isMissing: false }
  })
}

/** Takes every document's current content, and a .nema document's current domains, as its new base. */
export function accepted(links: readonly DocLink[]): DocLink[] {
  return links.map(l => {
    const next = l.now === null ? l : { ...l, base: l.now }
    return next.nema ? { ...next, nema: { ...next.nema, base: next.nema.now } } : next
  })
}

/** The store kind a project's links are kept under, by its root, across sessions. */
export const DOC_KIND = 'docLinks'

export function storeKey(path: string): string {
  return projectKey(DOC_KIND, path)
}

/** A stored result from this version of the pane, or undefined for anything else. */
export function restored(value: unknown): DocResult | undefined {
  const r = value as Partial<DocResult> | null | undefined
  const fits =
    typeof r?.at === 'number' &&
    typeof r.checkedAt === 'number' &&
    typeof r.root === 'string' &&
    Array.isArray(r.links) &&
    r.links.every(l => typeof l?.path === 'string' && 'base' in l && 'now' in l)
  return fits ? { ...(r as DocResult), task: typeof r.task === 'string' ? r.task : '' } : undefined
}

/**
 * The prompt the update button hands to Claude as the person's own words. It is
 * built only from this template and paths found on disk: no session text, model
 * reason or document content, so nothing the person didn't write speaks in their name.
 * Claude reads the task from the conversation it is already in.
 */
export function buildUpdatePrompt(links: readonly DocLink[]): string {
  const clean = (path: string) => path.replace(/[\u0000-\u001f\u007f]/g, ' ')
  return [
    UPDATE_HEADER,
    ...links.map(l => `- 【${kindLabel(l.kind)}】${clean(l.path)}`),
    '',
    '当前任务以本会话前面的对话为准。',
    '',
    '要求：',
    '1. 先确认本任务的改动范围：未提交的改动，加上当前分支自与 develop 或 master 的分叉点以来的提交。只依据这些实际改动更新文档。',
    '2. 只修改上面列出的文档，保留原有格式、版式和样式；Excel 文档用 xlsx 技能编辑。某份文档与这次改动无关时不要修改，并说明原因。',
    '3. 文档里只写最终状态，不写过程说明或修改经过。',
    '4. 不要提交或推送。完成后按文档逐一列出改了哪些地方。',
    ...(links.some(l => isNemaPath(l.path))
      ? [
          '5. .nema 文档由多个 agent 按领域分工编辑：只改与本任务相关的领域，每改一个领域就把它领域头（` \\编号 修订号`）的修订号加 1；其他领域和所有领域编号保持原样。遵守 .nema 语法：领域头一个前导半角空格，字段之间一个半角空格，空格和特殊字符用反斜杠转义，不用 Tab 和全角空格。',
        ]
      : []),
  ].join('\n')
}
