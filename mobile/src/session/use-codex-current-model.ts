// The Codex model the phone shows, read without the terminal status line.
//
// Two zero-setup sources, both from Orca itself:
//  1. Orca installs a Codex hook on every desktop (hooks.json in the Codex
//     runtime home) and its Stop payload names the model, so the host's
//     agent-status carries `model` after each turn. Guarded: the host has been
//     seen labelling a Codex pane with a Claude id, which must never reach
//     the pill.
//  2. Codex's own `/model` picker marks the running model `(current)`; the
//     phone reads it on open (codex-visible-models.ts) and persists it per
//     host+worktree, so a cold start shows the last known model at once.
// The footer ("gpt-6-astra medium · ~/dir") stays only as a fresher override
// once a turn has drawn it.
import { useEffect, useState } from 'react'
import {
  codexVisibleModelsKey,
  hydrateCodexVisibleModels,
  peekCodexVisibleModels,
  subscribeCodexVisibleModels
} from './codex-visible-models'
import { peekDiscoveredCodexModels } from './codex-model-discovery'

/** OpenAI's model ids as Codex names them (gpt-6-astra, gpt-5.3-codex-spark,
 *  o4-mini…). The fallback for the moment before the account list is known:
 *  any Claude id (fable, opus, sonnet, haiku, claude-…) fails this shape. */
const CODEX_ID_SHAPE = /^(gpt-|o\d|codex)/i

/** A reported model, if it is one this Codex account can run. Every source
 *  goes through this — the host's hook status and the terminal footer alike —
 *  because the host has labelled a Codex pane with a Claude session's model
 *  and a tab switch can read the other tab's screen. */
export function acceptCodexStatusModel(
  reported: string | null | undefined,
  known: readonly string[]
): string | null {
  const model = reported?.trim()
  if (!model) {
    return null
  }
  if (known.length > 0) {
    return known.includes(model) ? model : null
  }
  return CODEX_ID_SHAPE.test(model) ? model : null
}

function readPickerCurrent(key: string): string | null {
  return peekCodexVisibleModels(key)?.find((model) => model.isCurrent)?.slug ?? null
}

function readKnown(key: string, hostId: string, worktreeId: string): string[] {
  const visible = peekCodexVisibleModels(key)?.map((model) => model.slug) ?? []
  const discovered = peekDiscoveredCodexModels(hostId, worktreeId)?.map((model) => model.id) ?? []
  return [...new Set([...visible, ...discovered])]
}

export function useCodexCurrentModel(
  agent: string | null,
  hostId: string,
  worktreeId: string,
  /** `agentStatus.model` for the active tab, from Orca's Codex hook. */
  statusModel: string | null | undefined,
  /** What the terminal footer names, when a turn has drawn it. */
  hud: { modelId: string | null; effort: string | null } | null
): { model: string | null; effort: string | null } {
  const isCodex = agent === 'codex'
  const key = codexVisibleModelsKey(hostId, worktreeId)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isCodex) {
      return
    }
    void hydrateCodexVisibleModels(key)
    return subscribeCodexVisibleModels(() => setTick((value) => value + 1))
  }, [isCodex, key])
  if (!isCodex) {
    return { model: null, effort: null }
  }
  void tick
  const known = readKnown(key, hostId, worktreeId)
  const footerModel = acceptCodexStatusModel(hud?.modelId, known)
  if (footerModel) {
    return { model: footerModel, effort: hud?.effort ?? null }
  }
  return {
    model: acceptCodexStatusModel(statusModel, known) ?? readPickerCurrent(key),
    effort: null
  }
}
