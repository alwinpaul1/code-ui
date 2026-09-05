import { useRef, useCallback } from 'react'
import { useMobileNativeChatTerminalStream } from './use-mobile-native-chat-terminal-stream'
import type { MobileSessionTerminalSubscriptionModel } from './use-mobile-session-terminal-subscription'

export function useMobileSessionTerminalStreamDisplay(
  scope: MobileSessionTerminalSubscriptionModel
) {
  const {
    client,
    activeHandle,
    coveredStreamRevision,
    terminalModes,
    deviceTokenRef,
    viewportRef,
    terminalUnsubsRef,
    subscribingHandlesRef,
    leaseOnlyHandlesRef,
    initializedHandlesRef,
    webReadyHandlesRef,
    activeSessionTab,
    nativeChatInputLeaseReady,
    showNativeChat,
    unsubscribeTerminal,
    subscribeToTerminal,
    measureViewportOnce
  } = scope
  const nativeChatStream = useMobileNativeChatTerminalStream({
    showNativeChat,
    activeHandle,
    activeTabType: activeSessionTab?.type ?? null,
    leaseReady: nativeChatInputLeaseReady,
    streamRevision: coveredStreamRevision,
    subscriptionsRef: terminalUnsubsRef,
    subscribingRef: subscribingHandlesRef,
    leaseOnlyRef: leaseOnlyHandlesRef,
    webReadyRef: webReadyHandlesRef,
    initializedRef: initializedHandlesRef,
    subscribe: subscribeToTerminal,
    unsubscribe: unsubscribeTerminal
  })

  // Why: server does the resize and emits 'resized' on the existing subscription — no client-side state tracking needed.
  const toggleInFlightRef = useRef<Set<string>>(new Set())
  // Requests for one handle run in order. Dropping a request while another was
  // in flight is how a chat→terminal switch ended up painted at desktop width:
  // its 'auto' arrived while the previous 'desktop' was still pending and was
  // silently skipped.
  const queueRef = useRef<Map<string, Promise<unknown>>>(new Map())
  /** Request a display mode outright; resolves true once the host accepted it. */
  const setDisplayMode = useCallback(
    async (handle: string, next: 'auto' | 'desktop'): Promise<boolean> => {
      if (!client) {
        return false
      }
      const previous = queueRef.current.get(handle) ?? Promise.resolve()
      const run = previous.then(
        async () => {
          toggleInFlightRef.current.add(handle)
          try {
            // 'auto' is a no-op on the host without phone dims; measure them first
            // when the terminal has never been visible (a tab that opened as chat).
            if (next === 'auto' && !viewportRef.current) {
              await measureViewportOnce(handle)
            }
            const response = await client.sendRequest('terminal.setDisplayMode', {
              terminal: handle,
              mode: next,
              // Why: presence-lock take-floor — requesting 'auto' is the explicit "drive at phone dims" gesture.
              ...(deviceTokenRef.current
                ? { client: { id: deviceTokenRef.current, type: 'mobile' as const } }
                : {}),
              // Why: late-bind viewport for terminals subscribed before measurement, or auto toggles no-op on a null stored viewport.
              ...(viewportRef.current && next === 'auto' ? { viewport: viewportRef.current } : {})
            })
            return response.ok
          } catch {
            // Mode change failed — server state unchanged, UI stays in sync.
            return false
          } finally {
            toggleInFlightRef.current.delete(handle)
          }
        },
        () => false
      )
      queueRef.current.set(handle, run)
      const result = await run
      if (queueRef.current.get(handle) === run) {
        queueRef.current.delete(handle)
      }
      return result
    },
    [client, measureViewportOnce]
  )
  const toggleDisplayMode = useCallback(
    async (handle: string) => {
      const current = terminalModes.get(handle) ?? 'auto'
      // Why: 'phone' is an observed state, not a setting; the toggle only requests 'auto' or 'desktop'.
      await setDisplayMode(handle, current === 'auto' || current === 'phone' ? 'desktop' : 'auto')
    },
    [setDisplayMode, terminalModes]
  )
  return {
    nativeChatStream,
    toggleInFlightRef,
    setDisplayMode,
    toggleDisplayMode
  }
}

export type MobileSessionTerminalStreamDisplayModel = MobileSessionTerminalSubscriptionModel &
  ReturnType<typeof useMobileSessionTerminalStreamDisplay>
