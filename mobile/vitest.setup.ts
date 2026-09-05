import { vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Why: expo-modules-core and reanimated read the RN global at import time.
Object.assign(globalThis, { __DEV__: true })

// Why: the theme provider and several stores persist through AsyncStorage,
// whose Node entry reaches for React Native's NativeEventEmitter. Component
// tests mock 'react-native' to a few host tags, so give every test an
// in-memory storage instead. A test that needs its own behaviour can still
// vi.mock the module locally; local mocks win over this one.
vi.mock('@react-native-async-storage/async-storage', () => {
  const memory = new Map<string, string>()
  const storage = {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: async (key: string) => {
      memory.delete(key)
    },
    multiGet: async (keys: string[]) => keys.map((key) => [key, memory.get(key) ?? null]),
    multiSet: async (pairs: [string, string][]) => {
      for (const [key, value] of pairs) {
        memory.set(key, value)
      }
    },
    multiRemove: async (keys: string[]) => {
      for (const key of keys) {
        memory.delete(key)
      }
    },
    getAllKeys: async () => [...memory.keys()],
    clear: async () => {
      memory.clear()
    }
  }
  return { default: storage, ...storage }
})

// Why: the shared press primitives (PressScale, Button, IconButton) call the
// haptics helpers, which import expo-haptics and through it expo-modules-core's
// EventEmitter — unavailable when 'react-native' is mocked to host tags. Tests
// exercising haptics themselves mock this module locally, which takes priority.
vi.mock('./src/platform/haptics', () => ({
  triggerMediumImpact: () => undefined,
  triggerSelection: () => undefined,
  triggerSuccess: () => undefined,
  triggerError: () => undefined,
  triggerEdgeBump: () => undefined
}))
