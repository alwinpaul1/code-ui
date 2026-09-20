// Why: expo-image-manipulator's entry pulls React Native's Flow-typed internals,
// which Node cannot parse. Tests that reach it (through the photo resizer the
// composer's picker is handed) get a manipulator that hands the file back
// unchanged; the resizer's own behaviour is pinned through the injected
// `resizeImage` in mobile-image-source-picker.test.ts.
export const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const

type Rendered = {
  saveAsync: (options?: unknown) => Promise<{ uri: string; width: number; height: number; base64?: string }>
  release: () => void
}

export const ImageManipulator = {
  manipulate(uri: string) {
    return {
      resize: () => undefined,
      renderAsync: async (): Promise<Rendered> => ({
        saveAsync: async () => ({ uri, width: 0, height: 0 }),
        release: () => undefined
      }),
      release: () => undefined
    }
  }
}
