import { useEffect, useMemo } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { MOBILE_CUT } from './mobile-native-chat-edit-wire-cut'
import { resolvesFromSentinel } from './scheduled-loop-sentinels'
import { cutWholeCharacters } from '../text/whole-character-cut'
import {
  rememberScheduledPrompts,
  rememberedScheduledPrompts,
  type RememberedScheduledPrompt
} from './scheduled-prompt-memory'

/**
 * A loop's tick is no message from a person, and draws no bubble.
 *
 * Claude Code fires a CronCreate job's prompt (and a dynamic loop's
 * ScheduleWakeup prompt) as a turn of its own: an `isMeta` user row with
 * `turnOrigin: 'scheduled'`, whose words are the tool's `prompt` byte for
 * byte (fixtures/claude-scheduled-tick-2.1.286.ts). Orca's decoder draws
 * nothing for it, as the Claude app draws nothing, but the UserPromptSubmit
 * hook fires for it with nothing that says it was scheduled, so Orca's
 * `agentStatus.prompt` and the prompt hook's beacon copy reported each tick
 * like a typed prompt, and the chat drew it as a user bubble every three
 * minutes (reported 2026-10-01).
 *
 * A copy the prompt hook marked (`scheduled`, `sc=1`) is a tick: the hook saw
 * the transcript's `scheduled_task_fire` row for these very words
 * (agent-hud-launch-args.ts). That covers tabs launched with the hook.
 *
 * Otherwise the phone knows a session's scheduled prompts from the tool calls
 * that set them up, which its transcript read does draw. A desk copy of one of those
 * words is a tick: the same words, or, where one side was cut (the status at
 * 200 characters, the hook at its own length, the wire at 4,000), the cut one
 * a prefix of the other. Compared folded to single spaces, since the status
 * folds its lines into one.
 *
 * Each prompt seen is also kept for the session (scheduled-prompt-memory.ts),
 * so a loop whose call has since scrolled out of the loaded pages, or was
 * there before a relaunch, still matches.
 *
 * A sentinel loop (`<<autonomous-loop>>`, `<<loop.md>>` and their dynamic
 * forms) schedules the sentinel, which Claude Code resolves into other words
 * when the tick fires, so its call and its tick share no words; a desk copy
 * that opens as the resolved words do (scheduled-loop-sentinels.ts) is a tick
 * of such a loop, loaded or remembered.
 *
 * What it cannot see, on a tab launched without the hook: a loop whose call
 * this phone never loaded (set up while it was away, or before a resume). A
 * tick of that still draws: Orca keeps a pane with a registered loop `working`,
 * so the status carries no signal that a prompt began a run, and nothing here
 * can tell it from a typed prompt (docs/mobile-agent-hud.md, "Beacon field `sc`").
 *
 * What it costs: words a person types that are exactly a loaded loop's
 * prompt lose their bubble until their own transcript row lands, which draws
 * them as it does every prompt; the match is on words alone.
 *
 * ScheduleWakeup: only its `/loop …` form was seen fire (Claude Code 2.1.278),
 * as a scheduled user row that is NOT `isMeta`, a command envelope the chat
 * draws from the transcript as a `/loop …` turn
 * (mobile-native-chat-command-turns.ts). Dropping its desk copy loses nothing
 * there. How a plain-words ScheduleWakeup tick is written is not known.
 */

/** Tools whose `prompt` Claude Code fires later as a turn of its own. */
const SCHEDULING_TOOLS: ReadonlySet<string> = new Set(['CronCreate', 'ScheduleWakeup'])

type ScheduledPrompt = { words: string; cut: boolean; messageId: string; tool: string }

/** What a copy the hook marked was scheduled by, for the log. */
const MARKED_BY_HOOK: ScheduledPrompt = { words: '', cut: false, messageId: '', tool: '' }

function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The prompts the loaded transcript's tool calls scheduled. */
function scheduledPrompts(messages: readonly NativeChatMessage[]): ScheduledPrompt[] {
  const out: ScheduledPrompt[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== 'tool-call' || !SCHEDULING_TOOLS.has(block.name)) {
        continue
      }
      const prompt =
        block.input !== null && typeof block.input === 'object'
          ? (block.input as { prompt?: unknown }).prompt
          : undefined
      if (typeof prompt !== 'string') {
        continue
      }
      const cut = prompt.endsWith(MOBILE_CUT)
      const words = folded(cut ? prompt.slice(0, -MOBILE_CUT.length) : prompt)
      if (words) {
        out.push({ words, cut, messageId: message.id, tool: block.name })
      }
    }
  }
  return out
}

