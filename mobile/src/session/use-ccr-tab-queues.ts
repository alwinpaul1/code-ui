import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { appendCcrQueue, ccrQueueAfter, joinCcrQueue, returnCcrQueueToComposer, takeCcrQueueEntry, type CcrQueue } from './ccr-local-queue'
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

/** A tab's queue: its entries, one per send, oldest first (never empty); the target it was queued
 *  for; that tab's own resolver as of then (to tell, once the chat is gone, whether that target
 *  still stands); and its composer draft. */
export type HeldQueue = { entries: CcrQueue; target: CcrTo; resolve: () => CcrSendTarget; draftKey: string | null }
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
  /** Puts `text` back at the front of `tab`'s queue (a queued send that failed), ahead of what is
   *  queued behind it, for the target `held` was queued for; false when the tab now queues for
   *  another target. */
  requeueFront: (tab: string, text: string, held: HeldQueue) => boolean
  /** Entry `index` of the tab on screen back into the composer, ahead of its draft (a tap on that
   *  entry's card); the other entries stay queued, in order. */
  editQueue: (index: number) => void
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
    const kept = held && sameCcrTarget(held.target, to) ? held.entries : null
    if (held && kept === null) {
      deps.log(`[ccr-send] queued message moved back to the composer: this tab now sends to session ${ccrSessionTail(to.sessionId)}, not ${ccrSessionTail(held.target.sessionId)}`)
      now.setComposerText((draft) => returnCcrQueueToComposer(joinCcrQueue(held.entries), draft))
    }
    const entries = appendCcrQueue(kept, text)
    if (!entries) {
      return
    }
    updateQueues((previous) => ({ ...previous, [tab]: { entries, target: to, resolve: now.resolveTarget, draftKey } }))
  }, [deps, latest, updateQueues])

  const takeFromQueue = useCallback((tab: string, taken: string): boolean => {
    const held = queuesRef.current[tab]
    const rest = ccrQueueAfter(held?.entries ?? null, taken)
    if (!held || rest === undefined) {
      return false
    }
    updateQueues((previous) => {
      if (rest === null) {
        const { [tab]: _gone, ...others } = previous
        return others
      }
      return { ...previous, [tab]: { ...held, entries: rest } }
    })
    return true
  }, [updateQueues])

  const requeueFront = useCallback((tab: string, text: string, held: HeldQueue): boolean => {
    const now = queuesRef.current[tab]
    // A queue since made on this tab for another target is not this one's: the caller puts the
    // words back in the composer instead, so nothing is dropped and nothing changes session.
    if (now && !sameCcrTarget(now.target, held.target)) {
      return false
    }
    updateQueues((previous) => ({ ...previous, [tab]: { ...(previous[tab] ?? held), entries: [text, ...(previous[tab]?.entries ?? [])] } }))
    return true
  }, [updateQueues])

  const editQueue = useCallback((index: number) => {
    const now = latest.current
    const tab = now.tabId ?? ''
    const held = queuesRef.current[tab]
    const taken = takeCcrQueueEntry(held?.entries ?? null, index)
    if (!held || !taken) {
      return
    }
    updateQueues((previous) => {
      if (taken.rest === null) {
        const { [tab]: _gone, ...others } = previous
        return others
      }
      return { ...previous, [tab]: { ...held, entries: taken.rest } }
    })
    now.setComposerText((draft) => returnCcrQueueToComposer(taken.text, draft))
  }, [latest, updateQueues])

  // Leaving the chat (the controller unmounts) with queues held: each is posted into the target
  // it was queued for as `priority: "later"` with a fresh uuid, as the app does when its session
  // screen closes (the server holds it until that turn ends), if its tab still resolves to that
  // target, whether or not this lane is on now. A tab's entries go as ONE message, joined in order
  // by blank lines, as the app's one-string queue goes: posting each as its own "later" message is
  // the post-later path whose server-side holding and echo timing were never observed
  // (docs/claude-app-parity-gaps.md §7), and the phone is gone by then, so it could neither see
  // them out one turn each nor notice one refused after another was taken. Otherwise, or when that POST fails, the words go
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
        void restore(held.draftKey, joinCcrQueue(held.entries)).catch((error: unknown) => deps.log(`[ccr-send] queued message could not be written back to its composer draft: ${reasonOf(error)}`))
      }
      for (const held of Object.values(queuesRef.current)) {
        const resolved = held.resolve()
        if (resolved.kind !== 'target') {
          giveBack(held, `no send target (${resolved.reason})`)
        } else if (!sameCcrTarget(resolved, held.target)) {
          giveBack(held, `its tab now sends to session ${ccrSessionTail(resolved.sessionId)}`)
        } else {
          const body = buildCcrUserEventBody({ sessionId: held.target.sessionId, uuid: deps.newUuid(), text: joinCcrQueue(held.entries), priority: 'later' })
          void deps.post(held.target.accountId, held.target.sessionId, body).catch((error: unknown) => giveBack(held, `the post-later POST failed: ${reasonOf(error)}`))
        }
      }
      queuesRef.current = {}
    },
    [deps]
  )

  return { queues, queuesRef, queueOnTab, takeFromQueue, requeueFront, editQueue }
}
