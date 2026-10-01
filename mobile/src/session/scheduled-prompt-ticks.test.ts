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

  // The prompt hook marks a tick it saw the loop fire (`sc=1`,
  // agent-hud-prompt-hook-scheduled.test.ts): dropped with no CronCreate in
  // view, a loop set up on a page the chat never loaded.
  it('is no bubble when the hook marked it, with no loop call loaded', () => {
    const marked: DesktopPrompt = { ...statusCopy(TICK_PROMPT), scheduled: true }
    expect(kept([marked, statusCopy('Now look at the logs')], [typed('earlier')])).toEqual(['Now look at the logs'])
    expect(kept([marked], [])).toEqual([])
  })

  // A sentinel loop stores `<<autonomous-loop>>` and its kin as its prompt;
  // Claude Code resolves it into other words when the tick fires (2.1.286,
  // resolveLoopDefaultFire), and the desk copy carries those words.
  describe('a sentinel loop’s tick, whose words are not the call’s', () => {
    const sentinelCall = (prompt: string) => call('CronCreate', { cron: '*/5 * * * *', recurring: true, prompt })
    const autonomous = '# Autonomous loop tick\nRun the autonomous check and report in one line.'
    const dynamic = '# Autonomous loop tick (dynamic pacing)\nRun the check, then pick the next delay.'
    const firstDelivery = '# Autonomous loop check\nYou are in a loop. Each tick runs the check below.'
    const loopMd = '# /loop tick — loop.md tasks\nWork through the tasks below and report.'
    const configured = 'The user configured a loop-tasks file. Work through the tasks defined below.'

    it('drops a resolved autonomous tick when a sentinel CronCreate is loaded', () => {
      const loaded = [sentinelCall('<<autonomous-loop>>')]
      expect(kept([statusCopy(autonomous)], loaded)).toEqual([])
      expect(kept([beaconCopy(autonomous)], loaded)).toEqual([])
      expect(kept([statusCopy(firstDelivery)], loaded)).toEqual([])
    })

    it('drops the dynamic pacing tick, and the loop.md ones, for their own sentinels', () => {
      expect(kept([beaconCopy(dynamic)], [sentinelCall('<<autonomous-loop-dynamic>>')])).toEqual([])
      expect(kept([beaconCopy(loopMd)], [sentinelCall('<<loop.md>>')])).toEqual([])
      expect(kept([beaconCopy(configured)], [sentinelCall('<<loop.md-dynamic>>')])).toEqual([])
    })

    it('keeps a typed “# Autonomous loop tick” when no sentinel loop is known', () => {
      expect(kept([beaconCopy(autonomous)], [])).toHaveLength(1)
      expect(kept([beaconCopy(autonomous)], [typed('earlier')])).toHaveLength(1)
      expect(kept([beaconCopy(autonomous)], [cron])).toHaveLength(1)
    })

    it('keeps an autonomous tick’s words when the only sentinel loop is a loop.md one', () => {
      expect(kept([beaconCopy(autonomous)], [sentinelCall('<<loop.md>>')])).toHaveLength(1)
      expect(kept([beaconCopy(loopMd)], [sentinelCall('<<autonomous-loop>>')])).toHaveLength(1)
    })

    it('keeps other prompts beside a sentinel loop, and does not take its call’s own words for a tick', () => {
      const loaded = [sentinelCall('<<autonomous-loop>>')]
      expect(kept([statusCopy('Now look at the logs')], loaded)).toEqual(['Now look at the logs'])
      expect(kept([beaconCopy('# Autonomous')], loaded)).toHaveLength(1)
    })

    it('keeps the words on a Codex tab, whose rows hold no CronCreate', () => {
      expect(kept([beaconCopy(autonomous)], [call('exec_command', { cmd: 'ls' }), typed('ls')])).toHaveLength(1)
    })
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
