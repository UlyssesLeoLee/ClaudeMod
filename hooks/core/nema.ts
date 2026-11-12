// .nema: the person's multi-agent document format. Each domain (` \<tag><ID> <REV>`) is
// one agent's region; an agent edits its own domain and raises its revision. This reads
// files by the strict grammar of nema-thread and tells how domains changed. No `$`.
import type { NemaChange, NemaDomainState, NemaMode } from '../../types'

export type NemaValue = string | null | { missing: true }
export type NemaRecord = { kind?: 'node' | 'edge'; id?: string; from?: string; to?: string; values: NemaValue[] }
export type NemaDomain = {
  mode: NemaMode
  id: number
  revision: number
  // Table column names (given by `\#`, `\%` or the first record); null elsewhere.
  columns: string[] | null
  records: NemaRecord[]
  // The domain's body lines as written, for its fingerprint.
  rows: string[]
  // The header's line number.
  line: number
  hasHeader: boolean
  width: number | null
}
export type NemaParse = { domains: NemaDomain[]; error: string; errorLine: number }

const MISSING = { missing: true } as const
const EMPTY = '\u0000EMPTY\u0000'
const ESCAPES: Readonly<Record<string, string>> = {
  ' ': ' ', '\\': '\\', '?': '?', '>': '>', '<': '<', '=': '=', '~': '~', '^': '^', '#': '#', '_': '_', '%': '%',
  n: '\n', r: '\r', t: '\t', e: EMPTY,
}
const HEADER = /^ \\([?>]?)([1-9][0-9]*) ([1-9][0-9]*)$/
const BAD_HEADER = /^ +\\(?:[?>]?[0-9]|[?>]?\s)/
const GRAPH_ID = /^[A-Za-z][A-Za-z0-9_.:-]*$/
const EDGE = /^([A-Za-z][A-Za-z0-9_.:-]*)([><=])([A-Za-z][A-Za-z0-9_.:-]*)([><=])([A-Za-z][A-Za-z0-9_.:-]*)$/
const FIVE_W_ONE_H = 6

class NemaError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message)
  }
}

function fail(line: number, message: string): never {
  throw new NemaError(line, message)
}

type Part = ['raw' | 'literal', string]

function valueOf(parts: Part[]): NemaValue {
  const only = parts.length === 1 ? parts[0] : undefined
  if (only?.[0] === 'raw' && only[1] === '~') return null
  if (only?.[0] === 'literal' && only[1] === '_') return MISSING
  if (only?.[0] === 'literal' && only[1] === EMPTY) return ''
  return parts.map(p => (p[1] === EMPTY ? '' : p[1])).join('')
}

