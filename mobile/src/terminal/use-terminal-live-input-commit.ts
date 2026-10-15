import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import {
  getTerminalLiveSpecialKeyDecision,
  isTerminalLiveCursorRepositionBytes
} from './terminal-live-text-commit'
import type { TerminalLiveAccessoryInput } from './terminal-live-accessory-input'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'
import { useTerminalLivePendingInputFlush } from './use-terminal-live-pending-input-flush'
import {
  useTerminalLiveAccessoryInputCommit,
  type TerminalLiveAccessoryInputCommitResult
} from './use-terminal-live-accessory-input-commit'

type TerminalLiveInputKeyPressEvent = {
  readonly nativeEvent: {
    readonly key: string
  }
}

/** `isComposing` is the text system's marked-text range, forwarded by the pinned
 *  react-native patch on iOS; `onChangeText` would drop the payload entirely.
 *  Absent means the platform reports no range — not "not composing". */
type TerminalLiveInputChangeEvent = {
  readonly nativeEvent: {
    readonly text: string
    readonly isComposing?: boolean
  }
}

type TerminalLiveInputCommitOptions<TTabType extends string> = {
  readonly activeHandle: string | null
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabType: TTabType | null | undefined
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly connected: boolean
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputTerminalHandles: ReadonlySet<string>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

type TerminalLiveInputCommitHandlers = {
  readonly clearPendingLiveInputCommit: () => void
  readonly flushPendingLiveInputBeforeExternalSend: (handle: string) => Promise<boolean>
  readonly getLiveInputInteractionGeneration: () => number
  readonly handleLiveInputAccessoryBytes: (
    input: TerminalLiveAccessoryInput
  ) => Promise<TerminalLiveAccessoryInputCommitResult>
  readonly handleLiveInputChange: (event: TerminalLiveInputChangeEvent) => void
  readonly handleLiveInputKeyPress: (event: TerminalLiveInputKeyPressEvent) => void
  /** `rewriteLine` sees the line this field typed into the PTY and may return it
   *  with a tail added; only the tail is sent, before the Enter. It is asked only
   *  when that line is the WHOLE PTY line (see `markLiveInputLineEmpty`). */
  readonly handleLiveInputSubmit: (rewriteLine?: (line: string) => string | null) => Promise<boolean>
  /** The phone knows this terminal's input line is empty (a plain terminal it
   *  just created). The next field session typed there may be rewritten. */
  readonly markLiveInputLineEmpty: (handle: string) => void
  /** Whether this terminal's input line is known empty, forgetting it: the caller is about to
   *  write to it from outside the field (the buffered composer's send). */
  readonly takeLiveInputLineEmpty: (handle: string) => boolean
}

export function useTerminalLiveInputCommit<TTabType extends string>({
  activeHandle,
  activeHandleRef,
  activeSessionTabType,
  activeSessionTabTypeRef,
  connected,
  liveInputRef,
  liveInputTerminalHandles,
  liveInputTerminalHandlesRef,
  sendLiveTerminalInputRef,
  setLiveInputCapture
}: TerminalLiveInputCommitOptions<TTabType>): TerminalLiveInputCommitHandlers {
  const liveInputInteractionGenerationRef = useRef(0)
  const advanceLiveInputInteractionGeneration = useCallback(() => {
    liveInputInteractionGenerationRef.current += 1
  }, [])
  const {
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    liveInputComposingRef,
    pendingLiveInputHandleRef,
    sendControlBytesAfterPendingText,
    sentLiveInputTextRef,
    waitForPendingLiveInputFlush
  } = useTerminalLivePendingInputFlush({
    activeHandleRef,
    activeSessionTabTypeRef,
    liveInputRef,
    liveInputTerminalHandlesRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture
  })

  // Which terminals' input lines are known to be empty, and whether the open field
  // session started on one. A submit rewrites a typed `claude` line only when it did:
  // then the field's text is the whole PTY line. Anything else that reaches the PTY
  // (a cursor or history key, a paste, a control) makes the line unknown, and a run
  // typed after it is a FRAGMENT: `x`, ←, `claude` put `claude` before the x, and the
  // auto-mode tail landed in the middle (`claude --permission-mode autox`).
  // Blind to what the desktop types into the same terminal.
  const emptyLineHandlesRef = useRef<Set<string>>(new Set())
  const liveSessionOnEmptyLineRef = useRef<string | null>(null)
  const markLiveInputLineEmpty = useCallback((handle: string) => {
    emptyLineHandlesRef.current.add(handle)
  }, [])
  const takeLiveInputLineEmpty = useCallback(
    (handle: string): boolean => emptyLineHandlesRef.current.delete(handle),
    []
  )
  const forgetLiveInputLineEmpty = useCallback(
    (handle: string | null) => {
      if (handle) {
        emptyLineHandlesRef.current.delete(handle)
      }
      liveSessionOnEmptyLineRef.current = null
      // Why also an interaction: an Enter still in flight marks the line empty when it lands
      // unless the generation moved. A buffered handle's strip keys skip the live path's own
      // onInteraction, so without this, ↑ and Home tapped during a composer send were undone by
      // its late mark, and the next `claude ` got the tail in front of the recalled line.
      advanceLiveInputInteractionGeneration()
    },
    [advanceLiveInputInteractionGeneration]
  )

  useEffect(() => {
    // Why: what reached the PTY is unknowable across an outage — stale mirror state corrupts the first post-reconnect send.
    if (!connected) {
      clearPendingLiveInputCommit()
      emptyLineHandlesRef.current.clear()
      liveSessionOnEmptyLineRef.current = null
    }
  }, [connected, clearPendingLiveInputCommit])

  useEffect(() => {
    const pendingHandle = pendingLiveInputHandleRef.current
    if (!pendingHandle) {
      return
    }
    // Why: a lagging mobile tab list briefly yields no active tab object; a
    // null/undefined type is "unknown", not "left the terminal" — flush guards
    // still block sends if the tab truly changed.
    if (
      !activeHandle ||
      pendingHandle !== activeHandle ||
      (activeSessionTabType != null && activeSessionTabType !== 'terminal') ||
      !liveInputTerminalHandles.has(activeHandle)
    ) {
      clearPendingLiveInputCommit()
    }
  }, [activeHandle, activeSessionTabType, clearPendingLiveInputCommit, liveInputTerminalHandles])

  const flushPendingLiveInputBeforeExternalSend = useCallback(
    async (handle: string): Promise<boolean> => {
      advanceLiveInputInteractionGeneration()
      forgetLiveInputLineEmpty(handle)
      const pendingHandle = pendingLiveInputHandleRef.current
      if (pendingHandle && pendingHandle !== handle) {
        clearPendingLiveInputCommit()
        return waitForPendingLiveInputFlush()
      }
      // Why: external bytes (dictation/paste) land after the field's echo on the
      // PTY; the field session must fully end or later diffs would erase them.
      if (pendingHandle === handle) {
        return flushPendingLiveInputText(handle)
      }
      return waitForPendingLiveInputFlush()
    },
    [
      advanceLiveInputInteractionGeneration,
      clearPendingLiveInputCommit,
      flushPendingLiveInputText,
      forgetLiveInputLineEmpty,
      waitForPendingLiveInputFlush
    ]
  )

  const handleLiveInputChange = useCallback(
    ({ nativeEvent }: TerminalLiveInputChangeEvent) => {
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        clearPendingLiveInputCommit()
        return
      }
      // Why: iOS kills an active dictation/IME session when JS writes a value
      // that differs from the native field text, so the controlled capture must
      // echo the field verbatim; only the PTY mirror sees normalized text.
      advanceLiveInputInteractionGeneration()
      setLiveInputCapture(nativeEvent.text)
      const fieldText = normalizeTerminalTextInput(nativeEvent.text)
      if (pendingLiveInputHandleRef.current !== activeHandle && fieldText.length > 0) {
        // A new field session: it starts on an empty line only if the line was known empty.
        const onEmptyLine = emptyLineHandlesRef.current.delete(activeHandle)
        liveSessionOnEmptyLineRef.current = onEmptyLine ? activeHandle : null
      }
      void applyLiveInputMirror(
        activeHandle,
        fieldText,
        nativeEvent.isComposing
      )
    },
    [
      activeHandle,
      advanceLiveInputInteractionGeneration,
      applyLiveInputMirror,
      clearPendingLiveInputCommit,
      liveInputTerminalHandles,
      setLiveInputCapture
    ]
  )

  const getLiveInputInteractionGeneration = useCallback(
    () => liveInputInteractionGenerationRef.current,
    []
  )

  const handleLiveInputKeyPress = useCallback(
    (event: TerminalLiveInputKeyPressEvent) => {
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        return
      }
      advanceLiveInputInteractionGeneration()
      const ownsPendingState = pendingLiveInputHandleRef.current === activeHandle
      if (pendingLiveInputHandleRef.current && !ownsPendingState) {
        clearPendingLiveInputCommit()
      }
      const decision = getTerminalLiveSpecialKeyDecision({
        key: event.nativeEvent.key,
        heldText: ownsPendingState ? heldLiveInputTextRef.current : '',
        sentText: ownsPendingState ? sentLiveInputTextRef.current : ''
      })
      if (decision.kind === 'send-now' || decision.kind === 'commit-held-then-send') {
        forgetLiveInputLineEmpty(activeHandle)
      }
      switch (decision.kind) {
        case 'ignore':
        case 'local-edit':
          return
        case 'send-now': {
          const repositionBytes = decision.bytes
          void sendControlBytesAfterPendingText(activeHandle, repositionBytes).then(() => {
            // Why: a cursor move from the keyboard leaves the field's linear
            // model out of step with the TUI line, so reset it — the next typed
            // run inserts fresh at the TUI's new cursor (same as the strip path).
            if (isTerminalLiveCursorRepositionBytes(repositionBytes)) {
              clearPendingLiveInputCommit()
            }
          })
          return
        }
        case 'commit-held-then-send':
          void sendControlBytesAfterPendingText(activeHandle, decision.bytes, {
            endsEditingSession: true
          })
          return
        default:
          decision satisfies never
      }
    },
    [
      activeHandle,
      advanceLiveInputInteractionGeneration,
      clearPendingLiveInputCommit,
      forgetLiveInputLineEmpty,
      liveInputTerminalHandles,
      sendControlBytesAfterPendingText
    ]
  )

  const commitLiveInputAccessoryBytes = useTerminalLiveAccessoryInputCommit({
    activeHandle,
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    liveInputComposingRef,
    liveInputRef,
    liveInputTerminalHandles,
    onInteraction: advanceLiveInputInteractionGeneration,
    pendingLiveInputHandleRef,
    sendControlBytesAfterPendingText,
    sentLiveInputTextRef,
    setLiveInputCapture,
    waitForPendingLiveInputFlush
  })

  const handleLiveInputAccessoryBytes = useCallback(
    (input: TerminalLiveAccessoryInput): Promise<TerminalLiveAccessoryInputCommitResult> => {
      // Only a Backspace or Delete edited inside the field keeps the line known; every
      // other strip key reaches the PTY on its own.
      const editsField =
        input.localEdit != null &&
        pendingLiveInputHandleRef.current === activeHandle &&
        sentLiveInputTextRef.current.length + heldLiveInputTextRef.current.length > 0
      if (!editsField) {
        forgetLiveInputLineEmpty(activeHandle)
      }
      return commitLiveInputAccessoryBytes(input)
    },
    [activeHandle, commitLiveInputAccessoryBytes, forgetLiveInputLineEmpty]
  )

  const handleLiveInputSubmit = useCallback(
    (rewriteLine?: (line: string) => string | null): Promise<boolean> => {
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        return Promise.resolve(false)
      }
      advanceLiveInputInteractionGeneration()
      // Why only an extension: the field's text is already on the PTY line, so the
      // one safe edit is more text at the cursor. A field session that ended (a
      // cursor move, a flush) knows no line, and nothing is rewritten.
      // And only a session that began on a known-empty line holds the WHOLE line.
      const wholeLine =
        pendingLiveInputHandleRef.current === activeHandle &&
        liveSessionOnEmptyLineRef.current === activeHandle
      const line = wholeLine ? sentLiveInputTextRef.current + heldLiveInputTextRef.current : ''
      const rewritten = line.length > 0 ? (rewriteLine?.(line) ?? null) : null
      const tail = rewritten !== null && rewritten.startsWith(line) ? rewritten.slice(line.length) : ''
      liveSessionOnEmptyLineRef.current = null
      emptyLineHandlesRef.current.delete(activeHandle)
      const handle = activeHandle
      const generation = liveInputInteractionGenerationRef.current
      return sendControlBytesAfterPendingText(handle, `${tail}\r`, {
        endsEditingSession: true
      }).then((sent) => {
        // The Enter this field sent leaves an empty line, unless something else
        // reached the terminal while it was in flight.
        if (sent && liveInputInteractionGenerationRef.current === generation) {
          emptyLineHandlesRef.current.add(handle)
        }
        return sent
      })
    },
    [
      activeHandle,
      advanceLiveInputInteractionGeneration,
      liveInputTerminalHandles,
      sendControlBytesAfterPendingText
    ]
  )

  return {
    clearPendingLiveInputCommit,
    flushPendingLiveInputBeforeExternalSend,
    getLiveInputInteractionGeneration,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    markLiveInputLineEmpty,
    takeLiveInputLineEmpty
  }
}
