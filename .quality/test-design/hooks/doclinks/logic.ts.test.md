# Test Design: `hooks/doclinks/logic.ts`

Source: `hooks/doclinks/logic.ts`

Source-SHA256: `2dc29239a9e9926c2bc4e02a9a873d26f5ae8f0288a62c08e19f3fdb5705e327`

## Test Strategy

Unit tests of the pure rules in tests/doc-links.test.tsx, and the pane tests that run them over fake trees.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Paths naming 要件定義, 概要設計 / 基本設計, 機能設計 / 詳細設計 in file or folder names | req, basic, detail | tests/doc-links.test.tsx#documents are told apart by their names and folders |
| TC-002 | 単体テスト / 単体試験 / 单元测试 / 单元试验, 結合…, 総合… / 系统… | ut, it, st for each spelling | tests/doc-links.test.tsx#test levels read in Japanese (テスト and 試験) and Chinese (测试 and 试验) |
| TC-003 | `04_unit-test/UT-V40-01_mfg-unit-test-design.md`, `05_integration-test/IT-V40-01_mfg-integration-test-design.md` inside an extra folder | Kind hints `(ut)` and `(it)` in the model prompt | tests/doc-links.test.tsx#documents kept in another folder of the project join once the folder is added |
| TC-004 | A test document naming no level (テスト仕様兼結果書, 测试用例) | ut, after every named level and design | tests/doc-links.test.tsx#a test document naming no level counts as UT, after every named level and design |
| TC-005 | Names with 仕様 / specification, and with 計画 / plan / WBS, naming no test or design | spec, plan | tests/doc-links.test.tsx#SPEC and PLAN are kinds of their own, after every test and design name |
| TC-006 | The model files a doc under spec or plan | The model’s kind kept | tests/doc-links.test.tsx#the model may file a doc under SPEC or PLAN |
| TC-007 | `coverKinds` with links lacking ut/it and candidates of both | One ut and one it added with the cover reason | tests/doc-links.test.tsx#every kind found gets a link: what the model left out is filled in by kind |
| TC-008 | `buildUpdatePrompt` with a path holding `\u0007` | Control character replaced by a space | tests/doc-links.test.tsx#the update prompt strips control characters from paths |
| TC-009 | `personText` on engine-wrapped text, slash command, skill body | Typed words only | tests/doc-links.test.tsx#what counts as the person’s words in the record; tests/doc-links.test.tsx#a person’s words survive the wrapping the engine adds around them |
| TC-010 | A `.nema` file among the documents | It is a candidate, classified by its name | tests/doc-links.test.tsx#a .nema document is linked with its domains and its changes are told by domain |
| TC-011 | Update prompt with and without a linked `.nema` document | The `.nema` rule only when one is linked | tests/doc-links.test.tsx#the update prompt states the .nema rule only when a .nema document is linked |

## Boundary & Failure Cases

- An outside folder's own name (`…_DOCS_…`) never decides a kind (tests/doc-links.test.tsx, "an extra folder’s own name never decides the kind of the docs inside it").
- Ids the model invents are dropped (tests/doc-links.test.tsx, "every classified doc reaches the model; its picks are grouped, invented ids dropped").
- `restored` rejects a stored value of another shape (tests/store.test.tsx, "the latest result among the folders above wins").

## Regression Scope

Doc pane ranking, folding by kind, update prompt, review sync.
