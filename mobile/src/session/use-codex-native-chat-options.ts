// Codex's model/effort sheet: models discovered from the account, applied by
// driving Codex's own `/model` picker. Plugs into useMobileNativeChatSessionOptions
// through `discoveredModels` and `applyOverride`; inert for every other agent.
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog-types'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import {
  CODEX_DISCOVERED_MODEL_APPLY,
  discoverCodexModels,
  discoveredCodexCatalogModels,
  peekDiscoveredCodexModels,
  type DiscoveredCodexModel
} from './codex-model-discovery'
import type { CatalogOptionApply } from '../../../src/shared/agent-session-option-catalog-types'
import { applyCodexPickerSelection, createCodexPickerIo } from './codex-picker-apply'

export type CodexNativeChatOptions = {
  discoveredModels: CatalogModel[] | null
  discoveredModelApply: CatalogOptionApply | null
  applyOverride: ((id: string, value: SessionOptionValue) => Promise<boolean | null>) | undefined
}

export function useCodexNativeChatOptions(args: {
  agent: string | null
  client: RpcClient | null
  hostId: string
  worktreeId: string
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  /** The model the sheet currently shows, so an effort pick knows its owner. */
  currentModelId: () => string | null
  /** Re-read the terminal footer after an apply so the pill follows it. */
  refreshHud: () => Promise<unknown>
  onFailure: (message: string) => void
}): CodexNativeChatOptions {
  const { agent, client, hostId, worktreeId, handleRef, deviceTokenRef } = args
  const { currentModelId, refreshHud, onFailure } = args
  const isCodex = agent === 'codex'
  const [discovered, setDiscovered] = useState<DiscoveredCodexModel[] | null>(() =>
    isCodex ? peekDiscoveredCodexModels(hostId, worktreeId) : null
  )

  useEffect(() => {
    if (!isCodex || !client) {
      setDiscovered(null)
      return
    }
    let active = true
    setDiscovered(peekDiscoveredCodexModels(hostId, worktreeId))
    void discoverCodexModels({ client, hostId, worktreeId }).then((models) => {
      if (active && models.length > 0) {
        setDiscovered(models)
      }
    })
    return () => {
      active = false
    }
  }, [client, hostId, isCodex, worktreeId])

  const discoveredModels = useMemo(
    () => (discovered && discovered.length > 0 ? discoveredCodexCatalogModels(discovered) : null),
    [discovered]
  )

  const applyOverride = useCallback(
    async (id: string, value: SessionOptionValue): Promise<boolean | null> => {
      const handle = handleRef.current
      if (!client || !handle || typeof value !== 'string') {
        onFailure("Can't reach the Codex terminal right now")
        return false
      }
      const io = createCodexPickerIo({
        client,
        terminal: handle,
        deviceToken: deviceTokenRef.current
      })
      let target
      if (id === 'model') {
        target = { model: value, effort: null }
      } else if (id === 'effort') {
        const model = currentModelId()
        if (!model) {
          onFailure('Pick a model first')
          return false
        }
        const level = discovered
          ?.find((candidate) => candidate.id === model)
          ?.levels.find((candidate) => candidate.id === value)
        target = { model, effort: level ?? { id: value, label: value } }
      } else {
        return null
      }
      const result = await applyCodexPickerSelection(io, target)
      void refreshHud()
      if (result.ok) {
        return true
      }
      onFailure(
        result.reason === 'busy'
          ? 'Codex is working — try again when the turn ends'
          : result.reason === 'model-unavailable'
            ? "That model isn't in this account's picker"
            : result.reason === 'effort-unavailable'
              ? "That effort isn't offered for this model"
              : "Couldn't apply it through the Codex picker"
      )
      return false
    },
    [client, currentModelId, deviceTokenRef, discovered, handleRef, onFailure, refreshHud]
  )

  return {
    discoveredModels,
    discoveredModelApply: discoveredModels ? CODEX_DISCOVERED_MODEL_APPLY : null,
    applyOverride: isCodex ? applyOverride : undefined
  }
}
