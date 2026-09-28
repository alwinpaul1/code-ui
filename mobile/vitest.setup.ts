import { beforeEach, vi } from 'vitest'

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

// Why: the chat list reads its screen's navigation focus through expo-router's
// useFocusEffect (use-native-chat-screen-focus.ts), and expo-router has no Node
// entry: every test that draws the chat would fail at import. Stubbed, the list
// hears no focus report, so its running rows keep sweeping and nothing moves
// the list on a focus, which is the hook's fail-open answer. Its own test
// and MobileNativeChatView-covered.test.ts unmock it; a local mock takes priority.
vi.mock('./src/session/use-native-chat-screen-focus', () => ({
  useNativeChatScreenFocus: () => undefined
}))

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

// Why: the session a chat tab keeps over a nested agent's status, and each
// session's turn, live in a module-level store that outlives a mount on
// purpose (native-chat-kept-session.ts). Test cases reuse one host and tab id
// across sessions, so a case read the session an earlier case kept: shuffled,
// use-mobile-native-chat-controller.test.ts failed two cases (review of
// b97b00d6). Reset before every case. Imported, not held: after a
// vi.resetModules this is the instance the case itself loads, and the state
// module carries no import heavier than the storage the mock above serves.
beforeEach(async () => {
  const { resetNativeChatKeptSessionsForTests } = await import('./src/session/native-chat-kept-session-state')
  resetNativeChatKeptSessionsForTests()
})
