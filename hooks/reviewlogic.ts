// Pure rules of the review sync: what counts as a review, which edits are code, and
// which docs an update left untouched. No `$`: everything here is tested directly.

// A request or a tool call that is a code review: English, Chinese and Japanese words for it.
const REVIEW = /code[-_ ]?review|\breview\b|审查|审核|评审|レビュー|審査/i

export function isReviewText(text: string): boolean {
  return REVIEW.test(text)
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** The file a tool call changes, or '' for a call that changes none. */
export function editedPath(tool: string, input: { file_path?: unknown; notebook_path?: unknown }): string {
  if (!EDIT_TOOLS.has(tool)) return ''
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : ''
}

const DOC_FOLDERS = /(^|\/)(docs?|\.quality)\//i
const DOC_EXTS = /\.(md|markdown|txt|xlsx|xlsm|xls|docx|doc|pdf|csv)$/i

/** A changed file is code unless it is a document: by folder or by kind of file. */
export function isCodePath(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return p !== '' && !DOC_FOLDERS.test(p) && !DOC_EXTS.test(p)
}

/**
 * The docs an update left as they were: same SHA256 after as before, or gone, or
 * unreadable after. A doc whose SHA256 could not be read before counts as changed
 * only when one can be read after (nothing to compare is no proof of an update).
 */
export function unchangedDocs(
  before: Readonly<Record<string, string>>,
  after: ReadonlyMap<string, { sha256: string } | 'missing'>,
): string[] {
  return Object.keys(before).filter(path => {
    const now = after.get(path)
    if (now === undefined || now === 'missing') return true
    return before[path] !== '' && now.sha256 === before[path]
  })
}
