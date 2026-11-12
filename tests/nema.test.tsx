import { expect, test } from 'claude-code/testing'

import { changeText, domainChanges, domainStates, nemaSummary, nemaTable, parseNema } from '../hooks/core/nema'
import type { NemaDomainState } from '../types'

// A file from lines: each ends with LF, as .nema asks.
const nema = (...lines: string[]) => `${lines.join('\n')}\n`
const MISSING = { missing: true }

test('a table domain reads its records, header, width and escapes', () => {
  const plain = parseNema(nema(' \\1 1', 'A B'))
  expect(plain.error).toBe('')
  expect(plain.domains[0]).toMatchObject({ mode: 'table', id: 1, revision: 1, columns: ['column1', 'column2'] })
  expect(plain.domains[0]?.records[0]?.values).toEqual(['A', 'B'])

  const header = parseNema(nema(' \\123 7', '\\# Full\\ Name Status', '~ Ready', '\\e Ready', '\\_ Ready', 'New\\ York Ready'))
  expect(header.error).toBe('')
  expect(header.domains[0]?.columns).toEqual(['Full Name', 'Status'])
  expect(header.domains[0]?.records.map(r => r.values[0])).toEqual([null, '', MISSING, 'New York'])

  const width = parseNema(nema(' \\1 1', '\\%3', '\\_ \\_ Active'))
  expect(width.domains[0]?.columns).toEqual(['column1', 'column2', 'column3'])
  expect(width.domains[0]?.records[0]?.values).toEqual([MISSING, MISSING, 'Active'])

  const empty = parseNema(nema(' \\1 1', '\\%3'))
  expect(empty.domains[0]?.records).toEqual([])
})

test('leading spaces continue a column of the previous record', () => {
  const two = parseNema(nema(' \\1 1', 'A Ready', ' Retrying'))
  expect(two.domains[0]?.records[0]?.values).toEqual(['A', 'ReadyRetrying'])
  const three = parseNema(nema(' \\1 1', 'A B C', '  HTTP401'))
  expect(three.domains[0]?.records[0]?.values).toEqual(['A', 'B', 'CHTTP401'])
  const fromEmpty = parseNema(nema(' \\1 1', 'A \\e', ' Retry'))
  expect(fromEmpty.domains[0]?.records[0]?.values).toEqual(['A', 'Retry'])

  expect(parseNema(nema(' \\1 1', ' Retrying')).error).toBe('第 2 行：续写行之前没有记录')
  expect(parseNema(nema(' \\1 1', 'A ~', ' Retry')).error).toContain('null')
  expect(parseNema(nema(' \\1 1', 'A \\_', ' Retry')).error).toContain('缺失值')
  expect(parseNema(nema(' \\1 1', 'A B', '  Retry')).error).toContain('超出列宽')
})

test('5W1H and graph domains read their records', () => {
  const five = parseNema(nema(' \\?2 1', 'Claude 修复 2026-11-12 OA-Partner 回归 TDD'))
  expect(five.error).toBe('')
  expect(five.domains[0]).toMatchObject({ mode: '5w1h', id: 2 })
  expect(five.domains[0]?.records[0]?.values).toHaveLength(6)
  expect(parseNema(nema(' \\?2 1', 'a b c d e f g')).error).toContain('最多 6')

  const graph = parseNema(nema(' \\>3 1', 'A 甲', 'B 乙', 'A>e1>B 依赖', 'C 丙', 'C<e2<A 派生'))
  expect(graph.error).toBe('')
  const records = graph.domains[0]?.records ?? []
  expect(records.filter(r => r.kind === 'node').map(r => r.id)).toEqual(['A', 'B', 'C'])
  expect(records.filter(r => r.kind === 'edge').map(r => [r.id, r.from, r.to])).toEqual([
    ['e1', 'A', 'B'],
    ['e2', 'A', 'C'],
  ])

  expect(parseNema(nema(' \\>3 1', 'A 甲', 'A>e1>Z 依赖')).error).toContain('不存在的节点')
  expect(parseNema(nema(' \\>3 1', 'A 甲', 'B 乙', 'A>A>B 依赖')).error).toContain('既是节点又是边')
  expect(parseNema(nema(' \\>3 1', 'A>e1<B 依赖')).error).toContain('边应写作')
})

test('malformed headers and stray bodies are errors with their line', () => {
  expect(parseNema(nema(' \\0 1', 'A B')).error).toBe('第 1 行：领域头格式错误：应为一个前导半角空格、\\编号、空格、修订号')
  expect(parseNema(nema(' \\01 1', 'A B')).errorLine).toBe(1)
  expect(parseNema(nema('  \\1 1', 'A B')).errorLine).toBe(1)
  expect(parseNema(nema(' \\1', 'A B')).errorLine).toBe(1)
  expect(parseNema(nema(' \\1 1 x')).errorLine).toBe(1)
  expect(parseNema(nema('A B', ' \\1 1')).error).toBe('第 1 行：领域头之前出现了正文')
  const twice = parseNema(nema(' \\1 1', 'A', ' \\1 2', 'B'))
  expect(twice.error).toBe('第 3 行：领域编号 1 重复')
  // What came before the error is kept.
  expect(twice.domains.map(d => d.id)).toEqual([1])
})

