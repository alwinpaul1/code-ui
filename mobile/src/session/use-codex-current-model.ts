// The Codex model the phone shows, read without the terminal status line.
//
// Codex's footer ("gpt-6-astra medium · ~/dir") is the only place the model
// appears on screen, and a fresh chat has not drawn it yet — so the pill sat
// empty and printed a "no status-line badge" hint. Codex's own `/model` picker
// marks the running model `(current)`, which the phone already reads on open
// (codex-visible-models.ts) and persists per host+worktree, so the last known
// model is there instantly on a cold start. That marker is the source here.
import { useEffect, useState } from 'react'
import {
  codexVisibleModelsKey,
  hydrateCodexVisibleModels,
  peekCodexVisibleModels,
  subscribeCodexVisibleModels
} from './codex-visible-models'

function readCurrent(key: string): string | null {
  return peekCodexVisibleModels(key)?.find((model) => model.isCurrent)?.slug ?? null
}

export function useCodexCurrentModel(
  agent: string | null,
  hostId: string,
  worktreeId: string
): string | null {
  const isCodex = agent === 'codex'
  const key = codexVisibleModelsKey(hostId, worktreeId)
  const [current, setCurrent] = useState<string | null>(() => (isCodex ? readCurrent(key) : null))
  useEffect(() => {
    if (!isCodex) {
      setCurrent(null)
      return
    }
    setCurrent(readCurrent(key))
    void hydrateCodexVisibleModels(key)
    return subscribeCodexVisibleModels(() => setCurrent(readCurrent(key)))
  }, [isCodex, key])
  return current
}
