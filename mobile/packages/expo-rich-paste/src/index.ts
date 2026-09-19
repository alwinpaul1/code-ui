import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

export type RichPasteImage = {
  viewTag: number
  /** A `file://` copy in the app cache; the IME's own URI is gone by now. */
  uri: string
  mimeType: string
}

type Subscription = { remove(): void }

type NativeRichPaste = {
  attach(viewTag: number): Promise<boolean>
  detach(viewTag: number): Promise<void>
  addListener(event: 'onImage', listener: (image: RichPasteImage) => void): Subscription
}

// Why optional: Android-only, and absent from the vitest runtime and any
// build that predates the module. Every entry point degrades to a no-op.
const native: NativeRichPaste | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeRichPaste>('RichPaste') : null

export const isRichPasteSupported = native !== null

/** Let the TextInput with this native tag receive images from the keyboard,
 *  the paste menu and drags. Resolves false when there is no such view yet,
 *  or the view is not an EditText; call again after the input mounts. Never
 *  rejects: the native side looks the view up on the UI thread and answers
 *  false for a tag it cannot find, instead of throwing the lookup's error
 *  into the caller's effect (device, 2026-09-19). */
export async function attachRichPaste(viewTag: number): Promise<boolean> {
  if (!native) {
    return false
  }
  try {
    return await native.attach(viewTag)
  } catch {
    return false
  }
}

export function detachRichPaste(viewTag: number): void {
  void native?.detach(viewTag).catch(() => undefined)
}

/** An image the user put into an attached input. */
export function addRichPasteImageListener(
  listener: (image: RichPasteImage) => void
): Subscription {
  return native?.addListener('onImage', listener) ?? { remove: () => undefined }
}
