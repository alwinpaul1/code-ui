import { isAbsoluteTabPath, resolveMobileFileTabDoc } from './mobile-file-tab-doc'
import {
  abandonFileTabRead,
  beginFileTabRead,
  keyOf,
  prefetchAttempts as attempts,
  prefetchedFileTabDoc,
  rememberFileTabDoc
} from './mobile-file-tab-read-cache'
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
const RETRY_MS = 8000
const MAX_ATTEMPTS = 4

export {
  abandonFileTabRead,
  beginFileTabRead,
  forgetFileTabDoc,
  prefetchedFileTabDoc,
  rememberFileTabDoc,
  resetFileTabPrefetchForTests,
  type FileTabReadToken
} from './mobile-file-tab-read-cache'

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
    if (prefetchedFileTabDoc(worktreeId, path) !== null) {
      continue
    }
    const attempt = attempts.get(key) ?? { count: 0, nextAt: 0, inFlight: false }
    if (attempt.inFlight || attempt.count >= MAX_ATTEMPTS || now < attempt.nextAt) {
      continue
    }
    attempts.set(key, { ...attempt, inFlight: true })
    const token = beginFileTabRead(worktreeId, path)
    void resolveMobileFileTabDoc(client, { worktreeId, relativePath: path, terminalHandles })
      .then((doc) => {
        rememberFileTabDoc(token, doc)
        attempts.delete(key)
      })
      .catch(() => {
        abandonFileTabRead(token)
        // A tab closed meanwhile forgot its attempts; a retry would only read for nobody.
        if (attempts.has(key)) {
          attempts.set(key, { count: attempt.count + 1, nextAt: now + RETRY_MS, inFlight: false })
        }
      })
  }
}
