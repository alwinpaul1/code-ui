import type { MobileFileTabDoc } from './mobile-file-tab-doc'

/**
 * The bounded cache of file-tab reads, and who may write to it. Its own module, with no read of a
 * file behind it, so the close actions can forget an entry without importing the whole reader.
 * What it holds and why: see mobile-file-tab-prefetch.ts.
 */
const MAX_ENTRIES = 12
const MAX_ENTRY_CHARS = 8 * 1024 * 1024

type Entry = { doc: MobileFileTabDoc; at: number }
const docs = new Map<string, Entry>()
/** The prefetch's retry bookkeeping per path; forgotten with the entry when its tab closes. */
export const prefetchAttempts = new Map<
  string,
  { count: number; nextAt: number; inFlight: boolean }
>()
/**
 * Who may write each path's entry: the newest read begun for it, and nobody once the tab is closed.
 * An older read that settles after a newer one, or one that settles after its tab closed, finds a
 * different token (or none) and is dropped. A read that ends without a document gives its claim
 * back to the newest read still in flight before it, so the claims are a stack per path. Holds
 * only reads still in flight, so it stays small.
 */
const latestRead = new Map<string, object[]>()

export type FileTabReadToken = { readonly key: string; readonly owner: object }

export function keyOf(worktreeId: string, path: string): string {
  return `${worktreeId}\u0000${path}`
}

function docChars(doc: MobileFileTabDoc): number {
  switch (doc.kind) {
    case 'image':
      return doc.dataUri.length
    case 'pdf':
      return doc.uri.length
    case 'diff':
      return doc.lines.reduce((sum, line) => sum + line.text.length, 0)
    case 'file':
    case 'html':
    case 'markdown':
      return doc.content.length
    default: {
      const exhaustive: never = doc
      return exhaustive
    }
  }
}

/** What an earlier prefetch read for this tab's file, if anything. */
export function prefetchedFileTabDoc(worktreeId: string, path: string): MobileFileTabDoc | null {
  return docs.get(keyOf(worktreeId, path))?.doc ?? null
}

/** Starts a read of this path; only the newest read's result may be cached. */
export function beginFileTabRead(worktreeId: string, path: string): FileTabReadToken {
  const token = { key: keyOf(worktreeId, path), owner: {} }
  const claims = latestRead.get(token.key)
  if (claims) {
    claims.push(token.owner)
  } else {
    latestRead.set(token.key, [token.owner])
  }
  return token
}

/** A read that ended without a document gives its claim back to the older read now newest, if any. */
export function abandonFileTabRead(token: FileTabReadToken): void {
  const claims = latestRead.get(token.key)
  if (!claims) {
    return
  }
  const index = claims.indexOf(token.owner)
  if (index !== -1) {
    claims.splice(index, 1)
  }
  if (claims.length === 0) {
    latestRead.delete(token.key)
  }
}

/** The tab closed: drop what it read and void any read still on its way. */
export function forgetFileTabDoc(worktreeId: string, path: string): void {
  const key = keyOf(worktreeId, path)
  docs.delete(key)
  prefetchAttempts.delete(key)
  latestRead.delete(key)
}

/** Caches a finished read, unless a newer read began or the tab was closed since. */
export function rememberFileTabDoc(token: FileTabReadToken, doc: MobileFileTabDoc): boolean {
  const claims = latestRead.get(token.key)
  if (!claims || claims[claims.length - 1] !== token.owner) {
    return false
  }
  // Whatever began before this read is older than what it just cached.
  latestRead.delete(token.key)
  if (docChars(doc) > MAX_ENTRY_CHARS) {
    return false
  }
  const key = token.key
  docs.delete(key)
  docs.set(key, { doc, at: Date.now() })
  while (docs.size > MAX_ENTRIES) {
    const oldest = docs.keys().next().value
    if (oldest === undefined) {
      break
    }
    docs.delete(oldest)
  }
  return true
}

export function resetFileTabPrefetchForTests(): void {
  docs.clear()
  prefetchAttempts.clear()
  latestRead.clear()
}
