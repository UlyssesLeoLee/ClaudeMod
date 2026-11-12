# Test Design: `hooks/doclinks/review.ts`

Source: `hooks/doclinks/review.ts`

Source-SHA256: `6eb90fc9324de9796bfe6ee81cabc200f835fbe7513773cbe3ede1e5ca251f1a`

## Test Strategy

Unit tests of the rules plus the review-sync integration tests in tests/review-sync.test.tsx.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Review words in English, Chinese and Japanese; a text without the word review | true for each review word, false otherwise | tests/review-sync.test.tsx#the review sync’s rules |
| TC-002 | `editedPath('Edit', {file_path: 'src/a.ts'})`, `('Bash', …)` | `src/a.ts`, `''` | tests/review-sync.test.tsx#the review sync’s rules |
| TC-003 | `isCodePath` on `src/a.ts`, `docs/x.md`, `.quality/docs/a.md` | true, false, false | tests/review-sync.test.tsx#the review sync’s rules |
| TC-004 | `unchangedDocs` with one moved and one unmoved SHA256 | Only the unmoved path | tests/review-sync.test.tsx#after the update turn, a doc whose SHA256 did not move gets the 手动更新 button |

## Boundary & Failure Cases

- Review followed by doc edits only: no trigger (tests/review-sync.test.tsx "a review followed by doc edits only, a failed edit, or a subagent’s turn triggers nothing").
- One review triggers one update (tests/review-sync.test.tsx "one review triggers one update").

## Regression Scope

The automatic update after a review in the doc pane.
