import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../terminal/terminal-send-request'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import {
  finishNativeQueueEdit,
  recallNativeQueue,
  type QueueEditorAgent,
  type QueueEditorIo
} from './native-queue-editor'
export type { QueueEditorAgent } from './native-queue-editor'

export type InlineQueueEditor = {
  text: string
  busy: boolean
  error: string | null
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
  original: string
  remote: string
  text: string
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
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)
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
    if (editing && (editing.tabId !== args.tabId || editing.handle !== args.handleRef.current)) {
      release()
      setEditing(null)
    }
  }, [args.tabId, args.handleRef, editing, release])

  function ioFor(handle: string, tabId: string, generation: number): QueueEditorIo {
    const assertCurrent = () => {
      const current = latest.current
      if (
        lifetime.current !== generation ||
        !current.enabled ||
        !current.client ||
        current.tabId !== tabId ||
        current.handleRef.current !== handle
      ) {
        throw new Error('Connection or session changed. The agent input has been preserved.')
      }
      return current
    }
    return {
      read: async () => {
        const current = assertCurrent()
        const response = await current.client!.sendRequest(
          'terminal.read',
          { terminal: handle, screen: true },
          { timeoutMs: 2500, failWhenDisconnected: true }
        )
        assertCurrent()
        if (!response.ok) {
          throw new Error('Could not read the agent input.')
        }
        const result = response.result as {
          terminal?: { tail?: string[]; lines?: string[]; draft?: string; source?: string }
        }
        const terminal = result.terminal
        return {
          lines: terminal?.tail ?? terminal?.lines ?? [],
          draft: terminal?.draft ?? '',
          source: terminal?.source ?? ''
        }
      },
      write: async (text, idleOnly) => {
        const current = assertCurrent()
        const response = await current.client!.sendRequest(
          'terminal.send',
          {
            ...buildTerminalSendParams({
              terminal: handle,
              text,
              enter: false,
              deviceToken: current.deviceTokenRef.current
            }),
            ...(idleOnly ? { requireAgentStatus: 'sendable' } : {})
          },
          { ...TERMINAL_INPUT_SEND_OPTIONS, timeoutMs: 5000 }
        )
        assertCurrent()
        if (!isTerminalSendRpcAccepted(response)) {
          throw new Error('The agent did not accept the edit. Your input has been kept.')
        }
      },
      pause: () => new Promise((resolve) => setTimeout(resolve, 120))
    }
  }
  const open = async () => {
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
      const original = await recallNativeQueue(ioFor(handle, start.tabId, generation), agent)
      // A recalled message is now an unsent draft. Its former optimistic bubble
      // must not reappear as delivered when the queue preview disappears.
      // Match the full original, never a truncated terminal preview.
      const pending = start.pending?.findLast(
        (item) => !item.images?.length && item.text.trim() === original.trim()
      )
      if (pending) {
        start.removePending?.(pending.id)
      }
      setEditing({ agent, handle, tabId: start.tabId, original, remote: original, text: original })
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
    if (!entry || inFlight.current) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await finishNativeQueueEdit(
        ioFor(entry.handle, entry.tabId, lifetime.current),
        entry.agent,
        entry.remote,
        action === 'cancel' ? entry.original : action === 'remove' ? null : entry.text,
        (remote) =>
          setEditing((current) =>
            current?.handle === entry.handle ? { ...current, remote } : current
          )
      )
      setEditing(null)
      release()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm the edit.')
    } finally {
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
