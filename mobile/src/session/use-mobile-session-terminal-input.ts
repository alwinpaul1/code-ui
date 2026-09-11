import { useCallback } from 'react'
import {
  clearTerminalLiveInputFocusTimer,
  scheduleTerminalLiveInputFocus
} from '../terminal/terminal-live-input'
import { sendMobileTerminalQueryReply } from '../terminal/mobile-terminal-query-reply'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../terminal/terminal-send-request'
import {
  isMouseClickSequence,
  splitTerminalGestureInputSequences,
  wheelSequenceDirection
} from '../terminal/terminal-gesture-input'
import {
  isGestureMouseTrackingMode,
  TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
  TERMINAL_GESTURE_INPUT_MAX_IN_FLIGHT,
  TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES,
  TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS,
  TERMINAL_GESTURE_INPUT_SEQUENCES_PER_FLUSH
} from './mobile-session-route-helpers'
import type { Terminal, TerminalGestureInputQueue } from './mobile-session-route-types'
import type { MobileSessionFileActionsModel } from './use-mobile-session-file-actions'

export function useMobileSessionTerminalInput(scope: MobileSessionFileActionsModel) {
  const {
    client,
    connState,
    toggleTerminalLiveInput,
    activeHandle,
    ptyModesRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    deviceTokenRef,
    clientRef,
    connStateRef,
    liveInputRef,
    liveInputFocusTimerRef,
    terminalUnsubsRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    clearPendingLiveInputCommit,
    showToast,
    getTerminalRef,
    hostQueryReplyInputSupportedRef,
    hostPlatformRef
  } = scope
  const toggleLiveInput = useCallback(() => {
    if (!activeHandle) {
      return
    }
    const nextEnabled = toggleTerminalLiveInput(activeHandle)
    clearPendingLiveInputCommit()
    if (nextEnabled) {
      scheduleTerminalLiveInputFocus(liveInputFocusTimerRef, () => liveInputRef.current?.focus())
    } else {
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      liveInputRef.current?.blur()
    }
  }, [activeHandle, clearPendingLiveInputCommit, toggleTerminalLiveInput])

  // Why: a burst of wheel rows goes out one per flush, not as one batch — a
  // TUI repaints once per batch, so batches are jumps. Sends still pipeline
  // (the reply does not pace them); the timer does.
  const flushTerminalGestureInput = useCallback(async (handle: string) => {
    const queued = terminalGestureInputQueuesRef.current.get(handle)
    if (!queued) {
      return
    }
    if (queued.timer) {
      clearTimeout(queued.timer)
      queued.timer = null
    }
    const isActive =
      handle === activeHandleRef.current && activeSessionTabTypeRef.current === 'terminal'
    const isFresh = Date.now() - queued.lastUpdatedMs <= TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS
    const rpc = clientRef.current
    if (!rpc || connStateRef.current !== 'connected' || !isActive || !isFresh) {
      terminalGestureInputQueuesRef.current.delete(handle)
      return
    }
    const inFlight = terminalGestureInputInFlightRef.current.get(handle) ?? 0
    if (inFlight >= TERMINAL_GESTURE_INPUT_MAX_IN_FLIGHT) {
      // A link that stopped answering: the next reply drains the queue.
      return
    }
    const batch = queued.sequences.splice(0, TERMINAL_GESTURE_INPUT_SEQUENCES_PER_FLUSH)
    if (queued.sequences.length === 0) {
      terminalGestureInputQueuesRef.current.delete(handle)
    } else {
      // Why: the queue is alive while it drains; age measures silence, not a fling's length.
      queued.lastUpdatedMs = Date.now()
      queued.timer = setTimeout(() => {
        queued.timer = null
        void flushTerminalGestureInput(handle)
      }, TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS)
    }
    if (batch.length === 0) {
      return
    }

    terminalGestureInputInFlightRef.current.set(handle, inFlight + 1)
    try {
      await rpc.sendRequest(
        'terminal.send',
        buildTerminalSendParams({
          terminal: handle,
          text: batch.join(''),
          enter: false,
          deviceToken: deviceTokenRef.current
        }),
        TERMINAL_INPUT_SEND_OPTIONS
      )
    } catch {
      // Transient failure
    } finally {
      const remaining = (terminalGestureInputInFlightRef.current.get(handle) ?? 1) - 1
      if (remaining <= 0) {
        terminalGestureInputInFlightRef.current.delete(handle)
      } else {
        terminalGestureInputInFlightRef.current.set(handle, remaining)
      }
      const next = terminalGestureInputQueuesRef.current.get(handle)
      if (next && !next.timer) {
        void flushTerminalGestureInput(handle)
      }
    }
  }, [])

  const enqueueTerminalGestureInput = useCallback(
    (handle: string, sequences: string[]) => {
      const now = Date.now()
      const current = terminalGestureInputQueuesRef.current.get(handle)
      if (current) {
        // Why: a reversal is a change of mind — the rows still queued the
        // other way would scroll on against the finger before these begin.
        const incoming = wheelSequenceDirection(sequences[0] ?? '')
        const queuedDirection = wheelSequenceDirection(current.sequences[0] ?? '')
        if (incoming && queuedDirection && incoming !== queuedDirection) {
          current.sequences.length = 0
        }
        current.sequences.push(...sequences)
        // Why the NEWEST rows are kept: a fling's tail is what reaches the end
        // of the transcript. Keeping the oldest left Claude Code a few rows
        // short of its bottom, with its sticky header row still up (2026-09-11).
        const overflow = current.sequences.length - TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES
        if (overflow > 0) {
          current.sequences.splice(0, overflow)
        }
        current.lastUpdatedMs = now
        return
      }
      const queued: TerminalGestureInputQueue = {
        sequences: sequences.slice(-TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES),
        timer: null,
        lastUpdatedMs: now
      }
      terminalGestureInputQueuesRef.current.set(handle, queued)
      // The first row goes now; the rest follow one flush apart.
      void flushTerminalGestureInput(handle)
    },
    [flushTerminalGestureInput]
  )

  const handleTerminalInput = useCallback(
    async (handle: string, bytes: string) => {
      const rpc = client
      if (!rpc || connState !== 'connected' || bytes.length === 0) {
        return
      }
      if (handle !== activeHandleRef.current || activeSessionTabTypeRef.current !== 'terminal') {
        return
      }
      const modes = ptyModesRef.current.get(handle)
      // Why: WebView gesture bytes can become PTY input, so gate mouse reports behind validation and SSH-safe rate limiting.
      if (!modes?.altScreen && !isGestureMouseTrackingMode(modes?.mouseTrackingMode)) {
        return
      }
      const sequences = splitTerminalGestureInputSequences(bytes)
      if (sequences == null) {
        return
      }
      // Why: a click is press + release in one payload and must arrive as one
      // and now — paced behind up to 96 wheel rows it landed 1.5 s late on
      // stale coordinates, and a full queue could keep the press and drop the
      // release, leaving the program with a held button (reviewed 2026-09-11).
      if (sequences.every(isMouseClickSequence)) {
        void rpc.sendRequest(
          'terminal.send',
          buildTerminalSendParams({
            terminal: handle,
            text: bytes,
            enter: false,
            deviceToken: deviceTokenRef.current
          }),
          TERMINAL_INPUT_SEND_OPTIONS
        ).catch(() => undefined)
        return
      }
      enqueueTerminalGestureInput(handle, sequences)
    },
    [client, connState, deviceTokenRef, enqueueTerminalGestureInput]
  )

  const handleTerminalQueryReply = useCallback((handle: string, bytes: string) => {
    void sendMobileTerminalQueryReply({
      bytes,
      client: clientRef.current,
      clientId: deviceTokenRef.current,
      connected: connStateRef.current === 'connected',
      handle,
      hostSupportsQueryReplyInput: hostQueryReplyInputSupportedRef.current,
      hostPlatform: hostPlatformRef.current,
      subscribedTerminals: terminalUnsubsRef.current
    })
  }, [])

  async function handleClearTerminal(target: Terminal) {
    if (!client) {
      return
    }
    getTerminalRef(target.handle)?.clear()
    try {
      await client.sendRequest('terminal.clearBuffer', {
        terminal: target.handle
      })
      showToast('Terminal cleared')
    } catch {
      showToast("Couldn't clear terminal", 1500)
    }
  }
  return {
    toggleLiveInput,
    flushTerminalGestureInput,
    enqueueTerminalGestureInput,
    handleTerminalInput,
    handleTerminalQueryReply,
    handleClearTerminal
  }
}

export type MobileSessionTerminalInputModel = MobileSessionFileActionsModel &
  ReturnType<typeof useMobileSessionTerminalInput>
