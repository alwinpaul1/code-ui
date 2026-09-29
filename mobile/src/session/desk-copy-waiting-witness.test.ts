// Review of fe1c055a (2026-09-29): a desk copy still waiting for its named
// row was no longer kept by the witness memory, so that it could still move
// when the row loaded. That lost two things main had. A relaunch after the
// wait stalled (the tab left, the app killed) restored the copy with nothing
// stored, found it long after it arrived and hid it. And a phone send of the
// same words took the waiting desk copy as its own, because only a stored copy
// is protected from that, so the desk's message was hidden and the phone's
// drew twice. The copy is stored again from its first render, and gives way to
// its own hook copy only while this run's chat is placing that copy.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const T = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)
const row = (id: string, clock: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text: id }], timestamp: T(clock), source: 'transcript' })
type Hook = (prompts: readonly DesktopPrompt[], folded: readonly NativeChatMessage[], raw?: readonly NativeChatMessage[], hasEarlier?: boolean, readSettled?: boolean) => MobileNativeChatPendingMessage[]
let latest: MobileNativeChatPendingMessage[] = []
function Probe({ hook, prompts, raw }: { hook: Hook; prompts: readonly DesktopPrompt[]; raw: readonly NativeChatMessage[] }) {
  latest = hook(prompts, raw, raw, false, true)
  return null
}

describe('a desk copy the chat drew while it waited for its row', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('is still drawn after the app is killed and opened again eleven minutes on', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:36:35.000'))
    const { witnessesToRemember } = await import('./mobile-native-chat-witness-memory')
    const first = await import('./use-desktop-prompt-echoes')
    const rows = [row('r1', '05:36:10.000'), row('r2', '05:36:20.000')]
    // A tab launched before `ts=`: no time, and a row the chat never holds.
    const copy: DesktopPrompt[] = [{ nonce: '76101', text: 'typed at the desk', anchorId: 'never-held', seenAt: Date.now() }]
    // The overlay's effect: every witness it is handed, first write wins.
    const stored = new Map<string, string>()
    const remember = () => {
      for (const witness of witnessesToRemember(latest)) {
        if (!stored.has(witness.id)) {
          stored.set(witness.id, witness.anchorId)
        }
      }
    }
    act(() => {
      renderer = create(createElement(Probe, { hook: first.useDesktopPromptEchoes, prompts: copy, raw: rows }))
    })
    remember()
    for (let reading = 0; reading < 3; reading += 1) {
      act(() => renderer!.update(createElement(Probe, { hook: first.useDesktopPromptEchoes, prompts: copy, raw: rows })))
      remember()
    }
    expect(latest).toHaveLength(1)
    act(() => renderer?.unmount())
    renderer = null
    // Killed in the background and opened again: the module maps are gone,
    // and the warm start restores the copy, found long after it arrived.
    vi.resetModules()
    vi.setSystemTime(T('05:47:35.000'))
    const second = await import('./use-desktop-prompt-echoes')
    act(() => {
      renderer = create(createElement(Probe, { hook: second.useDesktopPromptEchoes, prompts: copy, raw: rows }))
    })
    // Drawn by its stored place, where the chat first drew it.
    expect(stored.get('desk-76101')).toBe('r2')
  })

  it('is not taken by a phone send of the same words while it waits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:36:35.000'))
    const { witnessesToRemember } = await import('./mobile-native-chat-witness-memory')
    const echoes = await import('./use-desktop-prompt-echoes')
    const { pairPendingWithHookPrompts } = await import('./desktop-prompt-own-sends')
    const rows = [row('r1', '05:36:10.000'), row('r2', '05:36:20.000')]
    const desk: DesktopPrompt = { nonce: '77101', text: 'yes', anchorId: 'never-held', seenAt: Date.now() }
    act(() => {
      renderer = create(createElement(Probe, { hook: echoes.useDesktopPromptEchoes, prompts: [desk], raw: rows }))
    })
    act(() => renderer!.update(createElement(Probe, { hook: echoes.useDesktopPromptEchoes, prompts: [desk], raw: rows })))
    const stored = witnessesToRemember(latest).map((witness) => ({
      id: witness.id,
      text: witness.text,
      baselineTailMessageId: witness.anchorId,
      witnessedAt: Date.now()
    }))
    // "yes" sent from the phone a quarter of a minute later, and its own copy.
    vi.setSystemTime(T('05:36:50.000'))
    const send = { id: 'send-1', text: 'yes', sentAt: Date.now() }
    const own: DesktopPrompt = { nonce: '77102', text: 'yes', anchorId: 'r2', seenAt: Date.now() + 500 }
    const pairing = pairPendingWithHookPrompts([send, ...stored], [desk, own], rows)
    // The phone send claims its own copy; the desk's message stays drawn,
    // by its hook copy or by its stored place.
    expect(pairing.standIns.has(own.nonce)).toBe(true)
    const deskDrawn = !pairing.standIns.has(desk.nonce) || stored.some((witness) => witness.id === 'desk-77101' && !pairing.steppedAside.has(witness.id))
    expect(deskDrawn).toBe(true)
  })
})
