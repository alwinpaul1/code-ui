import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { appendCcrQueue, ccrQueueAfter, returnCcrQueueToComposer } from './ccr-local-queue'
import { buildCcrUserEventBody } from './ccr-send'
import type { CcrSendTarget } from './ccr-session-cache'
import { reasonOf } from './ccr-session-shared'
import { restoreCcrQueueToStoredDraft, type CcrComposerSendDeps } from './ccr-composer-send-deps'

/**
 * The messages queued while Claude works on a Claude tab that sends through Anthropic, one queue
 * per tab (use-ccr-composer-send.ts says why): each with the target it was queued for, kept while
 * the user is on another tab, and seen out when the chat controller goes away.
 */

export type CcrTo = { sessionId: string; accountId: string }

/** A tab's queue: its words, the target it was queued for, that tab's own resolver as of then
 *  (to tell, once the chat is gone, whether that target still stands), and its composer draft. */
export type HeldQueue = { text: string; target: CcrTo; resolve: () => CcrSendTarget; draftKey: string | null }
export type HeldQueues = Readonly<Record<string, HeldQueue>>

export function sameCcrTarget(left: CcrTo, right: CcrTo): boolean {
  return left.sessionId === right.sessionId && left.accountId === right.accountId
}

export const ccrSessionTail = (sessionId: string): string => `…${sessionId.slice(-6)}`

type Latest = MutableRefObject<{ tabId: string | null; resolveTarget: () => CcrSendTarget; setComposerText: Dispatch<SetStateAction<string>> }>

export function useCcrTabQueues(latest: Latest, deps: CcrComposerSendDeps): {
  queues: HeldQueues
  /** Read across awaits: the state only redraws. */
  queuesRef: MutableRefObject<HeldQueues>
  queueOnTab: (tab: string, text: string, to: CcrTo, draftKey: string) => void
  /** Takes `taken` off the front of `tab`'s queue; false when the queue no longer starts with it. */
  takeFromQueue: (tab: string, taken: string) => boolean
  editQueue: () => void
} {
  const queuesRef = useRef<HeldQueues>({})
  const [queues, setQueues] = useState<HeldQueues>(queuesRef.current)
  const updateQueues = useCallback((change: (previous: HeldQueues) => HeldQueues) => {
    const next = change(queuesRef.current)
    if (next !== queuesRef.current) {
      queuesRef.current = next
      setQueues(next)
    }
  }, [])

  // A queue held for another target (the tab's profile switched mid-turn) goes back to the
  // composer first: it was never meant for `to`.
  const queueOnTab = useCallback((tab: string, text: string, to: CcrTo, draftKey: string) => {
    const now = latest.current
    const held = queuesRef.current[tab]
    const kept = held && sameCcrTarget(held.target, to) ? held.text : null
    if (held && kept === null) {
      deps.log(`[ccr-send] queued message moved back to the composer: this tab now sends to session ${ccrSessionTail(to.sessionId)}, not ${ccrSessionTail(held.target.sessionId)}`)
      now.setComposerText((draft) => returnCcrQueueToComposer(held.text, draft))
    }
    updateQueues((previous) => ({ ...previous, [tab]: { text: appendCcrQueue(kept, text) ?? text, target: to, resolve: now.resolveTarget, draftKey } }))
  }, [deps, latest, updateQueues])

  const takeFromQueue = useCallback((tab: string, taken: string): boolean => {
    const held = queuesRef.current[tab]
    const rest = ccrQueueAfter(held?.text ?? null, taken)
    if (!held || rest === undefined) {
      return false
    }
    updateQueues((previous) => {
      if (rest === null) {
        const { [tab]: _gone, ...others } = previous
        return others
      }
      return { ...previous, [tab]: { ...held, text: rest } }
    })
    return true
  }, [updateQueues])

  const editQueue = useCallback(() => {
    const now = latest.current
    const tab = now.tabId ?? ''
    const queued = queuesRef.current[tab]?.text
    if (queued && takeFromQueue(tab, queued)) {
      now.setComposerText((draft) => returnCcrQueueToComposer(queued, draft))
    }
  }, [latest, takeFromQueue])

  // Leaving the chat (the controller unmounts) with queues held: each is posted into the target
  // it was queued for as `priority: "later"` with a fresh uuid, as the app does when its session
  // screen closes (the server holds it until that turn ends), if its tab still resolves to that
  // target, whether or not this lane is on now. Otherwise, or when that POST fails, the words go
  // back into that tab's stored composer draft with a `[ccr-send]` line saying why. Nothing is
  // dropped and nothing goes to another session.
  useEffect(
    () => () => {
      const restore = deps.restoreDraft ?? restoreCcrQueueToStoredDraft
      const giveBack = (held: HeldQueue, why: string): void => {
        const session = ccrSessionTail(held.target.sessionId)
        if (!held.draftKey) {
          deps.log(`[ccr-send] queued message for session ${session} lost on leaving: ${why}, and no composer draft to return it to`)
          return
        }
        deps.log(`[ccr-send] queued message for session ${session} moved back to its tab's composer draft on leaving: ${why}`)
        void restore(held.draftKey, held.text).catch((error: unknown) => deps.log(`[ccr-send] queued message could not be written back to its composer draft: ${reasonOf(error)}`))
      }
      for (const held of Object.values(queuesRef.current)) {
        const resolved = held.resolve()
        if (resolved.kind !== 'target') {
          giveBack(held, `no send target (${resolved.reason})`)
        } else if (!sameCcrTarget(resolved, held.target)) {
          giveBack(held, `its tab now sends to session ${ccrSessionTail(resolved.sessionId)}`)
        } else {
          const body = buildCcrUserEventBody({ sessionId: held.target.sessionId, uuid: deps.newUuid(), text: held.text, priority: 'later' })
          void deps.post(held.target.accountId, held.target.sessionId, body).catch((error: unknown) => giveBack(held, `the post-later POST failed: ${reasonOf(error)}`))
        }
      }
      queuesRef.current = {}
    },
    [deps]
  )

  return { queues, queuesRef, queueOnTab, takeFromQueue, editQueue }
}
