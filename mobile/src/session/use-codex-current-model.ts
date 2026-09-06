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

const CLAUDE_ID = /claude|opus|sonnet|haiku|fable/i

/** The hook-reported model, if it is one this Codex account can run. With no
 *  list known yet, anything that reads as a Claude id is refused. */
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
  return CLAUDE_ID.test(model) ? null : model
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
  statusModel: string | null | undefined
): string | null {
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
    return null
  }
  void tick
  return (
    acceptCodexStatusModel(statusModel, readKnown(key, hostId, worktreeId)) ??
    readPickerCurrent(key)
  )
}
