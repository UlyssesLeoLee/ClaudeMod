# Test Design: `hooks/core/nema.ts`

Source: `hooks/core/nema.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Unit tests of the pure functions in tests/nema.test.tsx, with inputs taken from the nema-thread grammar matrix (its valid and error cases) plus change detection cases.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | ` \1 1` then `A B` | Table #1 rev 1, columns column1 column2, one record A B | tests/nema.test.tsx#a table domain reads its records, header, width and escapes |
| TC-002 | `\# Full\ Name Status`, `~ Ready`, `\e Ready`, `\_ Ready`, `New\ York Ready` | Column `Full Name`; null, empty, missing; `New York` | tests/nema.test.tsx#a table domain reads its records, header, width and escapes |
| TC-003 | `\%3` then `\_ \_ Active` | Width 3, X2 = Active, others missing | tests/nema.test.tsx#a table domain reads its records, header, width and escapes |
| TC-004 | `A Ready` then ` Retrying`; `A B C` then `  HTTP401` | Column 2 `ReadyRetrying`; column 3 `CHTTP401` | tests/nema.test.tsx#leading spaces continue a column of the previous record |
| TC-005 | ` \?2 1` with a six-field record | 5W1H domain, six values | tests/nema.test.tsx#5W1H and graph domains read their records |
| TC-006 | ` \>3 1` with nodes `A 甲`, `B 乙` and edge `A>e1>B 依赖` | Two nodes, one edge from A to B | tests/nema.test.tsx#5W1H and graph domains read their records |
| TC-007 | ` \0 1`, ` \01 1`, `  \1 1`, ` \1`, duplicate ID, body before a domain | Each an error naming its line | tests/nema.test.tsx#malformed headers and stray bodies are errors with their line |
| TC-008 | `A  B`, `A B ` (trailing space), `\# Name Name`, `A B` then `C D E`, Tab, U+3000 | Each an error | tests/nema.test.tsx#field and table errors follow the strict grammar |
| TC-009 | Graph edge to an unknown node; node and edge sharing an ID | Error | tests/nema.test.tsx#5W1H and graph domains read their records |
| TC-010 | The same file with CRLF line endings | Read as with LF | tests/nema.test.tsx#CRLF line endings read as LF, a bare CR is an error |
| TC-011 | Base and now states: one domain changed with revision raised, one changed without, one added, one removed | `changed` bumped, `changed` not bumped, `added`, `removed`; texts as designed | tests/nema.test.tsx#domain changes tell added, removed, revised and changed-without-revision |
| TC-012 | A file with table, 5W1H and graph domains | Summary has one line per domain, within the limit | tests/nema.test.tsx#the summary and the task table read a file |
| TC-013 | WBS-like table domain with a 任务 column after another table | `nemaTable(parsed, '任务')` returns that domain's columns and rows as strings | tests/nema.test.tsx#the summary and the task table read a file |

## Boundary & Failure Cases

- An error stops reading; domains before it are kept (TC-007).
- ` \1 1 x` (text after the revision) is a malformed header, not a record (TC-007).
- Continuation onto null or missing is an error (TC-004 file, error variants).
- `domainChanges` of identical states is empty (TC-011).

## Regression Scope

Doc pane state of `.nema` documents, `WBS.nema` reading, commit detail domain changes.
