import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { CcrRefusalCard } from './ccr-refusal-rows'

/**
 * A refusal card's "Edit and retry", handed from the chat's controller (which holds the control
 * lane and the composer) to the card (a row three components down). Kept out of props as the
 * subagent viewer's store is (subagent-transcript-store.ts): the rows between sit at their caps.
 *
 * The app (su8.t4, 1.261013.20) keeps the refused prompt as a pending rewind target, fills the
 * composer with its words, and sends `rewind_conversation` ahead of the next send. Here the rewind
 * is sent on the tap and the composer is filled once the session took it: the send lane has no
 * place for a rewind ahead of a message, and a prefill over a session that did not rewind would
 * send the prompt a second time on top of the refused one. The request is unproven (never seen
 * accepted), so the action exists only while CCR_CONTROL_LANE drives the tab (`rewindTo`).
 */

export type CcrRefusalRetry = (card: CcrRefusalCard) => void

let current: CcrRefusalRetry | null = null
const listeners = new Set<() => void>()

function publish(next: CcrRefusalRetry | null): void {
  if (current === next) {
    return
  }
  current = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The card's action, or null when the tab cannot rewind (the lane is off or not live). */
export function useCcrRefusalRetry(): CcrRefusalRetry | null {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** Offers Edit and retry while `rewindTo` is defined; the controller calls it once per render. */
export function useCcrRefusalRetryHost(args: {
  rewindTo: ((messageUuid: string) => Promise<string | null>) | undefined
  setComposerText: (text: string) => void
  onSendError: (message: string) => void
}): void {
  const latest = useRef(args)
  latest.current = args
  const offered = args.rewindTo !== undefined
  useEffect(() => {
    if (!offered) {
      return undefined
    }
    const retry: CcrRefusalRetry = (card) => {
      const rewindTo = latest.current.rewindTo
      if (!rewindTo || !card.refusedUuid || card.promptText === null) {
        return
      }
      const promptText = card.promptText
      void rewindTo(card.refusedUuid).then((failure) => {
        if (failure) {
          console.warn(`[ccr-control] rewind_conversation to ${card.refusedUuid} failed: ${failure}`)
          latest.current.onSendError(failure)
          return
        }
        latest.current.setComposerText(promptText)
      })
    }
    publish(retry)
    return () => {
      if (current === retry) {
        publish(null)
      }
    }
  }, [offered])
}

export function resetCcrRefusalRetryForTests(): void {
  current = null
  listeners.clear()
}
