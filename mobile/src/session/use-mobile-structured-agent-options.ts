import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import { structuredAgentSessionSeedCatalog } from '../../../src/shared/structured-agent-session-seed-catalog'
import type {
  AgentSessionOptionResult,
  AgentSessionOptionsResult
} from '../../../src/shared/agent-session-wire'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import {
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  commitStructuredAgentSessionOption,
  commitStructuredAgentSessionOptionValues,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionPicks,
  structuredAgentSessionOptionSnapshot,
  type StructuredAgentSessionOptionState
} from '../../../src/shared/structured-agent-session-options'
import type { RpcClient } from '../transport/rpc-client'
import {
  callAgentSession,
  type StructuredAgentSessionMutate
} from './mobile-structured-agent-session-rpc'
import { persistMobileStructuredOptionPicks } from './mobile-native-chat-session-option-persistence'
import {
  parseStructuredRewindSupport,
  type StructuredRewindSupport
} from './mobile-structured-agent-rewind'
import { encodeStructuredAgentSessionOptionValue } from '../../../src/shared/structured-agent-session-option-codec'
import type { PickFailureReport } from './session-option-pick-failure'

type StructuredOptionsController = {
  optionPickerRequest: { id: string; sequence: number } | null
  conversationCommands: readonly AgentSessionConversationCommand[]
  /** Whether the host will rewind this session; null until it has said, and on a host that never says. */
  rewindSupport: StructuredRewindSupport | null
  optionSnapshot: SessionOptionDescriptor[]
  optionSurface: SessionOptionsSurface
  pendingOptionId: string | null
  /** `report` is where a host refusal of the pick is said (PickFailureReport). */
  setStructuredOption: (
    id: string,
    value: SessionOptionValue,
    report?: PickFailureReport
  ) => Promise<boolean>
  invokeStructuredOption: (id: string) => Promise<boolean>
}

