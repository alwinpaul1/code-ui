import { transcriptTailTerminalClose, type TranscriptTailSender } from './transcript-tail-operations'
import { forgetTranscriptTailHandle } from './transcript-tail-ledger'

/** Handles whose close never reached the host, by host id. */
const undeliveredCloses = new Map<string, Set<string>>()

/** Close a terminal on the host; if the request never got there, remember it. */
export async function closeTerminal(
  client: TranscriptTailSender,
  hostId: string,
  handle: string
): Promise<void> {
  try {
    await transcriptTailTerminalClose.request(client, { terminal: handle })
    undeliveredCloses.get(hostId)?.delete(handle)
    void forgetTranscriptTailHandle(hostId, handle)
  } catch {
    let pending = undeliveredCloses.get(hostId)
    if (!pending) {
      pending = new Set()
      undeliveredCloses.set(hostId, pending)
    }
    pending.add(handle)
  }
}

export function retryUndeliveredCloses(client: TranscriptTailSender, hostId: string): void {
  const pending = undeliveredCloses.get(hostId)
  if (!pending || pending.size === 0) {
    return
  }
  for (const handle of Array.from(pending)) {
    void closeTerminal(client, hostId, handle)
  }
}


export function forgetUndeliveredCloses(): void {
  undeliveredCloses.clear()
}
