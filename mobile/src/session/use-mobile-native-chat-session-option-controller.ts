import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import {
  useMobileNativeChatSessionOptions,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'
import { useCodexNativeChatOptions } from './use-codex-native-chat-options'

export function useMobileNativeChatSessionOptionController(args: {
  activeChatStructured: boolean
  activeSessionTabId: string | null
  agent: string | null
  dispatchCommand: (text: string) => Promise<MobileNativeChatSendOutcome>
  hostId: string
  isTabChatView: (tabId: string) => boolean
  isWorking: boolean
  reportedModel: string | null
  reportedEffort?: string | null
  /** A model badge was read from the terminal's status line (see the pickers' hint). */
  statusLineObserved?: boolean
  /** Subscription name for the sheet caption (Codex: from /status), when known. */
  planLabel?: string | null
  /** Bumped to open the model sheet imperatively. */
  openRequest?: number
  structured: {
    snapshot: SessionOptionDescriptor[]
    pendingId: string | null
    setOption: (id: string, value: SessionOptionValue) => Promise<boolean>
    invokeAction: (id: string) => Promise<boolean>
  }
  toggleTabChatView: (tabId: string) => void
  worktreeId: string
  /** Codex drives its own picker over the terminal; these reach it. */
  client: RpcClient | null
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  refreshHud: () => Promise<unknown>
  onFailure: (message: string) => void
}): {
  nativeChatSessionOptions: MobileNativeChatSessionOptionPickersProps | null
  recordCommand: (command: string) => void
} {
  const {
    activeChatStructured,
    activeSessionTabId,
    agent,
    dispatchCommand,
    hostId,
    isTabChatView,
    isWorking,
    reportedModel,
    reportedEffort,
    statusLineObserved = true,
    planLabel = null,
    openRequest = 0,
    structured,
    toggleTabChatView,
    worktreeId,
    client,
    handleRef,
    deviceTokenRef,
    refreshHud,
    onFailure
  } = args
  const {
    invokeAction: invokeStructuredAction,
    pendingId: structuredPendingId,
    setOption: setStructuredOption,
    snapshot: structuredSnapshot
  } = structured

  const handleAgentPicker = useCallback(() => {
    if (activeSessionTabId && isTabChatView(activeSessionTabId)) {
      toggleTabChatView(activeSessionTabId)
    }
  }, [activeSessionTabId, isTabChatView, toggleTabChatView])

  // Why a ref: the Codex hook needs the model the sheet shows, which is only
  // known once the options hook below has built its snapshot.
  const currentModelRef = useRef<string | null>(null)
  const codex = useCodexNativeChatOptions({
    agent: activeChatStructured ? null : agent,
    client,
    hostId,
    worktreeId,
    handleRef,
    deviceTokenRef,
    currentModelId: () => currentModelRef.current,
    refreshHud,
    onFailure
  })
  const sessionOptions = useMobileNativeChatSessionOptions({
    agent: activeChatStructured ? null : agent,
    scopeKey: mobileNativeChatScopeKey(hostId, worktreeId, activeSessionTabId),
    reportedModel,
    reportedEffort,
    dispatchCommand,
    onAgentPicker: handleAgentPicker,
    discoveredModels: codex.discoveredModels,
    discoveredModelApply: codex.discoveredModelApply,
    applyOverride: codex.applyOverride
  })
  useLayoutEffect(() => {
    const model = sessionOptions.snapshot.find((descriptor) => descriptor.category === 'model')
    currentModelRef.current =
      model?.kind.type === 'select' && typeof model.kind.currentValue === 'string'
        ? model.kind.currentValue
        : null
  })
  const structuredController = useMemo<MobileNativeChatSessionOptionsController | null>(
    () =>
      activeChatStructured && structuredSnapshot.length > 0
        ? {
            snapshot: structuredSnapshot,
            pendingId: structuredPendingId,
            setOption: setStructuredOption,
            invokeAction: invokeStructuredAction,
            recordCommand: () => {}
          }
        : null,
    [
      activeChatStructured,
      invokeStructuredAction,
      setStructuredOption,
      structuredPendingId,
      structuredSnapshot
    ]
  )
  const nativeChatSessionOptions = useMemo<MobileNativeChatSessionOptionPickersProps | null>(
    () =>
      activeChatStructured
        ? structuredController
          ? { controller: structuredController, isWorking }
          : null
        : sessionOptions.snapshot.length > 0
          ? {
              controller: sessionOptions,
              isWorking,
              statusLineObserved,
              planLabel,
              openRequest,
              modelsPending: codex.modelsPending
            }
          : null,
    [
      activeChatStructured,
      codex.modelsPending,
      isWorking,
      openRequest,
      planLabel,
      sessionOptions,
      statusLineObserved,
      structuredController
    ]
  )

  return { nativeChatSessionOptions, recordCommand: sessionOptions.recordCommand }
}
