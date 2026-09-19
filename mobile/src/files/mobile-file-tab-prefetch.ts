import { isAbsoluteTabPath, resolveMobileFileTabDoc, type MobileFileTabDoc } from './mobile-file-tab-doc'
import type { MobileFileTabDocRpcSender } from './mobile-file-tab-doc-operations'

/**
 * A desktop-opened tab whose file sits outside the worktree is readable on
 * the phone only while a terminal here still shows its path: the host
 * vouches for an absolute path from the last 1024 lines / 64 KB of a
 * terminal's output (Orca 1.4.205), and the grant it mints lives ten
 * minutes. The desktop opens such a tab the moment the user clicks the
 * path, so the phone reads the file THEN, when the path is fresh, and keeps
 * what it read for as long as the tab is open. Opened hours later, the tab
 * still shows (device 2026-09-19: "This file is outside the workspace and
 * no terminal here printed its path", on a path the agent had printed that
 * morning).
 *
 * Bounded: a handful of documents, each at most a few MB (an image's data
 * URI). Fail-open: a read that fails is tried again a little later, a few
 * times, and then left to the tab's own read to report.
 */
const MAX_ENTRIES = 12
const MAX_ENTRY_CHARS = 8 * 1024 * 1024
const RETRY_MS = 8000
const MAX_ATTEMPTS = 4

type Entry = { doc: MobileFileTabDoc; at: number }
const docs = new Map<string, Entry>()
const attempts = new Map<string, { count: number; nextAt: number; inFlight: boolean }>()

function keyOf(worktreeId: string, path: string): string {
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

export function rememberFileTabDoc(worktreeId: string, path: string, doc: MobileFileTabDoc): void {
  if (docChars(doc) > MAX_ENTRY_CHARS) {
    return
  }
  const key = keyOf(worktreeId, path)
  docs.delete(key)
  docs.set(key, { doc, at: Date.now() })
  while (docs.size > MAX_ENTRIES) {
    const oldest = docs.keys().next().value
    if (oldest === undefined) {
      break
    }
    docs.delete(oldest)
  }
}

/** Read every outside-the-worktree file tab the phone has not read yet. */
export function prefetchOutsideWorktreeFileTabs(
  client: MobileFileTabDocRpcSender,
  worktreeId: string,
  tabs: readonly { type: string; relativePath?: string; diffSource?: string }[],
  terminalHandles: readonly string[],
  now = Date.now()
): void {
  for (const tab of tabs) {
    if (tab.type !== 'file' || !tab.relativePath || !isAbsoluteTabPath(tab.relativePath)) {
      continue
    }
    if (tab.diffSource === 'staged' || tab.diffSource === 'unstaged') {
      continue
    }
    const path = tab.relativePath
    const key = keyOf(worktreeId, path)
    if (docs.has(key)) {
      continue
    }
    const attempt = attempts.get(key) ?? { count: 0, nextAt: 0, inFlight: false }
    if (attempt.inFlight || attempt.count >= MAX_ATTEMPTS || now < attempt.nextAt) {
      continue
    }
    attempts.set(key, { ...attempt, inFlight: true })
    void resolveMobileFileTabDoc(client, { worktreeId, relativePath: path, terminalHandles })
      .then((doc) => {
        rememberFileTabDoc(worktreeId, path, doc)
        attempts.delete(key)
      })
      .catch(() => {
        attempts.set(key, { count: attempt.count + 1, nextAt: now + RETRY_MS, inFlight: false })
      })
  }
}

export function resetFileTabPrefetchForTests(): void {
  docs.clear()
  attempts.clear()
}
