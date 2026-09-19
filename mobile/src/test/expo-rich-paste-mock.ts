// Why: @codeui/expo-rich-paste reaches for `expo`'s native-module registry
// at import time, which the Node test runtime cannot load. Component tests
// get this no-op instead; use-rich-paste-input.test.ts mocks the real shape.
export const isRichPasteSupported = false
export function attachRichPaste(): boolean {
  return false
}
export function detachRichPaste(): void {}
export function addRichPasteImageListener(): { remove(): void } {
  return { remove: () => undefined }
}
