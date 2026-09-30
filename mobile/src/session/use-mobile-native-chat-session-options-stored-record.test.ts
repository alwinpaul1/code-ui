import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SessionOptionRecords from '../storage/session-option-records'
import {
  resetMobileNativeChatSessionOptionRecordsForTests,
  useMobileNativeChatSessionOptions
} from './use-mobile-native-chat-session-options'

// The read is the real one unless a test makes the restore fail. After the
// record checks in session-option-records.ts nothing known makes it fail; this
// drives the unknown one, which used to be an unhandled rejection with no line
// behind it (a half-written record threw out of the merge the same way).
const failure = vi.hoisted(() => ({ read: null as Error | null }))
vi.mock('../storage/session-option-records', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionOptionRecords>()
  return {
    ...actual,
    readSessionOptionRecord: (...args: Parameters<typeof actual.readSessionOptionRecord>) =>
      failure.read ? Promise.reject(failure.read) : actual.readSessionOptionRecord(...args)
  }
})

type HookArgs = Parameters<typeof useMobileNativeChatSessionOptions>[0]

const SCOPE = 'host\u0000worktree\u0000tab'

describe('a chat whose stored option picks cannot be restored', () => {
  let renderer: ReactTestRenderer | null = null

  function Probe({ args }: { args: HookArgs }): null {
    useMobileNativeChatSessionOptions(args)
    return null
  }

  async function mount(agent: string): Promise<void> {
    const args: HookArgs = {
      agent,
      scopeKey: SCOPE,
      reportedModel: null,
      dispatchCommand: vi.fn<HookArgs['dispatchCommand']>().mockResolvedValue('accepted'),
      onAgentPicker: vi.fn()
    }
    await act(async () => {
      renderer = create(createElement(Probe, { args }))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    resetMobileNativeChatSessionOptionRecordsForTests()
    failure.read = null
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    vi.mocked(console.warn).mockRestore()
  })

  // Only a tab that has no live record yet reads its stored picks
  // (use-mobile-native-chat-session-options.ts); an agent with no catalog is
  // one, since no snapshot makes a record for it.
  it('says which chat’s picks were not restored, and why, in one line', async () => {
    failure.read = new TypeError('Cannot convert undefined or null to object')
    await mount('amp')
    expect(console.warn).toHaveBeenCalledTimes(1)
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0])
    expect(line).toContain('worktree')
    expect(line).toContain('tab')
    expect(line).toContain('Cannot convert undefined or null to object')
  })

  it('logs nothing when the restore reads nothing', async () => {
    await mount('amp')
    expect(console.warn).not.toHaveBeenCalled()
  })
})
