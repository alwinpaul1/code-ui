import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_COPY_MAX_CHARS, useMobileNativeChatMessageCopy } from './use-mobile-native-chat-message-copy'

// The Claude app (1.261009.20) clips what it copies to 100000 characters
// (qv7.a, `eek.d0(100000, str)`), never between the halves of a surrogate
// pair, and tells the reader "Copied (Truncated)". A reply long enough to pass
// that went to the pasteboard whole here, which the system can refuse
// (TransactionTooLargeException), so the whole Copy failed.

vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 34 } }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))

import * as Clipboard from 'expo-clipboard'

let renderer: ReactTestRenderer | null = null
let copy: (text: string) => void = () => {}

function Probe(): ReactNode {
  copy = useMobileNativeChatMessageCopy(2_000).copy
  return null
}

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  act(() => {
    renderer = create(<Probe />)
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const written = (): string => vi.mocked(Clipboard.setStringAsync).mock.calls[0]![0]

describe('a reply too long for the clipboard', () => {
  it('is clipped to the Claude app\'s 100000 characters', async () => {
    await act(async () => copy('a'.repeat(100_001)))
    expect(MESSAGE_COPY_MAX_CHARS).toBe(100_000)
    expect(written()).toHaveLength(100_000)
  })

  it('is left whole at exactly the limit, and when empty', async () => {
    await act(async () => copy('b'.repeat(100_000)))
    expect(written()).toHaveLength(100_000)
    vi.mocked(Clipboard.setStringAsync).mockClear()
    await act(async () => copy(''))
    expect(written()).toBe('')
  })

  it('never cuts an emoji in half at the limit', async () => {
    // Character 100000 would be the lead half of a pair.
    await act(async () => copy('c'.repeat(99_999) + '😀' + 'd'))
    expect(written()).toBe('c'.repeat(99_999))
  })
})
