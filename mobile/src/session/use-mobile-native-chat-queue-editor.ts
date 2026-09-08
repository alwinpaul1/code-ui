import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { createQueueEditorIo } from './mobile-native-chat-queue-editor-io'
import {
  clearMobileNativeChatInputResidue,
  markMobileNativeChatInputResidue
} from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  beginMobileNativeChatTerminalBurst,
  endMobileNativeChatTerminalBurst,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import {
  finishNativeQueueEdit,
  QueueRebuildError,
  recallNativeQueue,
  type QueueEdit,
  type QueueEditorAgent,
  type QueueEditorIo
} from './native-queue-editor'
export type { QueueEditorAgent } from './native-queue-editor'

/** A recall whose read failed leaves an unknown amount on the agent. The line
 *  count only biases the clear upward, and overshoot is free. */
const RECALLED_QUEUE_RESIDUE = 'x\n'.repeat(24)

export type InlineQueueEditor = {
  text: string
  busy: boolean
  error: string | null
  /** Claude re-queues an edited message last, so saving reorders the queue. */
  movesToEnd: boolean
  /** Part of the queue was already rewritten, so writing again would double it.
   *  Only closing is left. */
  stranded: boolean
  /** The messages that never made it back, verbatim, so they can be copied. */
  remaining: string[]
  /** The whole queue is in the agent's input, not just this message. */
  rebuilds: boolean
  setText: (text: string) => void
  save: () => Promise<void>
  cancel: () => Promise<void>
  remove: () => Promise<void>
  dismiss: () => void
}
type Editing = {
  agent: QueueEditorAgent
  handle: string
  tabId: string
  recall: QueueEdit
  remote: string
  text: string
  movesToEnd: boolean
}

