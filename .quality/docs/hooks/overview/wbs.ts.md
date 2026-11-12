# Technical Design: `hooks/overview/wbs.ts`

Source: `hooks/overview/wbs.ts`

Source-SHA256: `ab41d995746aa973570364d7ba5fa8c5d0936fdd3e43de9164ac74cca8d1ff00`

## Responsibility

Pure rules of the overview feature:

- The WBS file and its table: `WBS_PATH` (`docs/WBS.md`), `WBS_COLUMNS` (编号, 任务, 负责人, 预定开始, 预定结束, 实际结束, 工数(人日), 进度%, 状态), `WBS_STATUSES` (未开始, 进行中, 已完成, 已取消), `normHeader`, `splitRow`, `normDate`, `parseWbs(text)` (CRLF, BOM, loose pipes, full-width headers, `40%`, slash dates accepted).
- Counting: `completion(tasks)` over leaves (1.10 is no child of 1.1), weighted by 工数 only when every counted leaf has one; `unfinished(tasks, today)` overdue first; `isOverdue`; `localDate`.
- Summary: `SUMMARY_LIMIT` 140 (characters, not UTF-16 units), `capSummary`, `fallbackSummary`.
- Model check: `CHECK_SYSTEM`, `buildCheckPrompt(today, tasks, state)`, `parseCheck(text, tasks)` (mismatches naming a WBS task of a known kind only), `MISMATCH_TEXT`.
- Storage: `restoredOverview(value)`.
- Creation: `CREATE_HEADER`, `buildCreatePrompt()` (fixed template naming the columns and an example row).
- `.nema` WBS: `WBS_NEMA_PATH` (`docs/WBS.nema`); `wbsFromNema(text)` takes the first table domain with a 任务 column (`nemaTable`) and turns it into the table `parseWbs` reads, so a WBS kept in `.nema` counts the same way; a grammar error, or no such domain, is reported as the reason the WBS cannot be read.

## Dependencies

Types from `../../types`. No engine calls.

## Public Contract

Pure functions; `parseWbs` never throws and reports problems in `warnings`; `hasTable` false when no header with 任务 and 进度% or 状态 exists.
- `wbsFromNema(text): { table: string } | { error: string }`.

## Change Notes

- Lives in `hooks/overview/` with the feature it serves.
- A WBS may be kept as a `.nema` table domain.

