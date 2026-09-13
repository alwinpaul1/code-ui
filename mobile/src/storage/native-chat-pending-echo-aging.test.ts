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

// 2026-09-13: witnessed echoes written before the generation mark could carry
// a wrong anchor (an old prompt held on the first reading and anchored to the
// tail of that moment). An envelope without the mark sheds them once; the
// phone's own sends in the same envelope are untouched.
it('sheds witnessed echoes from an envelope written before the witnessed generation', async () => {
  const now = 1_000_000
  store.set(
    'orca:chatPendingEchoes:s1',
    JSON.stringify({
      savedAt: now,
      pending: [echo('pending-1'), echo('absorbed-abc-5'), echo('desk-77')],
      createdAt: { 'pending-1': now, 'absorbed-abc-5': now, 'desk-77': now }
    })
  )
  const read = await readNativeChatPendingEchoes('s1', now + 1000)
  expect(read?.map((item) => item.id)).toEqual(['pending-1'])
  // Written back by this build, they are kept.
  await writeNativeChatPendingEchoes('s1', [echo('pending-1'), echo('absorbed-abc-5')], now + 2000)
  const again = await readNativeChatPendingEchoes('s1', now + 3000)
  expect(again?.map((item) => item.id)).toEqual(['pending-1', 'absorbed-abc-5'])
})
