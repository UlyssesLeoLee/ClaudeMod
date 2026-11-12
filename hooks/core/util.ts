// Pure helpers every feature shares: paths, store keys and times. No `$`.

/** A path the way Windows compares it: either slash, any case, no trailing slash. */
export function normPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b)
}

/** The store key one project's data of one kind is kept under, across sessions. */
export function projectKey(kind: string, path: string): string {
  return `${kind}:${normPath(path)}`
}

/**
 * The path, then every folder above it up to its root, as `normPath` gives them:
 * `D:\A\b` → `d:/a/b`, `d:/a`, `d:/`; `/home/me` → `/home/me`, `/home`, `/`.
 */
export function ancestors(path: string): string[] {
  const p = normPath(path)
  if (p === '') return path.trim().startsWith('/') ? ['/'] : []
  const drive = /^[a-z]:/.exec(p)?.[0]
  const top = drive ? `${drive}/` : p.startsWith('/') ? '/' : ''
  const parts = p.slice(top.length).split('/').filter(Boolean)
  const out: string[] = []
  for (let n = parts.length; n > 0; n--) out.push(`${top}${parts.slice(0, n).join('/')}`)
  if (top !== '') out.push(top)
  return out
}

/** A path that names its drive or starts at the root: a doc from an extra folder. */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
}

/** Where a file is: project-relative paths under the root, absolute ones as they are. */
export function fullPath(root: string, p: string): string {
  return isAbsolutePath(p) ? p : `${root}/${p}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local `YYYY-MM-DD HH:mm`. */
export function fullTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 刚刚, N分钟前, N小时前, N天前 within 30 days; the local date past that. */
export function relTime(ts: number, now: number): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  if (min < 24 * 60) return `${Math.floor(min / 60)}小时前`
  if (min < 30 * 24 * 60) return `${Math.floor(min / 1440)}天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
