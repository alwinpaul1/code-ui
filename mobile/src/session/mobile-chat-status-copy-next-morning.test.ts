// Reported 2026-09-27 around 10:00 local, from the phone's older build (the
// thesis tab "paper-review", session 76ba8f2f, Claude Code 2.1.283). The chat
// showed the latest answer ("…Committed as 5ad36fa… 2999 (distillation) is
// running on willi until about 10:00. session:ok"), then at the very bottom a
// user bubble: the first 200 characters of "- For Mahdi: nine of his sentences
// changed…". Nothing came after it, and the tab showed ✓. The user read it as
// "the responses below this prompt are missing".
//
// That bubble is the tab status's copy of a message typed at the desk mid-turn
// the evening before: enqueued at 21:37:19.625 UTC, taken at 21:38:48.8 as a
// `queued_command` attachment (Orca's reader drops those, so it has no row).
// The turn it joined began with a photo prompt at 21:36:49.036 and ended with
// that answer at 21:41:11.778; the Stop came at 21:41:12.357. The status kept
// the message as its prompt through the night, `done` since the Stop, and the
// old build timed a prompt found on a `done` pane by that state's start: under
// the answer, at the tail. On main it is timed by the run its history says it
// came in (agent-status-prompts.ts, runItCameIn), and held while that run is
// on a page not loaded.
//
// Records are the transcript's own (uuids, stamps); the status text is the
// status's 200-character fold of the queued prompt, which this file checks
// equals what the phone showed. The history is what Orca's agent-status store
// pushes for those turns (one entry per state change, with the prompt carried
// when it ended); the status itself was not captured. Orca's hook runs after
// the submit, so the run's start is put 64 ms after the photo prompt's stamp
// (the codegraph UserPromptSubmit hook of the same submit ran from about
// 21:36:49.057 to 21:36:49.956).
import { describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { agentRow, userRow, landingHarness, at } from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

const SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
/** What the phone drew: the status's fold of the 340-character queued prompt. */
const STATUS_COPY =
  '- For Mahdi: nine of his sentences changed, in blue, listed in black_text_changes_bridge.md. - A found bug: one of his sentences ("6.65 M parameters with the bridge and 6.22 M without") had never prin'
const PREVIOUS_PROMPT = 'lets ask mahdi later u continue the work'

const laterAnswer = agentRow('7bb000ff-97ac-4987-b272-ef15019526ba', '…and 2999 (distillation) starts. session:ok', '14:27:47.105')
const photo = userRow('36ee8517-5bdb-4d1c-986f-d8349b695c75', ['[Image #18]'], '21:36:49.036')
const photoSource = userRow(
  '3736ee61-5908-4800-ab99-a8cbb7b72d96',
  ['[Image: source: /var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1790458608290-9e712704-d495-4809-89df-d782edaae451.png]'],
  '21:36:49.036'
)
const finished = agentRow('f19a0ef1-916b-4bd2-a71a-b53273f34ed0', '2998 finished at 23:03 and 2999 (distillation) has started…', '21:38:28.295')
const sync = agentRow('355dcd7b-2a34-4bbf-8282-b284c8e33349', 'Sync 2998 results and rerun the selection', '21:38:31.771')
const grepTooBroad = agentRow('ed588c65-2d5c-4dc9-9ffd-a9114cad720f', 'The first grep matched too broadly…', '21:39:47.749')
const latestAnswer = agentRow(
  'cdc2a508-bc13-482a-bdb8-740f277d350e',
  '…Committed as 5ad36fa… 2999 (distillation) is running on willi until about 10:00. session:ok',
  '21:41:11.778'
)
const turn = [photo, photoSource, finished, sync, grepTooBroad, latestAnswer]

/** The tab status the phone read the next morning: `done` since the Stop,
 *  still carrying the queued message as the person's last prompt. */
const nextMorning = (stateHistory: readonly { state: string; prompt: string; startedAt: number }[], doneSince = at('21:41:12.360')) => ({
  state: 'done',
  prompt: STATUS_COPY,
  updatedAt: doneSince + 10,
  stateStartedAt: doneSince,
  stateHistory,
  providerSession: { id: SESSION }
})
const history = [
  { state: 'working', prompt: PREVIOUS_PROMPT, startedAt: at('14:27:03.037') },
  { state: 'done', prompt: PREVIOUS_PROMPT, startedAt: at('14:27:47.470') },
  { state: 'working', prompt: STATUS_COPY, startedAt: at('21:36:49.100') }
]

function rowsIn(props: Record<string, unknown>): { id: string; text: string }[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data.map((message) => ({
    id: message.id,
    text: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  }))
}
const statusCopies = (frame: Record<string, unknown>) => rowsIn(frame).filter((row) => row.text === STATUS_COPY)

describe('a mid-turn desk message the tab status still carries the next morning', () => {
  const { show } = landingHarness(frames)

  async function openNextMorning(messages: NativeChatMessage[], hasMore: boolean, stateHistory = history, doneSince?: number): Promise<void> {
    // The phone's clock only orders readings here; 23:59 stands for the
    // next morning.
    vi.setSystemTime(at('23:59:00.000'))
    const prompts = [...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, nextMorning(stateHistory, doneSince)).prompts]
    await show('23:59:00.000', { messages, hasMore, prompts })
    await show('23:59:01.000', { messages, hasMore, prompts })
  }

  it('is not drawn under the latest answer while the turn it joined starts on a page not loaded', async () => {
    await openNextMorning([finished, sync, grepTooBroad, latestAnswer], true)
    expect(frames.flatMap(statusCopies)).toEqual([])
    expect(rowsIn(frames.at(-1)!).at(-1)?.id).toBe(latestAnswer.id)
  })

  it('is drawn once where it was sent, after the photo that opened its turn, when that page loads', async () => {
    await openNextMorning([laterAnswer, ...turn], true)
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    const drawn = rowsIn(frames.at(-1)!).filter((row) => row.text === STATUS_COPY)
    expect(drawn).toHaveLength(1)
    const index = ids.indexOf(drawn[0]!.id)
    // After the photo (its companion folds into it), before the turn's first
    // reply, and nowhere near the tail.
    expect(ids[index - 1]).toBe(photo.id)
    expect(ids[index + 1]).toBe(finished.id)
    expect(ids.at(-1)).toBe(latestAnswer.id)
  })

  // Turns later a pane can still carry it: every turn a teammate's message
  // starts keeps the cached prompt, and the history holds only 20 entries.
  // Here ten such turns ran after it, and its own run is gone from the list.
  it('stays held when the history no longer reaches the run it came in', async () => {
    const full = Array.from({ length: 20 }, (_, index) => ({
      state: index % 2 === 0 ? 'done' : 'working',
      prompt: STATUS_COPY,
      startedAt: at('21:41:12.360') + index * 60_000
    }))
    await openNextMorning([laterAnswer, ...turn], false, full, at('22:05:00.000'))
    expect(frames.flatMap(statusCopies)).toEqual([])
  })
})