/** The fields of one line: single spaces split them, a backslash escapes the next character. */
export function nemaFields(s: string, line: number): NemaValue[] {
  if (s === '') fail(line, '空字段')
  const out: NemaValue[] = []
  let cur: Part[] = []
  for (let i = 0; i < s.length; ) {
    const c = s[i] ?? ''
    if (c === '\\') {
      const e = s[i + 1]
      if (e === undefined) fail(line, '行末是转义符 \\')
      const decoded = ESCAPES[e]
      if (decoded === undefined) fail(line, `未知转义 \\${e}`)
      cur.push(['literal', decoded])
      i += 2
    } else if (c === ' ') {
      if (cur.length === 0) fail(line, '字段之间只能有一个空格')
      out.push(valueOf(cur))
      cur = []
      i++
    } else {
      cur.push(['raw', c])
      i++
    }
  }
  if (cur.length === 0) fail(line, '行末有多余空格')
  out.push(valueOf(cur))
  return out
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function readBody(d: NemaDomain, l: string, n: number) {
  if (d.mode === 'table' && l.startsWith('\\#')) {
    if (d.records.length > 0 || d.hasHeader) fail(n, '表头只能有一个，且写在第一条记录之前')
    if (!l.startsWith('\\# ')) fail(n, '表头缺少列名')
    const names = nemaFields(l.slice(3), n)
    if (names.some(x => typeof x !== 'string' || x === '')) fail(n, '列名必须是非空文本')
    if (new Set(names).size !== names.length) fail(n, '列名重复')
    if (d.width !== null && names.length !== d.width) fail(n, `列名有 ${names.length} 个，与列宽 ${d.width} 不一致`)
    d.columns = names as string[]
    d.hasHeader = true
    return
  }
  if (d.mode === 'table' && l.startsWith('\\%')) {
    if (d.records.length > 0 || d.width !== null) fail(n, '列宽只能声明一次，且写在第一条记录之前')
    if (!/^\\%[1-9][0-9]*$/.test(l)) fail(n, '列宽应为正整数（\\%N）')
    d.width = Number(l.slice(2))
    if (d.hasHeader && d.columns?.length !== d.width) fail(n, `列宽 ${d.width} 与表头列数不一致`)
    if (!d.hasHeader) d.columns = Array.from({ length: d.width }, (_, j) => `column${j + 1}`)
    return
  }
  const leading = l.length - l.replace(/^ +/, '').length
  if (leading > 0) {
    const rec = d.records.at(-1)
    if (rec === undefined) fail(n, '续写行之前没有记录')
    const col = leading + (d.mode === 'graph' ? 1 : 0)
    if (d.mode === '5w1h' && col >= FIVE_W_ONE_H) fail(n, '5W1H 只有 6 列，续写超出')
    if (d.mode === 'table' && col >= (d.columns?.length ?? 0)) fail(n, `续写超出列宽（第 ${col + 1} 列）`)
    const vals = nemaFields(l.slice(leading), n)
    const v = vals[0]
    if (vals.length !== 1) fail(n, '续写行只能有一个字段')
    if (typeof v !== 'string') fail(n, '续写的内容必须是文本')
    const isNew = col >= rec.values.length
    while (rec.values.length <= col) rec.values.push(MISSING)
    const old = rec.values[col]
    if (old === null) fail(n, '不能在 null（~）上续写')
    if (typeof old === 'object' && old !== undefined) {
      if (d.mode === 'graph' && isNew) rec.values[col] = v
      else fail(n, '不能在缺失值（\\_）上续写')
    } else {
      rec.values[col] = `${old ?? ''}${v}`
    }
    return
  }
  const vals = nemaFields(l, n)
  if (d.mode === 'table') {
    if (d.columns === null) d.columns = vals.map((_, j) => `column${j + 1}`)
    if (vals.length > d.columns.length) fail(n, `记录有 ${vals.length} 列，超出列宽 ${d.columns.length}`)
    while (vals.length < d.columns.length) vals.push(MISSING)
    d.records.push({ values: vals })
  } else if (d.mode === '5w1h') {
    if (vals.length > FIVE_W_ONE_H) fail(n, '5W1H 记录最多 6 个字段')
    while (vals.length < FIVE_W_ONE_H) vals.push(MISSING)
    d.records.push({ values: vals })
  } else {
    const token = vals[0]
    if (typeof token !== 'string') fail(n, '节点或边的编号无效')
    if (/[><=]/.test(token)) {
      const m = EDGE.exec(token)
      if (m === null || m[2] !== m[4]) fail(n, '边应写作 A>边>B、A<边<B 或 A=边=B')
      if (vals.length < 2) fail(n, '边缺少名称')
      const [, a = '', op = '', id = '', , b = ''] = m
      d.records.push({ kind: 'edge', id, from: op === '<' ? b : a, to: op === '<' ? a : b, values: vals })
    } else {
      if (!GRAPH_ID.test(token)) fail(n, `节点编号 ${token} 无效`)
      if (vals.length < 2) fail(n, '节点缺少名称')
      d.records.push({ kind: 'node', id: token, values: vals })
    }
  }
}

function checkGraph(d: NemaDomain) {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  for (const r of d.records) {
    const pool = r.kind === 'node' ? nodes : edges
    if (pool.has(r.id ?? '')) fail(d.line, `领域 \\>${d.id}：${r.kind === 'node' ? '节点' : '边'}编号 ${r.id} 重复`)
    pool.add(r.id ?? '')
  }
  for (const id of nodes) if (edges.has(id)) fail(d.line, `领域 \\>${d.id}：${id} 既是节点又是边`)
  for (const r of d.records) {
    if (r.kind === 'edge' && (!nodes.has(r.from ?? '') || !nodes.has(r.to ?? ''))) {
      fail(d.line, `领域 \\>${d.id}：边 ${r.id} 连到不存在的节点`)
    }
  }
}

function readAll(raw: string, domains: NemaDomain[]) {
  // CRLF reads as LF (Git on Windows checks files out so); a leading BOM is dropped.
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  for (const [bad, what] of [['\t', 'Tab'], ['　', '全角空格'], ['\r', '单独的 CR']] as const) {
    const at = text.indexOf(bad)
    if (at >= 0) fail(lineAt(text, at), `不允许${what}`)
  }
  const ids = new Set<number>()
  let active: NemaDomain | undefined
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  lines.forEach((l, i) => {
    const n = i + 1
    if (l === '') return
    const h = HEADER.exec(l)
    if (h !== null) {
      const id = Number(h[2])
      if (ids.has(id)) fail(n, `领域编号 ${id} 重复`)
      ids.add(id)
      const mode: NemaMode = h[1] === '?' ? '5w1h' : h[1] === '>' ? 'graph' : 'table'
      active = { mode, id, revision: Number(h[3]), columns: null, records: [], rows: [], line: n, hasHeader: false, width: null }
      domains.push(active)
      return
    }
    if (BAD_HEADER.test(l)) fail(n, '领域头格式错误：应为一个前导半角空格、\\编号、空格、修订号')
    if (active === undefined) fail(n, '领域头之前出现了正文')
    readBody(active, l, n)
    active.rows.push(l)
  })
  for (const d of domains) if (d.mode === 'graph') checkGraph(d)
}

/** Reads a .nema file; never throws. On the first error, `domains` holds what was read before it. */
export function parseNema(text: string): NemaParse {
  const domains: NemaDomain[] = []
  try {
    readAll(text, domains)
  } catch (err) {
    if (err instanceof NemaError) {
      return { domains, error: err.line > 0 ? `第 ${err.line} 行：${err.message}` : err.message, errorLine: err.line }
    }
    return { domains, error: String(err), errorLine: 0 }
  }
  return { domains, error: '', errorLine: 0 }
}

/** FNV-1a, 32-bit, as 8 hex digits: enough to tell whether a domain's lines changed. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Each domain's kind, revision and the fingerprint of its body lines. */
export function domainStates(parsed: NemaParse): NemaDomainState[] {
  return parsed.domains.map(d => ({ id: d.id, mode: d.mode, revision: d.revision, fingerprint: fingerprint(d.rows.join('\n')) }))
}

/** How the domains moved from `base` to `now`, by ID; an unchanged domain is not listed. */
export function domainChanges(base: readonly NemaDomainState[], now: readonly NemaDomainState[]): NemaChange[] {
  const before = new Map(base.map(d => [d.id, d]))
  const after = new Map(now.map(d => [d.id, d]))
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)
  const out: NemaChange[] = []
  for (const id of ids) {
    const b = before.get(id)
    const a = after.get(id)
    if (b !== undefined && a === undefined) {
      out.push({ id, mode: b.mode, change: 'removed', from: b.revision, to: null, isBumped: false })
    } else if (b === undefined && a !== undefined) {
      out.push({ id, mode: a.mode, change: 'added', from: null, to: a.revision, isBumped: true })
    } else if (b !== undefined && a !== undefined) {
      if (b.fingerprint !== a.fingerprint || b.revision !== a.revision || b.mode !== a.mode) {
        out.push({ id, mode: a.mode, change: 'changed', from: b.revision, to: a.revision, isBumped: a.revision > b.revision })
      }
    }
  }
  return out
}

