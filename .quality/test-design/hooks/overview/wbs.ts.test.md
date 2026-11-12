# Test Design: `hooks/overview/wbs.ts`

Source: `hooks/overview/wbs.ts`

Source-SHA256: `ab41d995746aa973570364d7ba5fa8c5d0936fdd3e43de9164ac74cca8d1ff00`

## Test Strategy

Unit tests of parsing and counting in tests/overview.test.tsx, plus the pane tests feeding fake WBS text.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | The table `buildCreatePrompt` asks for | Reads back with every column | tests/overview.test.tsx#the table the create prompt asks for reads back with every column |
| TC-002 | CRLF, BOM, loose pipes, full-width headers, `40%`, `2026/11/01` | Parsed as normal | tests/overview.test.tsx#a hand-edited WBS still reads: CRLF, BOM, loose pipes, full-width headers, 40%, slashes |
| TC-003 | Tasks 1.1 and 1.10; one leaf without 工数; empty table | 1.10 no child of 1.1; unweighted; nothing to count | tests/overview.test.tsx#counting rules: 1.10 is no child of 1.1, unweighted without full 工数, nothing to count |
| TC-004 | 141 emoji / CJK characters | Cut to 140 characters | tests/overview.test.tsx#the cap counts characters, not UTF-16 units |
| TC-005 | `WBS.nema` with a 5W1H domain, then a table domain `\# 编号 任务 … 状态` | Tasks and completion as from the same table in `WBS.md` | tests/overview.test.tsx#a WBS.nema table domain is read like WBS.md |
| TC-006 | `WBS.nema` with a grammar error; one with no 任务 column | The pane says why it cannot be read | tests/overview.test.tsx#a WBS.nema without a task table, or with a grammar error, says so |

## Boundary & Failure Cases

- No table → `hasTable: false`.
- Unknown status text → warning, task kept.

## Regression Scope

Overview pane counting and summary.
