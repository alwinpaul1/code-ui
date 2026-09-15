// The battery-exemption prompt asks from a launch effect, outside the React
// tree, so it cannot render itself. It raises a flag here and one mounted
// component watches it, the same shape `image-preview-store.ts` uses.
//
// Why not `Alert.alert`: the native dialog is styled by Android, not by the app,
// so it arrives in the system's colours whatever theme the reader has chosen.
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openBackgroundPowerPrompt(): void {
  if (open) {
    return
  }
  open = true
  emit()
}

export function closeBackgroundPowerPrompt(): void {
  if (!open) {
    return
  }
  open = false
  emit()
}

export function resetBackgroundPowerPromptForTests(): void {
  open = false
  listeners.clear()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBackgroundPowerPromptOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false
  )
}
