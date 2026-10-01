import { describe, expect, it } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { CRON_CREATE_INPUT, TICK_PROMPT } from './fixtures/claude-scheduled-tick-2.1.286'
import { MOBILE_CUT } from './mobile-native-chat-edit-wire-cut'
import { withoutScheduledTicks } from './scheduled-prompt-ticks'

// A loop's tick reached the phone as a desk prompt (Orca's `agentStatus.prompt`,
// or the prompt hook's beacon copy) and drew as a user bubble every three
// minutes; the Claude app draws none (2026-10-01). The fixture says what was
// read from the real records.

const call = (name: string, input: unknown, id = 'm-call'): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'tool-call', name, input }],
  timestamp: 0,
  source: 'transcript'
})
const typed = (text: string, id = 'm-typed'): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text }],
  timestamp: 0,
  source: 'transcript'
})
/** Orca's status copy: folded to one line and cut at 200, marked cut. */
const statusCopy = (text: string): DesktopPrompt => ({
  nonce: 'status:tab:1:0',
  text: normalizePromptField(text),
  ...(text.length > 199 ? { cut: true } : {})
})
const beaconCopy = (text: string, cut = false): DesktopPrompt => ({ nonce: '41', text, ...(cut ? { cut: true } : {}) })
const kept = (prompts: DesktopPrompt[], messages: NativeChatMessage[]) =>
  withoutScheduledTicks(prompts, messages).map((prompt) => prompt.text)

describe('a loop tick reported as a desk prompt', () => {
  const cron = call('CronCreate', CRON_CREATE_INPUT)

  it('is no bubble when the status carries it cut at 200', () => {
    expect(TICK_PROMPT.length).toBeGreaterThan(1500)
    expect(kept([statusCopy(TICK_PROMPT)], [cron])).toEqual([])
  })

  it('is no bubble when the prompt hook carries it whole, or cut at its own length', () => {
    expect(kept([beaconCopy(TICK_PROMPT)], [cron])).toEqual([])
    expect(kept([beaconCopy(TICK_PROMPT.slice(0, 1200), true)], [cron])).toEqual([])
  })

  it('is no bubble when the wire cut the CronCreate prompt short', () => {
    const cutCall = call('CronCreate', { ...CRON_CREATE_INPUT, prompt: `${TICK_PROMPT.slice(0, 900)}${MOBILE_CUT}` })
    expect(kept([beaconCopy(TICK_PROMPT)], [cutCall])).toEqual([])
    expect(kept([statusCopy(TICK_PROMPT)], [cutCall])).toEqual([])
  })

  it('is no bubble for a dynamic loop’s ScheduleWakeup prompt either', () => {
    const wake = call('ScheduleWakeup', { delaySeconds: 1200, prompt: 'check the deploy', reason: 'watching CI' })
    expect(kept([statusCopy('check the deploy')], [wake])).toEqual([])
  })

  it('keeps every other desk prompt, in order', () => {
    const other = statusCopy('Now look at the logs')
    const result = withoutScheduledTicks([other, statusCopy(TICK_PROMPT), beaconCopy('and fix it')], [cron])
    expect(result.map((prompt) => prompt.text)).toEqual(['Now look at the logs', 'and fix it'])
  })

  it('keeps a typed prompt that starts with the loop’s words and goes on', () => {
    expect(kept([beaconCopy(`${TICK_PROMPT}\n\nAlso cancel the queue now.`)], [cron])).toHaveLength(1)
  })

  it('keeps a short typed prompt that a loop’s words merely start with', () => {
    expect(kept([beaconCopy('READ-ONLY WATCH of the build host')], [cron])).toHaveLength(1)
  })

  it('keeps prompts on a Codex tab, which schedules no prompts', () => {
    const codexRun = call('exec', { cmd: ['bash', '-lc', 'ls'] })
    expect(kept([statusCopy('ls the folder')], [codexRun, typed('ls the folder')])).toEqual(['ls the folder'])
  })

  describe('at the degenerate sizes', () => {
    it('hands back the same list when nothing is scheduled', () => {
      const prompts = [statusCopy('a'), beaconCopy('b')]
      expect(withoutScheduledTicks(prompts, [typed('a')])).toBe(prompts)
      expect(withoutScheduledTicks([], [cron])).toEqual([])
    })

    it('schedules nothing from an empty, missing or dropped prompt', () => {
      const empties = [
        call('CronCreate', { cron: '* * * * *', prompt: '' }),
        call('CronCreate', { cron: '* * * * *' }),
        call('CronCreate', { cron: '* * * * *', prompt: MOBILE_CUT }),
        call('CronCreate', 'not an object')
      ]
      expect(kept([statusCopy('anything'), beaconCopy('')], empties)).toEqual(['anything', ''])
    })
  })
})
