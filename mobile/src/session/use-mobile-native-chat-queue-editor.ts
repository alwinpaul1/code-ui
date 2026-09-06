import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

export type QueueEditorAgent = 'claude' | 'codex'

/** Open the original agent input, never reconstruct a queue from screen previews.
 * Previews can be truncated and omit attachments or messages from another device. */
export function useMobileNativeChatQueueEditor(args: {
  agent: string | null
  tabId: string | null
  handleRef: MutableRefObject<string | null>
  enabled: boolean
  peeking: boolean
  beforeOpen: () => Promise<void>
  peek: (tabId: string) => void
  onError: (message: string) => void
}) {
  const [editor, setEditor] = useState<{
    agent: QueueEditorAgent
    tabId: string
    handle: string
  } | null>(null)
  const latest = useRef(args)
  latest.current = args
  const opening = useRef(false)
  const lifetime = useRef(0)
  useEffect(
    () => () => {
      lifetime.current++
    },
    []
  )
  const open = useCallback(async () => {
    const start = latest.current
    const generation = lifetime.current
    const handle = start.handleRef.current
    if (
      opening.current ||
      !start.enabled ||
      !start.tabId ||
      !handle ||
      (start.agent !== 'claude' && start.agent !== 'codex')
    ) {
      return
    }
    opening.current = true
    try {
      await start.beforeOpen()
      const current = latest.current
      if (
        lifetime.current !== generation ||
        !current.enabled ||
        current.tabId !== start.tabId ||
        current.handleRef.current !== handle
      ) {
        return
      }
      setEditor({ agent: start.agent, tabId: start.tabId, handle })
      current.peek(start.tabId)
    } catch {
      start.onError('Could not open the queue editor. Your queue has not been changed.')
    } finally {
      opening.current = false
    }
  }, [])
  return {
    open,
    agent:
      args.peeking && editor?.tabId === args.tabId && editor.handle === args.handleRef.current
        ? editor.agent
        : null
  }
}
