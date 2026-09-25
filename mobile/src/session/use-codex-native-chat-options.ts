// Codex's model/effort sheet: models discovered from the account, applied by
// driving Codex's own `/model` picker. Plugs into useMobileNativeChatSessionOptions
// through `discoveredModels` and `applyOverride`; inert for every other agent.
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import {
  codexVisibleModelsKey,
  hydrateCodexVisibleModels,
  peekCodexVisibleModels,
  subscribeCodexVisibleModels,
  type CodexVisibleModel
} from './codex-visible-models'
import type { RpcClient } from '../transport/rpc-client'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog-types'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import {
  CODEX_DISCOVERED_MODEL_APPLY,
  discoverCodexModels,
  discoveredCodexCatalogModels,
  hydrateDiscoveredCodexModels,
  peekDiscoveredCodexModels,
  type DiscoveredCodexModel
} from './codex-model-discovery'
import type { CatalogOptionApply } from '../../../src/shared/agent-session-option-catalog-types'
import {
  applyCodexPickerSelection,
  createCodexPickerIo,
  type CodexPickerIo
} from './codex-picker-apply'
import { withCodexTerminalLock } from './codex-terminal-lock'
import type { PickFailureReport } from './session-option-pick-failure'

export type CodexNativeChatOptions = {
  discoveredModels: CatalogModel[] | null
  /** True until Codex's own picker has been read for this terminal, so the
   *  sheet shows a reader instead of a list that will be replaced. */
  modelsPending: boolean
  discoveredModelApply: CatalogOptionApply | null
  applyOverride: CodexApplyOverride | undefined
}

const CODEX_UNREACHABLE = "Can't reach the Codex terminal right now"
/** A key may have reached Codex before the link failed, so its picker may be
 *  open on the desktop, part way through the pick. */
const CODEX_PICK_UNCONFIRMED = 'Pick unconfirmed — check the Codex terminal before retrying'

type CodexApplyOverride = (
  id: string,
  value: SessionOptionValue,
  report?: PickFailureReport
) => Promise<boolean | null>

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
    // The persisted copy fills labels and effort levels at once; the live
    // probe (a `codex debug models` run on the host) replaces it when it lands.
    void hydrateDiscoveredCodexModels(hostId, worktreeId).then(() => {
      if (active) {
        setDiscovered((current) => current ?? peekDiscoveredCodexModels(hostId, worktreeId))
      }
    })
    void discoverCodexModels({ client, hostId, worktreeId }).then((models) => {
      if (active && models.length > 0) {
        setDiscovered(models)
      }
    })
    return () => {
      active = false
    }
  }, [client, hostId, isCodex, worktreeId])

  // Membership comes from Codex's own picker (see codex-visible-models.ts);
  // the host probe only contributes display names and per-model effort levels.
  const visibleKey = codexVisibleModelsKey(hostId, worktreeId)
  const [visible, setVisible] = useState<CodexVisibleModel[] | null>(() =>
    isCodex ? peekCodexVisibleModels(visibleKey) : null
  )
  useEffect(() => {
    if (!isCodex) {
      setVisible(null)
      return
    }
    setVisible(peekCodexVisibleModels(visibleKey))
    void hydrateCodexVisibleModels(visibleKey)
    return subscribeCodexVisibleModels(() => setVisible(peekCodexVisibleModels(visibleKey)))
  }, [isCodex, visibleKey])

  const discoveredModels = useMemo(() => {
    if (!visible || visible.length === 0) {
      // Why not the probe list meanwhile: it carries hidden models (GPT-Reserve,
      // the review model) that the picker never offers, so it flashed a wrong
      // list that then rewrote itself. The sheet shows a reader until this lands.
      return null
    }
    const probed = new Map((discovered ?? []).map((model) => [model.id, model]))
    const merged: DiscoveredCodexModel[] = visible.map((row) => {
      const known = probed.get(row.slug)
      return {
        id: row.slug,
        label: known?.label ?? row.slug,
        ...(row.description ? { description: row.description } : {}),
        levels: known?.levels ?? [],
        defaultLevel: known?.defaultLevel ?? null,
        isDefault: row.isDefault
      }
    })
    return discoveredCodexCatalogModels(merged)
  }, [discovered, visible])

  // Why: the pill fills from the terminal footer; re-read it once the list is
  // known so a cleared stale model is replaced without waiting for the poll.
  useEffect(() => {
    if (discoveredModels) {
      void refreshHud()
    }
  }, [discoveredModels, refreshHud])

  const applyOverride = useCallback(
    async (
      id: string,
      value: SessionOptionValue,
      report?: PickFailureReport
    ): Promise<boolean | null> => {
      // The open drawer's own reporter when the pick came from it; see PickFailureReport.
      const say = report ?? onFailure
      const handle = handleRef.current
      if (!client || !handle || typeof value !== 'string') {
        say(CODEX_UNREACHABLE)
        return false
      }
      // A rejected RPC throws out of the driver, and it used to go on past the
      // picker, which then said nothing at all (2026-09-25). What it means turns
      // on whether a key had gone out: before one, nothing on the desktop moved.
      let keysSent = false
      const driver = createCodexPickerIo({
        client,
        terminal: handle,
        deviceToken: deviceTokenRef.current
      })
      const io: CodexPickerIo = {
        ...driver,
        sendKey: (text) => {
          keysSent = true
          return driver.sendKey(text)
        },
        typeCommand: (command) => {
          keysSent = true
          return driver.typeCommand(command)
        }
      }
      let target
      if (id === 'model') {
        target = { model: value, effort: null }
      } else if (id === 'effort') {
        const model = currentModelId()
        if (!model) {
          say('Pick a model first')
          return false
        }
        const level = discovered
          ?.find((candidate) => candidate.id === model)
          ?.levels.find((candidate) => candidate.id === value)
        target = { model, effort: level ?? { id: value, label: value } }
      } else {
        return null
      }
      const result = await withCodexTerminalLock(handle, () =>
        applyCodexPickerSelection(io, target)
      ).catch(() => null)
      void refreshHud()
      if (result === null) {
        say(keysSent ? CODEX_PICK_UNCONFIRMED : CODEX_UNREACHABLE)
        return false
      }
      if (result.ok) {
        return true
      }
      say(
        result.reason === 'busy'
          ? 'Respond to the active Codex approval first'
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
    modelsPending: isCodex && discoveredModels === null,
    discoveredModelApply: discoveredModels ? CODEX_DISCOVERED_MODEL_APPLY : null,
    applyOverride: isCodex ? applyOverride : undefined
  }
}