export function useMobileNativeChatQueueEditor(args: {
  agent: string | null
  tabId: string | null
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  client: RpcClient | null
  enabled: boolean
  beforeOpen: () => Promise<void>
  onError: (message: string) => void
  pending?: readonly { id: string; text: string; images?: string[] }[]
  removePending?: (id: string) => void
  /** The queue as drawn, oldest first; only its length is read. */
  queued?: readonly unknown[]
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)
  const [stranded, setStranded] = useState(false)
  const [remaining, setRemaining] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(args)
  latest.current = args
  const editRef = useRef(editing)
  editRef.current = editing
  const locked = useRef<string | null>(null)
  const inFlight = useRef(false)
  const lifetime = useRef(0)
  const release = useCallback(() => {
    if (locked.current) {
      endMobileNativeChatTerminalBurst(locked.current)
      releaseMobileNativeChatTerminalWrite(locked.current)
    }
    locked.current = null
  }, [])
  useEffect(
    () => () => {
      lifetime.current++
      release()
    },
    [release]
  )
  useEffect(() => {
    // Never tear the sheet down mid-write. Doing so freed the terminal lock in
    // the middle of a composed sequence and threw away the one record of the
    // messages that had left the queue, because the catch that holds them can
    // only render into a sheet that still exists.
    // A stranded sheet holds the only copy of messages that left the queue and
    // has nothing left to write, so a tab or handle change must not close it.
    if (
      !inFlight.current &&
      !stranded &&
      editing &&
      (editing.tabId !== args.tabId || editing.handle !== args.handleRef.current)
    ) {
      release()
      setEditing(null)
    }
  }, [args.tabId, args.handleRef, editing, release, stranded])

  const ioFor = (handle: string, tabId: string, generation: number) =>
    createQueueEditorIo({
      handle,
      tabId,
      generation,
      scope: () => ({
        client: latest.current.client,
        enabled: latest.current.enabled,
        tabId: latest.current.tabId,
        deviceToken: latest.current.deviceTokenRef.current,
        handle: latest.current.handleRef.current,
        generation: lifetime.current
      })
    })
  const open = async (index?: number, tapped?: string) => {
    const start = latest.current
    const handle = start.handleRef.current
    const agent = start.agent
    const generation = lifetime.current
    if (
      inFlight.current ||
      editing ||
      !start.enabled ||
      !start.tabId ||
      !handle ||
      (agent !== 'claude' && agent !== 'codex')
    ) {
      return
    }
    inFlight.current = true
    try {
      await start.beforeOpen()
      if (!acquireMobileNativeChatTerminalWrite(handle)) {
        throw new Error('Another input is still being sent. Try again.')
      }
      locked.current = handle
      beginMobileNativeChatTerminalBurst(handle)
      let recall: QueueEdit
      // Most recall refusals happen before a key goes out — a stale index, a
      // dirty draft, an attachment. Marking a residue for those made the next
      // ordinary send fire a forty-line kill burst that wipes whatever the user
      // had typed on the desktop, so only a recall that actually wrote counts.
      const io = ioFor(handle, start.tabId, generation)
      let wrote = false
      const watched: QueueEditorIo = {
        read: io.read,
        pause: io.pause,
        write: async (text, idleOnly) => {
          wrote = true
          await io.write(text, idleOnly)
        }
      }
      try {
        recall = await recallNativeQueue(watched, agent, index, tapped)
      } catch (cause) {
        if (wrote) {
          // Up has already emptied the queue into the agent's composer. Whatever
          // is there now must be cleared in full by the next send, or its lines
          // ride along with the user's next message.
          markMobileNativeChatInputResidue(handle, RECALLED_QUEUE_RESIDUE)
        }
        throw cause
      } finally {
        // The sheet is about to sit open while the user types. Let the HUD poll
        // resume so a permission prompt on the desktop is still noticed.
        endMobileNativeChatTerminalBurst(handle)
      }
      // A recalled message is now an unsent draft. Its former optimistic bubble
      // must not reappear as delivered when the queue preview disappears.
      // Match the full original, never a truncated terminal preview.
      const pending = start.pending?.findLast(
        (item) => !item.images?.length && item.text.trim() === recall.text.trim()
      )
      if (pending) {
        start.removePending?.(pending.id)
      }
      markMobileNativeChatInputResidue(handle, recall.draft)
      setStranded(false)
      setRemaining([])
      setEditing({
        agent,
        handle,
        tabId: start.tabId,
        recall,
        remote: recall.draft,
        text: recall.text,
        // Claude's native selector pops the entry out and appends the result,
        // so anything but the last message comes back at the end. Retyping the
        // whole queue puts every message back where it was.
        movesToEnd:
          agent === 'claude' &&
          !recall.segments &&
          index !== undefined &&
          index < (start.queued?.length ?? 0) - 1
      })
      setError(null)
    } catch (cause) {
      release()
      start.onError(cause instanceof Error ? cause.message : 'Could not open the queue editor.')
    } finally {
      inFlight.current = false
    }
  }
  const finish = async (action: 'save' | 'cancel' | 'remove') => {
    const entry = editRef.current
    if (!entry || inFlight.current || stranded) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    beginMobileNativeChatTerminalBurst(entry.handle)
    try {
      await finishNativeQueueEdit(
        ioFor(entry.handle, entry.tabId, lifetime.current),
        entry.agent,
        { ...entry.recall, draft: entry.remote },
        action === 'cancel' ? entry.recall.text : action === 'remove' ? null : entry.text,
        (remote) =>
          setEditing((current) =>
            current?.handle === entry.handle ? { ...current, remote } : current
          )
      )
      clearMobileNativeChatInputResidue(entry.handle)
      setEditing(null)
      release()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not confirm the edit.'
      if (cause instanceof QueueRebuildError) {
        setStranded(true)
        setRemaining(cause.remaining)
        // The sheet may already be unmounted; the list of messages that are no
        // longer on the agent must not die with it.
        if (!editRef.current) {
          latest.current.onError(message)
        }
      }
      setError(message)
    } finally {
      endMobileNativeChatTerminalBurst(entry.handle)
      inFlight.current = false
      setBusy(false)
    }
  }
  return {
    open,
    editor: editing
      ? ({
          text: editing.text,
          busy,
          error,
          movesToEnd: editing.movesToEnd,
          stranded,
          remaining,
          rebuilds: editing.recall.segments !== null,
          setText: (text: string) =>
            setEditing((current) => (current ? { ...current, text } : null)),
          save: () => finish('save'),
          cancel: () => finish('cancel'),
          remove: () => finish('remove'),
          dismiss: () => {
            if (!inFlight.current) {
              setEditing(null)
              release()
            }
          }
        } satisfies InlineQueueEditor)
      : null
  }
}
