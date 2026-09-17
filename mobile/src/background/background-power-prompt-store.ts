// The battery-exemption prompt asks from a launch effect, outside the React
// tree, so it cannot render itself. It raises a flag here and one mounted
// component watches it, the same shape `image-preview-store.ts` uses.
//
// Why not `Alert.alert`: the native dialog is styled by Android, not by the app,
// so it arrives in the system's colours whatever theme the reader has chosen.
import { useSyncExternalStore } from 'react'

export type BackgroundPowerPromptKind = 'ask' | 'not-taken'

let open: BackgroundPowerPromptKind | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openBackgroundPowerPrompt(kind: BackgroundPowerPromptKind = 'ask'): void {
  if (open === kind) {
    return
  }
  open = kind
  emit()
}

export function closeBackgroundPowerPrompt(): void {
  if (open === null) {
    return
  }
  open = null
  emit()
}

export function resetBackgroundPowerPromptForTests(): void {
  open = null
  listeners.clear()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Which prompt is showing, or null. Two kinds, because "we are asking" and
 *  "that did not work" are different messages and one must not be mistaken for
 *  the other — repeating the ask reads as the app not having noticed. */
export function useBackgroundPowerPromptOpen(): BackgroundPowerPromptKind | null {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null
  )
}
