# Test Design: `hooks/doclinks/logic.ts`

Source: `hooks/doclinks/logic.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Unit tests of the pure rules in tests/doc-links.test.tsx, and the pane tests that run them over fake trees.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Paths `docs/01_要件定義.xlsx`, `docs/基本設計書.xlsx`, `docs/詳細設計/x.md` | req, basic, detail | tests/doc-links.test.tsx "documents are told apart by their names and folders" |
| TC-002 | 単体テスト / 単体試験 / 单元测试 / 单元试验, 結合…, 総合… / 系统… | ut, it, st for each spelling | tests/doc-links.test.tsx "test levels read in Japanese (テスト and 試験) and Chinese (测试 and 试验)" |
| TC-003 | `04_unit-test/UT-V40-01_mfg-unit-test-design.md`, `05_integration-test/IT-V40-01_mfg-integration-test-design.md`, `06_system-test/ST-V40-01_mfg-system-test-design.md` | ut, it, st | tests/doc-links.test.tsx "test levels read in Japanese (テスト and 試験) and Chinese (测试 and 试验)" |
| TC-004 | `テスト仕様兼結果書.xlsx` under a design folder | ut | tests/doc-links.test.tsx "a test document naming no level counts as UT, after every named level and design" |
| TC-005 | `仕様書.md`, `WBS.md`, `計画書.xlsx` | spec, plan, plan | tests/doc-links.test.tsx "SPEC and PLAN are kinds of their own, after every test and design name" |
| TC-006 | Model JSON with an unknown id and kind `spec` | Unknown id dropped; kind spec kept | tests/doc-links.test.tsx "the model may file a doc under SPEC or PLAN" |
| TC-007 | `coverKinds` with links lacking ut/it and candidates of both | One ut and one it added with the cover reason | tests/doc-links.test.tsx "every kind found gets a link: what the model left out is filled in by kind" |
| TC-008 | `buildUpdatePrompt` with a path holding `\u0007` | Control character replaced by a space | tests/doc-links.test.tsx "the update prompt strips control characters from paths" |
| TC-009 | `personText` on engine-wrapped text, slash command, skill body | Typed words only | tests/doc-links.test.tsx "what counts as the person’s words in the record"; "a person’s words survive the wrapping the engine adds around them" |

## Boundary & Failure Cases

- `edit.md` is never IT (whole-token rule) — TC-002 fixture.
- An outside folder's own name (`…_DOCS_…`) never decides a kind (tests/doc-links.test.tsx "an extra folder’s own name never decides the kind of the docs inside it").
- `restored` rejects other shapes → empty state.

## Regression Scope

Doc pane ranking, folding by kind, update prompt, review sync.
