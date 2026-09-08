import { beforeEach, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      store.delete(key)
    }
  }
}))

import {
  PENDING_ECHO_MAX_AGE_MS,
  readNativeChatPendingEchoes,
  resetNativeChatPendingEchoClocksForTests,
  writeNativeChatPendingEchoes
} from './native-chat-pending-echoes'

const echo = (id: string, images?: string[]) => ({
  id,
  text: 'queued while busy',
  expectedOccurrence: 1,
  baselineTailMessageId: null,
  baselineResolved: true,
  ...(images ? { images } : {})
})

beforeEach(() => {
  store.clear()
  resetNativeChatPendingEchoClocksForTests()
})

it('retires an echo a day after it was queued, not a day after the last app open', async () => {
  // `savedAt` was re-stamped on every write and hydration itself writes, so the
  // 24 h clock restarted every time the session was opened. A message the agent
  // consumed without leaving a transcript row could never expire: it sat pinned
  // at the top of the chat across every restart.
  const born = 1_000_000
  await writeNativeChatPendingEchoes('s', [echo('a')], born)
  // Re-saved the next morning, as opening the session does.
  const nextDay = born + PENDING_ECHO_MAX_AGE_MS / 2
  await writeNativeChatPendingEchoes('s', [echo('a')], nextDay)
  const afterExpiry = born + PENDING_ECHO_MAX_AGE_MS + 1
  expect(await readNativeChatPendingEchoes('s', afterExpiry)).toBeNull()
})

it('keeps an echo that is still inside its own day', async () => {
  const born = 1_000_000
  await writeNativeChatPendingEchoes('s', [echo('a')], born)
  const read = await readNativeChatPendingEchoes('s', born + PENDING_ECHO_MAX_AGE_MS - 1)
  expect(read?.map((item) => item.id)).toEqual(['a'])
})

it('never writes a pasted screenshot into storage', async () => {
  // A clipboard paste carries a multi-megabyte data: URI. The read side already
  // dropped it, but writing it first stringifies megabytes and can silently
  // lose the whole row to AsyncStorage's cap.
  const dataUri = `data:image/png;base64,${'A'.repeat(4096)}`
  await writeNativeChatPendingEchoes('s', [echo('a', [dataUri, 'file:///photo.jpg'])], 1_000)
  const raw = [...store.values()].join('')
  expect(raw).not.toContain('data:image/png')
  expect(raw).toContain('file:///photo.jpg')
})
