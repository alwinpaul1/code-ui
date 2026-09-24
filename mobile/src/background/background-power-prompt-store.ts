// The battery-exemption prompt asks from a launch effect, outside the React
// tree, so it cannot render itself. It raises a flag here and one mounted
// component watches it, the same shape `image-preview-store.ts` uses.
//
// Why not `Alert.alert`: the native dialog is styled by Android, not by the app,
// so it arrives in the system's colours whatever theme the reader has chosen.
import { useSyncExternalStore } from 'react'

export type BackgroundPowerPromptKind = 'ask' | 'not-taken' | 'paused'

let open: BackgroundPowerPromptKind | null = null
/** How long Android paused the app, for the 'paused' message. */
let pausedForMs = 0

/** How long the pause the 'paused' prompt reports lasted. */
export function backgroundPowerPromptPausedMs(): number {
  return pausedForMs
}
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openBackgroundPowerPrompt(kind: BackgroundPowerPromptKind = 'ask', pausedMs = 0): void {
  if (open === kind) {
    return
  }
  open = kind
  pausedForMs = pausedMs
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

/** Which prompt is showing, or null. Separate kinds, because "we are asking",
 *  "that did not work" and "Android just paused the app" are different messages
 *  and one must not be mistaken for another; repeating the ask reads as the app
 *  not having noticed. */
export function useBackgroundPowerPromptOpen(): BackgroundPowerPromptKind | null {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null
  )
}