test('field and table errors follow the strict grammar', () => {
  expect(parseNema(nema(' \\1 1', 'A  B')).error).toContain('只能有一个空格')
  expect(parseNema(nema(' \\1 1', 'A B ')).error).toContain('多余空格')
  expect(parseNema(nema(' \\1 1', '\\# Name Name')).error).toContain('列名重复')
  expect(parseNema(nema(' \\1 1', '\\# Name \\e', 'A B')).error).toContain('非空文本')
  expect(parseNema(nema(' \\1 1', 'A B', '\\# Name Status')).error).toContain('第一条记录之前')
  expect(parseNema(nema(' \\1 1', 'A B', 'C D E')).error).toContain('超出列宽')
  expect(parseNema(nema(' \\1 1', '\\%2', 'A B C')).error).toContain('超出列宽')
  expect(parseNema(nema(' \\1 1', '\\%0')).error).toContain('正整数')
  expect(parseNema(nema(' \\1 1', '\\%2', '\\%3', 'A B')).error).toContain('只能声明一次')
  expect(parseNema(nema(' \\1 1', 'A\\x')).error).toContain('未知转义')
  expect(parseNema(nema(' \\1 1', 'A\tB')).error).toBe('第 2 行：不允许Tab')
  expect(parseNema(nema(' \\1 1', 'A　B')).error).toBe('第 2 行：不允许全角空格')
})

test('CRLF line endings read as LF, a bare CR is an error', () => {
  const crlf = parseNema(' \\1 1\r\nA B\r\n')
  expect(crlf.error).toBe('')
  expect(domainStates(crlf)).toEqual(domainStates(parseNema(nema(' \\1 1', 'A B'))))
  expect(parseNema('﻿ \\1 1\nA B\n').error).toBe('')
  expect(parseNema(' \\1 1\nA\rB\n').error).toBe('第 2 行：不允许单独的 CR')
})

test('domain changes tell added, removed, revised and changed-without-revision', () => {
  const state = (id: number, revision: number, fingerprint: string, mode: NemaDomainState['mode'] = 'table') => ({
    id,
    mode,
    revision,
    fingerprint,
  })
  const base = [state(1, 2, 'aaaa'), state(2, 1, 'bbbb', '5w1h'), state(3, 4, 'cccc', 'graph'), state(4, 1, 'dddd')]
  const now = [state(1, 3, 'abab'), state(2, 1, 'b2b2', '5w1h'), state(3, 4, 'cccc', 'graph'), state(5, 1, 'eeee')]
  const changes = domainChanges(base, now)
  expect(changes.map(changeText)).toEqual([
    '\\1 修订 2→3 已修改',
    '\\?2 内容已改，修订号未增加（仍为 1）',
    '\\4 已删除',
    '\\5 新增（修订 1）',
  ])
  expect(changes.map(c => [c.id, c.change, c.isBumped])).toEqual([
    [1, 'changed', true],
    [2, 'changed', false],
    [4, 'removed', false],
    [5, 'added', true],
  ])
  expect(domainChanges(base, base)).toEqual([])
  // An edit inside a domain moves its fingerprint.
  const before = domainStates(parseNema(nema(' \\1 1', 'A B')))
  const after = domainStates(parseNema(nema(' \\1 1', 'A C')))
  expect(domainChanges(before, after).map(changeText)).toEqual(['\\1 内容已改，修订号未增加（仍为 1）'])
})

test('the summary and the task table read a file', () => {
  const parsed = parseNema(
    nema(
      ' \\?1 2',
      'Claude 设计 2026-11-12 OA 回归 TDD',
      ' \\2 1',
      '\\# 名称 值',
      'A B',
      ' \\3 4',
      '\\# 编号 任务 状态',
      '1.1 要件定义 已完成',
      '1.2 ~ 进行中',
      ' \\>4 1',
      'A 甲',
      'B 乙',
      'A>e>B 依赖',
    ),
  )
  expect(parsed.error).toBe('')
  const summary = nemaSummary(parsed)
  expect(summary.split('\n')).toEqual([
    '\\?1 修订2 5W1H · 1 条 · 首条：Claude 设计 2026-11-12 OA 回归 TDD',
    '\\2 修订1 表格 列：名称 值 · 1 条 · 首条：A B',
    '\\3 修订4 表格 列：编号 任务 状态 · 2 条 · 首条：1.1 要件定义 已完成',
    '\\>4 修订1 拓扑 · 2 节点 1 边 · 首个节点：A 甲',
  ])
  expect(nemaSummary(parsed, 20)).toHaveLength(20)
  expect(nemaTable(parsed, '任务')).toEqual({
    columns: ['编号', '任务', '状态'],
    rows: [
      ['1.1', '要件定义', '已完成'],
      ['1.2', '', '进行中'],
    ],
  })
  expect(nemaTable(parsed, '负责人')).toBeUndefined()
  expect(nemaSummary(parseNema(nema(' \\1 1', 'A  B')))).toContain('语法错误：第 2 行')
})
