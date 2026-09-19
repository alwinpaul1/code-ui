import { closeTerminal } from './transcript-tail-closes'
import type { TranscriptTailSender } from './transcript-tail-operations'
import { transcriptTailEntriesForOwnership } from './transcript-tail-session'
import { forgetTranscriptTailHandle, recordedTranscriptTailHandles } from './transcript-tail-ledger'

/** Whether this phone owns the terminal with this handle, for the terminal
 *  list sweep: a `Code UI · transcript` tab it does not own is one an earlier
 *  process left behind (the app was swiped away, a close never landed). */
export function ownsTranscriptTailTerminal(handle: string): boolean {
  for (const entry of transcriptTailEntriesForOwnership()) {
    // A create in flight has a handle on the host before it has one here;
    // until it lands, any tail terminal may be that one.
    if (entry.handle === handle || entry.starting !== null) {
      return true
    }
  }
  return false
}

/** The handles of every tail terminal this process holds right now. */
export function ownedTranscriptTailHandles(): ReadonlySet<string> {
  const handles = new Set<string>()
  for (const entry of transcriptTailEntriesForOwnership()) {
    if (entry.handle) {
      handles.add(entry.handle)
    }
  }
  return handles
}

/** Close a tail terminal this phone does not own. Best effort. */
export function closeStrayTranscriptTailTerminal(
  client: TranscriptTailSender,
  hostId: string,
  handle: string
): void {
  if (!ownsTranscriptTailTerminal(handle)) {
    void closeTerminal(client, hostId, handle)
  }
}

/**
 * Close every terminal an EARLIER process of this app opened on the host
 * and never closed, given the host's live terminal list. Their titles may
 * be gone (the host renames an adopted tab), so they are known by handle,
 * from the ledger; a handle the host no longer lists is forgotten.
 */
export async function closeTranscriptTailsLeftBehind(
  client: TranscriptTailSender,
  hostId: string,
  liveHandles: ReadonlySet<string>
): Promise<void> {
  const recorded = await recordedTranscriptTailHandles(hostId)
  for (const handle of recorded) {
    if (ownsTranscriptTailTerminal(handle)) {
      continue
    }
    if (liveHandles.has(handle)) {
      void closeTerminal(client, hostId, handle)
    } else {
      void forgetTranscriptTailHandle(hostId, handle)
    }
  }
}