export function useMobileStructuredAgentOptions(args: {
  agent: string | null
  client: RpcClient | null
  sessionId: string | null
  enabled: boolean
  fence: number | null
  mutate: StructuredAgentSessionMutate
}): StructuredOptionsController {
  const { agent, client, enabled, fence, mutate, sessionId } = args
  const [optionState, setOptionState] = useState(() =>
    createStructuredAgentSessionOptionState(agent ?? 'codex')
  )
  const optionStateRef = useRef(optionState)
  const activeOptionRecordRef = useRef(optionState.record)
  const pendingOptionRef = useRef<string | null>(null)
  const optionMutationGeneration = useRef(0)
  const updateOptionState = useCallback(
    (update: (current: StructuredAgentSessionOptionState) => StructuredAgentSessionOptionState) => {
      const next = update(optionStateRef.current)
      optionStateRef.current = next
      setOptionState(next)
    },
    []
  )
  const [optionPickerRequest, setOptionPickerRequest] = useState<{
    id: string
    sequence: number
  } | null>(null)
  const [conversationSupport, setConversationSupport] = useState<{
    sessionId: string
    commands: readonly AgentSessionConversationCommand[]
    rewind: StructuredRewindSupport | null
  } | null>(null)
  // Every agent's seed (Orca #26407): a built-in list, or none for an agent whose structured session
  // offers its options only live (Grok, OpenCode, Pi, OMP), so the live read runs for every agent.
  // The state still starts with no catalog: the picker names nothing until the session answers.
  const optionCatalog = useMemo(
    () => (agent ? structuredAgentSessionSeedCatalog(agent) : null),
    [agent]
  )

  useEffect(() => {
    const next = createStructuredAgentSessionOptionState(agent ?? 'codex')
    optionMutationGeneration.current += 1
    pendingOptionRef.current = null
    optionStateRef.current = next
    activeOptionRecordRef.current = next.record
    setOptionState(next)
  }, [agent, enabled, fence, sessionId])

  useEffect(() => {
    if (!client || !sessionId || !enabled || !optionCatalog) {
      return
    }
    let stale = false
    const readGeneration = optionMutationGeneration.current
    void callAgentSession<AgentSessionOptionsResult>(client, 'agentSession.options', { sessionId })
      .then((result) => {
        if (!stale && optionMutationGeneration.current === readGeneration) {
          setConversationSupport({
            sessionId,
            commands: result.conversationCommands ?? [],
            // Not on the vendored options type: upstream added `rewind` with the
            // backend (#19235), and this fork reads it defensively instead.
            rewind: parseStructuredRewindSupport(result)
          })
          updateOptionState((current) =>
            current.record === activeOptionRecordRef.current
              ? applyStructuredAgentSessionOptions(current, optionCatalog, result)
              : current
          )
        }
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [client, enabled, optionCatalog, sessionId, fence, updateOptionState])

  const optionSnapshot = useMemo(
    () => structuredAgentSessionOptionSnapshot(optionState),
    [optionState]
  )

  const setStructuredOption = useCallback(
    async (id: string, value: SessionOptionValue, report?: PickFailureReport): Promise<boolean> => {
      const currentState = optionStateRef.current
      const encoded = encodeStructuredAgentSessionOptionValue(id, value)
      if (
        pendingOptionRef.current !== null ||
        !client ||
        !sessionId ||
        !optionCatalog ||
        encoded === null ||
        !canSetStructuredAgentSessionOption(currentState, id, value)
      ) {
        return false
      }
      const targetRecord = currentState.record
      const mutationGeneration = ++optionMutationGeneration.current
      pendingOptionRef.current = id
      updateOptionState((current) => ({ ...current, pendingId: id }))
      try {
        const result = await mutate<AgentSessionOptionResult>(
          'agentSession.setOption',
          'agentSession.setOption',
          { key: id, value: encoded },
          { onError: report }
        )
        if (
          activeOptionRecordRef.current !== targetRecord ||
          optionMutationGeneration.current !== mutationGeneration
        ) {
          return result.status !== 'rejected'
        }
        if (result.status === 'accepted') {
          const committed = result.value.options ?? { [id]: encoded }
          updateOptionState((current) =>
            current.record === targetRecord && result.sameFence
              ? commitStructuredAgentSessionOptionValues(current, committed)
              : current
          )
          // Only an accepted pick: an `unknown` outcome commits optimistically to the
          // visible record, and remembering one the provider refused would seed a
          // launch the user never chose.
          if (agent) {
            void persistMobileStructuredOptionPicks({
              client,
              agent,
              picks: structuredAgentSessionOptionPicks(currentState, committed)
            })
          }
          if (result.sameFence) {
            void callAgentSession<AgentSessionOptionsResult>(client, 'agentSession.options', {
              sessionId
            })
              .then((refreshed) => {
                if (
                  activeOptionRecordRef.current === targetRecord &&
                  optionMutationGeneration.current === mutationGeneration
                ) {
                  updateOptionState((latest) =>
                    latest.record === targetRecord
                      ? applyStructuredAgentSessionOptions(latest, optionCatalog, refreshed)
                      : latest
                  )
                }
              })
              .catch(() => undefined)
          }
          return true
        }
        if (result.status === 'unknown') {
          updateOptionState((current) =>
            current.record === targetRecord
              ? commitStructuredAgentSessionOption(current, id, encoded)
              : current
          )
          return true
        }
        return false
      } finally {
        if (
          activeOptionRecordRef.current === targetRecord &&
          optionMutationGeneration.current === mutationGeneration
        ) {
          pendingOptionRef.current = null
          updateOptionState((current) =>
            current.record === targetRecord && current.pendingId === id
              ? { ...current, pendingId: null }
              : current
          )
        }
      }
    },
    [agent, client, mutate, optionCatalog, sessionId, updateOptionState]
  )

  const invokeStructuredOption = useCallback(
    async (id: string) => {
      if (!optionSnapshot.some((entry) => entry.id === id)) {
        return false
      }
      setOptionPickerRequest((current) => ({ id, sequence: (current?.sequence ?? 0) + 1 }))
      return true
    },
    [optionSnapshot]
  )

  const setOption = useCallback(
    async (id: string, value: SessionOptionValue) => {
      await setStructuredOption(id, value)
      return { snapshot: structuredAgentSessionOptionSnapshot(optionStateRef.current) }
    },
    [setStructuredOption]
  )

  const optionSurface = useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => optionSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: optionSnapshot }),
      subscribe: () => () => {}
    }),
    [optionSnapshot, setOption]
  )

  return {
    optionPickerRequest,
    conversationCommands:
      conversationSupport?.sessionId === sessionId ? conversationSupport.commands : [],
    rewindSupport: conversationSupport?.sessionId === sessionId ? conversationSupport.rewind : null,
    optionSnapshot,
    optionSurface,
    pendingOptionId: optionState.pendingId,
    setStructuredOption,
    invokeStructuredOption
  }
}
