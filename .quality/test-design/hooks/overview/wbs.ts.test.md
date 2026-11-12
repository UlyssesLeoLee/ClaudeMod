# Test Design: `hooks/overview/wbs.ts`

Source: `hooks/overview/wbs.ts`

Source-SHA256: `e78a570b8a254add009dd4364e789a1cfc41726c0e9147f81b915a1d8b1c2cb7`

## Test Strategy

Unit tests of parsing and counting in tests/overview.test.tsx, plus the pane tests feeding fake WBS text.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | The table `buildCreatePrompt` asks for | Reads back with every column | tests/overview.test.tsx#the table the create prompt asks for reads back with every column |
| TC-002 | CRLF, BOM, loose pipes, full-width headers, `40%`, `2026/11/01` | Parsed as normal | tests/overview.test.tsx#a hand-edited WBS still reads: CRLF, BOM, loose pipes, full-width headers, 40%, slashes |
| TC-003 | Tasks 1.1 and 1.10; one leaf without 工数; empty table | 1.10 no child of 1.1; unweighted; nothing to count | tests/overview.test.tsx#counting rules: 1.10 is no child of 1.1, unweighted without full 工数, nothing to count |
| TC-004 | 141 emoji / CJK characters | Cut to 140 characters | tests/overview.test.tsx#the cap counts characters, not UTF-16 units |

## Boundary & Failure Cases

- No table → `hasTable: false`.
- Unknown status text → warning, task kept.

## Regression Scope

Overview pane counting and summary.