function tickOf(prompt: DesktopPrompt, scheduled: readonly ScheduledPrompt[]): ScheduledPrompt | null {
  const words = folded(prompt.text)
  if (!words) {
    return null
  }
  return (
    scheduled.find(
      (entry) =>
        entry.words === words ||
        (prompt.cut === true && entry.words.startsWith(words)) ||
        (entry.cut && words.startsWith(entry.words)) ||
        // A sentinel loop's call holds the sentinel, its tick the words it
        // resolves to (scheduled-loop-sentinels.ts).
        resolvesFromSentinel(entry.words, words)
    ) ?? null
  )
}

type Ticks = {
  /** `prompts` less the ticks, the same array when there are none. */
  kept: readonly DesktopPrompt[]
  /** Each tick with the call that scheduled it. */
  ticks: readonly { prompt: DesktopPrompt; scheduledBy: ScheduledPrompt }[]
}

const NO_TICKS: Ticks['ticks'] = []

const NOTHING_REMEMBERED: readonly RememberedScheduledPrompt[] = []

function splitTicks(
  prompts: readonly DesktopPrompt[],
  seen: readonly ScheduledPrompt[],
  remembered: readonly RememberedScheduledPrompt[] = NOTHING_REMEMBERED
): Ticks {
  const marked = prompts.some((prompt) => prompt.scheduled === true)
  const scheduled =
    prompts.length === 0
      ? []
      : [
          ...seen,
          ...remembered.map((entry) => ({ words: entry.words, cut: entry.cut === true, messageId: '', tool: '' }))
        ]
  if (scheduled.length === 0 && !marked) {
    return { kept: prompts, ticks: NO_TICKS }
  }
  const kept: DesktopPrompt[] = []
  const ticks: { prompt: DesktopPrompt; scheduledBy: ScheduledPrompt }[] = []
  for (const prompt of prompts) {
    const scheduledBy = prompt.scheduled === true ? MARKED_BY_HOOK : tickOf(prompt, scheduled)
    if (scheduledBy === null) {
      kept.push(prompt)
    } else {
      ticks.push({ prompt, scheduledBy })
    }
  }
  return ticks.length === 0 ? { kept: prompts, ticks: NO_TICKS } : { kept, ticks }
}

/** `prompts` less the loop ticks among them, the same array when there are none. */
export function withoutScheduledTicks(
  prompts: readonly DesktopPrompt[],
  messages: readonly NativeChatMessage[]
): readonly DesktopPrompt[] {
  return splitTicks(prompts, scheduledPrompts(messages)).kept
}

/** The lines already logged, by nonce, so each tick says so once. Bounded:
 *  a 3-minute loop gives out 20 nonces an hour. */
const logged = new Set<string>()
const LOGGED_CAP = 256

/**
 * withoutScheduledTicks for the chat, which says once in the log of each tick
 * it held back which call scheduled it, so a tick that still draws can be
 * told from one never seen.
 */
export function useWithoutScheduledTicks(
  prompts: readonly DesktopPrompt[],
  messages: readonly NativeChatMessage[],
  /** The Claude session the chat reads, whose loop prompts are kept. */
  sessionId?: string | null
): readonly DesktopPrompt[] {
  const seen = useMemo(() => scheduledPrompts(messages), [messages])
  useEffect(() => rememberScheduledPrompts(sessionId, seen), [seen, sessionId])
  // The same array until a prompt is kept, so the memo below holds.
  const remembered = rememberedScheduledPrompts(sessionId)
  const { kept, ticks } = useMemo(() => splitTicks(prompts, seen, remembered), [prompts, seen, remembered])
  useEffect(() => {
    for (const { prompt, scheduledBy } of ticks) {
      if (logged.has(prompt.nonce)) {
        continue
      }
      if (logged.size >= LOGGED_CAP) {
        logged.clear()
      }
      logged.add(prompt.nonce)
      const why =
        scheduledBy === MARKED_BY_HOOK
          ? 'the prompt hook saw a loop fire it'
          : scheduledBy.tool
            ? `it is the prompt ${scheduledBy.tool} scheduled in ${scheduledBy.messageId}`
            : 'it is a loop prompt this session showed earlier'
      console.info(
        `[desk-prompt] not drawn: "${cutWholeCharacters(prompt.text, 32)}${prompt.text.length > 32 ? '…' : ''}": ${why}`
      )
    }
  }, [ticks])
  return kept
}
