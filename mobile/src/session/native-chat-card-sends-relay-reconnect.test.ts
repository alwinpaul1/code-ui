import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
// The import inside the factory is forced: vi.mock is hoisted above every
// static import, so the factory cannot reach one.
vi.mock('../transport/mobile-relay-e2ee-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport/mobile-relay-e2ee-link')>()),
  MobileRelayE2eeLink: (await import('../transport/relay-desktop-fake-link')).FakeRelayLink
}))

import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import {
  fakeDesktop,
  fakeRelayLinks,
  resetFakeRelayLinks
} from '../transport/relay-desktop-fake-link'
import {
  acceptRelayDial,
  dropRelayLink,
  openRelayOnlyPhone,
  type RelayOnlyPhone
} from '../transport/relay-desktop-test-fakes'
import { useRelayChatTabGate } from '../test-support/relay-chat-tab-gate'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { useMobileNativeChatPermissionSend } from './mobile-native-chat-permission-send'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import { useMobileNativeChatCancelAsk } from './use-mobile-native-chat-cancel-ask'
import { useMobileNativeChatPlanFeedbackSend } from './use-mobile-native-chat-plan-feedback-send'

// The prompt cards of the 2026-09-25 report ("message not send disconnected"),
// tapped while the relay re-dials. Each refused at once with a bare
// "(disconnected)". None of them waits for the link as a composer send does:
// each types keys chosen against a screen the phone has not seen since the
// link dropped, and the HUD drops its screen reading with the link, so not
// even an approval can check the prompt is still up. They still refuse at
// once, but now say why.

// Claude Code's Bash approval, as the permission parser's own suite pins it.
const BASH_PROMPT_SCREEN = [
  'Bash command',
  ' echo first',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. No',
  'Esc to cancel · Tab to amend'
]
const TABS_OR_SPACES: AskPrompt = {
  questions: [
    { question: 'Tabs or spaces?', multiSelect: false, options: [{ label: 'Tabs' }, { label: 'Spaces' }] }
  ]
}

type Cards = {
  respond: (text: string) => Promise<boolean>
  answerAsk: ReturnType<typeof useMobileNativeChatAnswerSend>['answerAsk']
  cancelAsk: () => Promise<boolean>
  planFeedback: (send: string, comment: string) => Promise<boolean>
}

describe('a prompt card tapped while the relay re-dials', () => {
  let renderer: ReactTestRenderer | null = null
  let cards: Cards | null = null
  let gate: ReturnType<typeof useRelayChatTabGate> | null = null
  let phone: RelayOnlyPhone | null = null
  let screenCheckedCard = true
  const onSendError = vi.fn()
  const handleRef = { current: 'term' as string | null }
  const deviceTokenRef = { current: 'device-token' as string | null }

  function Probe({ client }: { client: RelayOnlyPhone['logical'] }): null {
    gate = useRelayChatTabGate(client, 'term')
    const enabled = gate.sendable
    const answer = useMobileNativeChatAnswerSend({
      client,
      enabled,
      handleRef,
      deviceTokenRef,
      agentRef: { current: 'claude' },
      sessionId: 'session',
      streamIdentity: 'host\0worktree\0tab\0session',
      onSendError
    })
    cards = {
      respond: useMobileNativeChatPermissionSend({
        client,
        enabled,
        handleRef,
        deviceTokenRef,
        onSendError,
        expectedTerminalAgent: 'claude',
        // A card the HUD read off the screen, or one from the transcript alone.
        expectedCodexPermission: screenCheckedCard
          ? claudePermissionFromScreen(BASH_PROMPT_SCREEN)
          : null
      }),
      answerAsk: answer.answerAsk,
      cancelAsk: useMobileNativeChatCancelAsk({
        client,
        enabled,
        handleRef,
        deviceTokenRef,
        cancelPending: answer.cancelPending,
        onSendError
      }),
      planFeedback: useMobileNativeChatPlanFeedbackSend({
        client,
        enabled,
        handleRef,
        deviceTokenRef,
        onSendError
      })
    }
    return null
  }

  async function until(check: () => boolean, stepMs = 10): Promise<void> {
    for (let step = 0; step < 500 && !check(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs)
      })
    }
    expect(check()).toBe(true)
  }

  /** A card tap inside act, handing back what it resolved to. */
  async function tap<T>(run: () => Promise<T>): Promise<T | null> {
    let result: T | null = null
    await act(async () => {
      result = await run()
    })
    return result
  }

  async function openConnectedChat(): Promise<RelayOnlyPhone> {
    const opened = openRelayOnlyPhone()
    await acceptRelayDial(opened, 0)
    await opened.started
    act(() => {
      renderer = create(createElement(Probe, { client: opened.logical }))
    })
    await until(() => gate?.sendable === true)
    return opened
  }

  async function desktopLegDrops(): Promise<void> {
    await act(async () => {
      dropRelayLink(fakeRelayLinks[0]!, 4408)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(gate?.sendable).toBe(false)
  }

  function terminalWrites(index: number): string[] {
    return fakeRelayLinks[index]!.sent('terminal.send').map((frame) =>
      String(frame.params?.text ?? '')
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
    fakeDesktop.screen = BASH_PROMPT_SCREEN
    screenCheckedCard = true
    handleRef.current = 'term'
    vi.clearAllMocks()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    cards = null
    gate = null
    phone?.supervisor.stop()
    phone?.logical.close()
    phone = null
    vi.useRealTimers()
  })

  it('refuses an approval at once, saying why, and types nothing once the link is back', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    let responded: boolean | null = null
    await act(async () => {
      responded = await cards!.respond('1')
    })
    expect(responded).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Response not sent: not connected to your desktop'
    )

    // The relay comes back: the refused digit is not typed after all.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => gate?.sendable === true)
    expect(terminalWrites(1)).toEqual([])
    expect(terminalWrites(0)).toEqual([])
  }, 30_000)

  it('refuses a card known only from the transcript at once, saying why, rather than type a digit blind', async () => {
    screenCheckedCard = false
    phone = await openConnectedChat()
    await desktopLegDrops()

    const responded = await tap(() => cards!.respond('1'))
    expect(responded).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Response not sent: not connected to your desktop'
    )
  }, 30_000)

  it('refuses an ask answer at once, saying why', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    const answered = await tap(() => cards!.answerAsk(TABS_OR_SPACES, [{ indices: [1] }]))
    expect(answered).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Answer not sent: not connected to your desktop'
    )
  }, 30_000)

  it('refuses an ask cancel at once, saying why', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    const cancelled = await tap(() => cards!.cancelAsk())
    expect(cancelled).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Cancel not sent: not connected to your desktop'
    )
  }, 30_000)

  it('refuses plan feedback at once, saying why', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    const sent = await tap(() => cards!.planFeedback('3', 'use the other file'))
    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Response not sent: not connected to your desktop'
    )
  }, 30_000)
})
