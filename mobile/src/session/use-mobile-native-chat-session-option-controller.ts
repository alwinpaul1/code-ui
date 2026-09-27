import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type { RpcClient } from '../transport/rpc-client'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import type { ModelReportSource } from './mobile-native-chat-model-report-authority'
import type { PickDispatch } from './session-option-pick-failure'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import {
  useMobileNativeChatSessionOptions,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'
import { useCodexNativeChatOptions } from './use-codex-native-chat-options'
import { useMobileOmpModelDiscovery } from './use-mobile-omp-model-discovery'
import { useClaudeModelDiscovery } from './use-claude-model-discovery'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import type { ClaudeModelFallback } from './claude-transcript-model'

export function useMobileNativeChatSessionOptionController(args: {
  activeChatStructured: boolean
  activeSessionTabId: string | null
  agent: string | null
  dispatchCommand: PickDispatch
  hostId: string
  isTabChatView: (tabId: string, agent?: string | null) => boolean
  isWorking: boolean
  reportedModel: string | null
  reportedEffort?: string | null
  /** The agent's OWN name for the reported model ("Opus 4.8.5"); the catalog
   *  knows only families. */
  reportedModelLabel?: string | null
  /** Which source `reportedModel` came from; a live reading outranks a local
   *  pick, the launch record does not. */
  reportedModelSource?: ModelReportSource
  /** The tab's terminal, so a new one forgets the old agent's statements. */
  terminalHandle?: string | null
  /** What stands in for the live pair on a Claude session that states no model
   *  (use-claude-transcript-model.ts): the model its transcript last recorded,
   *  or nothing. */
  transcriptModel?: ClaudeModelFallback
  /** The user opened the model sheet: the one moment the fallback may ask. */
  onModelSheetOpen?: () => void
  /** Bumped to open the model sheet imperatively. */
  openRequest?: number
  /** The command the running OMP extension installed for a model switch; absent
   *  on an older host, which then gets a read-only model row (Orca #20612). */
  modelSwitchCommand?: string
  structured: {
    conversationCommands?: readonly AgentSessionConversationCommand[]
    optionPickerRequest?: { id: string; sequence: number } | null
    snapshot: SessionOptionDescriptor[]
    pendingId: string | null
    setOption: MobileNativeChatSessionOptionsController['setOption']
    invokeAction: (id: string) => Promise<boolean>
  }
  toggleTabChatView: (tabId: string, agent?: string | null) => void
  worktreeId: string
  /** Codex drives its own picker over the terminal; these reach it. */
  client: RpcClient | null
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  refreshHud: () => Promise<unknown>
  /** The chat's banner, or its toast: where a pick's failure is said when no
   *  open drawer can show it (a typed `/model`, or a drawer already closed). */
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
    reportedModelLabel,
    reportedModelSource,
    terminalHandle,
    transcriptModel,
    onModelSheetOpen,
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
    if (activeSessionTabId && isTabChatView(activeSessionTabId, agent)) {
      toggleTabChatView(activeSessionTabId, agent)
    }
  }, [activeSessionTabId, agent, isTabChatView, toggleTabChatView])

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
  const discoveredOmpModels = useMobileOmpModelDiscovery({
    client,
    hostId,
    worktreeId,
    enabled: !activeChatStructured && agent === 'omp' && activeSessionTabId !== null
  })
  const lastConnectedAt = useLastConnectedAt(hostId)
  const discoveredClaudeModels = useClaudeModelDiscovery({
    client,
    hostId,
    worktreeId,
    enabled: !activeChatStructured && agent === 'claude' && activeSessionTabId !== null,
    lastConnectedAt
  })
  const scopeKey = mobileNativeChatScopeKey(hostId, worktreeId, activeSessionTabId)
  const sessionOptions = useMobileNativeChatSessionOptions({
    modelSwitchCommand: args.modelSwitchCommand,
    agent: activeChatStructured ? null : agent,
    scopeKey,
    reportedModel,
    reportedEffort,
    reportedModelLabel,
    reportedModelSource,
    terminalHandle,
    dispatchCommand,
    onAgentPicker: handleAgentPicker,
    // Codex discovers through its own hook (`codex debug models`); OMP and
    // Claude through the host's `git.discoverCommitMessageModels` probe (Orca
    // #20612; claude-model-discovery.ts). One agent is active at a time, so
    // only one of them ever carries a list.
    discoveredModels:
      agent === 'omp'
        ? discoveredOmpModels
        : agent === 'claude'
          ? discoveredClaudeModels
          : codex.discoveredModels,
    // Codex's alone: its hook clears its list in an effect, so for one render
    // after a tab turns from Codex to Claude it still holds Codex's apply.
    discoveredModelApply: agent === 'codex' ? codex.discoveredModelApply : null,
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
            optionPickerRequest: structured.optionPickerRequest,
            conversationCommands: structured.conversationCommands,
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
      structuredSnapshot,
      structured.conversationCommands,
      structured.optionPickerRequest
    ]
  )
  const nativeChatSessionOptions = useMemo<MobileNativeChatSessionOptionPickersProps | null>(
    () =>
      activeChatStructured
        ? structuredController
          ? { controller: structuredController, isWorking, reportFailure: onFailure, scopeKey }
          : null
        : sessionOptions.snapshot.length > 0
          ? {
              controller: sessionOptions,
              isWorking,
              reportFailure: onFailure,
              scopeKey,
              openRequest,
              modelsPending: codex.modelsPending,
              liveModel:
                !reportedModel && transcriptModel?.kind === 'transcript'
                  ? { model: transcriptModel.model.model, label: transcriptModel.model.label, effort: null }
                  : { model: reportedModel, label: reportedModelLabel ?? null, effort: reportedEffort ?? null },
              onOpen: onModelSheetOpen
            }
          : null,
    [
      activeChatStructured,
      codex.modelsPending,
      isWorking,
      onFailure,
      openRequest,
      reportedEffort,
      reportedModel,
      reportedModelLabel,
      scopeKey,
      sessionOptions,
      structuredController,
      transcriptModel,
      onModelSheetOpen
    ]
  )

  return { nativeChatSessionOptions, recordCommand: sessionOptions.recordCommand }
}
