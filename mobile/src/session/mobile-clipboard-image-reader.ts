import * as Clipboard from 'expo-clipboard'
import type { ClipboardImageReader } from './mobile-image-source-picker'

/**
 * The system clipboard as an image source.
 *
 * Kept out of `mobile-image-source-picker.ts` on purpose: `expo-clipboard`
 * pulls in React Native's Flow-typed entry, which that module's tests cannot
 * parse, so the picker takes this as an injected dependency instead.
 */
export const readSystemClipboardImage: ClipboardImageReader = async () => {
  if (!(await Clipboard.hasImageAsync().catch(() => false))) {
    return null
  }
  return Clipboard.getImageAsync({ format: 'png' }).catch(() => null)
}

/** Whether the clipboard is holding an image right now, for showing the row. */
export async function clipboardHasImage(): Promise<boolean> {
  return Clipboard.hasImageAsync().catch(() => false)
}
