// Why: expo-file-system's entry builds its native bindings at import (expo-modules-core reads
// globalThis.expo.EventEmitter), which Node does not have. The media player's cache sink
// (mobile-media-preview-cache.ts) imports it, and every file-preview and file-reader test reaches
// that sink through the preview body, so none of them could load. This stand-in has the names the
// product imports and does nothing. A test that needs to see file calls mocks 'expo-file-system'
// itself, which wins over this alias.
export class File {
  uri = 'file:///cache/stand-in'
  exists = false
  create(): void {}
  open(): never {
    throw new Error('expo-file-system is not available under Vitest')
  }
  delete(): void {}
}
export const Paths = { cache: 'file:///cache/' }
export type FileHandle = { writeBytes(bytes: Uint8Array): void; close(): void }
