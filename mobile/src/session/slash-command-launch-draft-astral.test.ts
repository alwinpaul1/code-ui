import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { typeMobileNativeChatCommandWithOutcome } from './mobile-native-chat-send'

// A typed slash command never told the host its parked launch draft was used
// when the command held an astral character ('/goal 🚀', an emoji in a skill
// argument). The shared typeAgentTuiCommand types `...command`, one key per
// code point, while the phone picked the Enter write by `command.length + 1`,
// UTF-16 units: an emoji is one key but two units, so no write matched and
// resolvedLaunchDraft rode none of them (review, 2026-09-30).

afterEach(() => vi.useRealTimers())

type Sent = { text: string; resolvedLaunchDraft?: { text: string; createdAt: number } }

const ACCEPTED = { id: 'request', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'runtime' } }
const REJECTED = { id: 'request', ok: true, result: { send: { accepted: false } }, _meta: { runtimeId: 'runtime' } }

async function typeCommand(command: string, responses: unknown[] = []): Promise<{ outcome: string; sent: Sent[] }> {
  vi.useFakeTimers()
  const sendRequest = vi.fn()
  for (const response of responses) {
    sendRequest.mockResolvedValueOnce(response)
  }
  sendRequest.mockResolvedValue(ACCEPTED)
  const client = { sendRequest } as unknown as RpcClient
  const result = typeMobileNativeChatCommandWithOutcome({
    client,
    terminal: 't',
    command,
    resolvedLaunchDraft: { text: 's', createdAt: 1 }
  })
  await vi.runAllTimersAsync()
  const outcome = await result
  return { outcome, sent: sendRequest.mock.calls.map((call) => call[1] as Sent) }
}

const carryingDraft = (sent: Sent[]): Sent[] => sent.filter((write) => write.resolvedLaunchDraft !== undefined)

describe('a typed slash command hands the host its launch draft on the Enter write', () => {
  it.each(['/goal 🚀', '/goal 👩‍💻 ship it', '/skill 𝒳'])(
    'sends the launch draft exactly once, with the Enter, for %s',
    async (command) => {
      const { outcome, sent } = await typeCommand(command)
      expect(outcome).toBe('accepted')
      expect(carryingDraft(sent)).toHaveLength(1)
      expect(carryingDraft(sent)[0]).toMatchObject({ text: '\r', resolvedLaunchDraft: { text: 's', createdAt: 1 } })
      expect(sent.at(-1)?.text).toBe('\r')
    }
  )

  it('still does for a command of plain characters', async () => {
    const { sent } = await typeCommand('/goal go')
    expect(carryingDraft(sent).map((write) => write.text)).toEqual(['\r'])
  })

  it('does for the degenerate commands: one character, and none', async () => {
    expect(carryingDraft((await typeCommand('/')).sent).map((write) => write.text)).toEqual(['\r'])
    expect(carryingDraft((await typeCommand('')).sent).map((write) => write.text)).toEqual(['\r'])
  })

  it('sends the draft on no write when typing stops before the Enter', async () => {
    // The clear, "/", then the emoji is refused: nothing after it is typed.
    const { outcome, sent } = await typeCommand('/🚀', [ACCEPTED, ACCEPTED, REJECTED])
    expect(outcome).toBe('rejected')
    expect(sent.map((write) => write.text)).toEqual(['\x15', '/', '🚀'])
    expect(carryingDraft(sent)).toEqual([])
  })
})