const TAG: Record<NemaMode, string> = { table: '', '5w1h': '?', graph: '>' }

/** One change as the panes say it. */
export function changeText(c: NemaChange): string {
  const name = `\\${TAG[c.mode]}${c.id}`
  if (c.change === 'added') return `${name} 新增（修订 ${c.to}）`
  if (c.change === 'removed') return `${name} 已删除`
  if (c.isBumped) return `${name} 修订 ${c.from}→${c.to} 已修改`
  return c.from === c.to
    ? `${name} 内容已改，修订号未增加（仍为 ${c.to}）`
    : `${name} 内容已改，修订号未增加（${c.from}→${c.to}）`
}

function valueText(v: NemaValue | undefined): string {
  return v === null ? '~' : typeof v === 'string' ? v : '_'
}

/** One line per domain for the ranking model: kind, columns, size, first record; capped. */
export function nemaSummary(parsed: NemaParse, limit = 1500): string {
  const lines = parsed.domains.map(d => {
    const first = d.records[0]?.values.map(valueText).join(' ') ?? ''
    const head = `\\${TAG[d.mode]}${d.id} 修订${d.revision}`
    if (d.mode === 'table') {
      return `${head} 表格 列：${(d.columns ?? []).join(' ')} · ${d.records.length} 条${first ? ` · 首条：${first}` : ''}`
    }
    if (d.mode === '5w1h') return `${head} 5W1H · ${d.records.length} 条${first ? ` · 首条：${first}` : ''}`
    const nodes = d.records.filter(r => r.kind === 'node')
    const edges = d.records.length - nodes.length
    return `${head} 拓扑 · ${nodes.length} 节点 ${edges} 边${nodes[0] ? ` · 首个节点：${nodes[0].values.map(valueText).join(' ')}` : ''}`
  })
  if (parsed.error !== '') lines.push(`语法错误：${parsed.error}`)
  return lines.join('\n').slice(0, limit)
}

/**
 * The first table domain with a column that `column` names (a name, or a test on names),
 * as text cells: null and missing read as ''.
 */
export function nemaTable(
  parsed: NemaParse,
  column: string | ((name: string) => boolean),
): { columns: string[]; rows: string[][] } | undefined {
  const wanted = typeof column === 'string' ? (name: string) => name === column : column
  const d = parsed.domains.find(x => x.mode === 'table' && (x.columns ?? []).some(wanted))
  if (d === undefined) return undefined
  return {
    columns: [...(d.columns ?? [])],
    rows: d.records.map(r => r.values.map(v => (typeof v === 'string' ? v : ''))),
  }
}
