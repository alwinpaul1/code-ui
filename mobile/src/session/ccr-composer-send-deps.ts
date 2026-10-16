import { acquireCcrLink } from './ccr-link-registry'
import { giveWordsToTabDraft } from './mobile-native-chat-live-drafts'
import { reapplyCcrQueueToComposer, returnCcrQueueToComposer } from './ccr-local-queue'
import { newCcrEventUuid, postCcrSessionEvents, readCcrConnectionStatus, type buildCcrUserEventBody } from './ccr-send'

/** What the Anthropic composer send (use-ccr-composer-send.ts) reaches outside itself. */

/** The default `restoreDraft`: the queue ahead of whatever the tab's stored draft holds. */
export async function restoreCcrQueueToStoredDraft(draftKey: string, text: string): Promise<void> {
  // One step on the draft's write chain, so a refused send's words given back to the same closed
  // tab cannot be dropped by it, nor it by them, and into any mounted copy of the tab's draft
  // (mobile-native-chat-live-drafts.ts `giveWordsToTabDraft`).
  await giveWordsToTabDraft(draftKey, (stored) => returnCcrQueueToComposer(text, stored), null, (stored) => reapplyCcrQueueToComposer(text, stored))
}

export type CcrComposerSendDeps = {
  /** Posts one events batch into `sessionId` with `accountId`'s own sign-in. */
  post: (accountId: string, sessionId: string, body: ReturnType<typeof buildCcrUserEventBody>) => Promise<void>
  /** The session row's `connection_status`, read now. */
  readStatus: (accountId: string, sessionId: string) => Promise<string | null>
  log: (line: string) => void
  newUuid: () => string
  /** Puts a queue that could not be posted back into its tab's stored composer draft, ahead of
   *  what the draft holds (the chat is gone, so its in-memory composer is too). */
  restoreDraft?: (draftKey: string, text: string) => Promise<void>
}

export const defaultCcrComposerSendDeps: CcrComposerSendDeps = {
  post: async (accountId, sessionId, body) => {
    const held = acquireCcrLink(accountId, sessionId)
    try {
      await held.link.withSession((deps, account, session) => postCcrSessionEvents(deps, account, session, body))
    } finally {
      held.release()
    }
  },
  readStatus: async (accountId, sessionId) => {
    const held = acquireCcrLink(accountId, sessionId)
    try {
      return await held.link.withSession(readCcrConnectionStatus)
    } finally {
      held.release()
    }
  },
  log: (line) => console.warn(line),
  newUuid: () => newCcrEventUuid(),
  restoreDraft: restoreCcrQueueToStoredDraft
}
