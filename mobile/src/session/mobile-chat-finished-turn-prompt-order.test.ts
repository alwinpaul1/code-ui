// Reported from the phone on 2026-09-26 at 23:36 (Claude Code 2.1.283, the
// thesis tab "paper-review", session 76ba8f2f). The chat drew, in order:
//   the end of an answer, "…and 2999 (distillation) starts. session:ok"
//   a user bubble, "lets ask mahdi later u continue the work"
//   the "11:36 pm" divider, then "Image on Desktop" and "2998 finished…"
// Times below are the transcript's, in UTC; the phone's 23:36 is 21:36 UTC.
// The prompt was typed at 13:20:44, four turns before that answer; three turns
// that teammates' messages started ran after it, the last 14:27:03–14:27:47.
// Scrolling up to the prompt and back made the bubble go.
//
// The records are the transcript's own (uuid, timestamp, the user's words);
// the answers' words are left out but for the tails the user quoted. The chat
// holds the tail page; the prompt's row is on the page above it.
//
// Why it drew there: Orca's tab status keeps a person's prompt through turns a
// harness message starts and through the `done` after them, and the phone,
// reading that status for the first time, took the `done` state's start
// (14:27:47.470, the last Stop) as the prompt's time. The last row written
// before that is the answer, so the bubble sat under it. When the older page
// loaded, the prompt's own row retired it (withoutLandedDesktopPrompts, and the
// stored witness by its landed count).
import { describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { agentRow, userRow, landingHarness, at } from './mobile-chat-phone-photo-landing.test-support'
import {
  EMPTY_AGENT_STATUS_PROMPTS,
  observeAgentStatusPrompt,
  type AgentStatusPromptState
} from './agent-status-prompts'

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
const PROMPT = 'lets ask mahdi later u continue the work'
const teammate = (id: string, name: string, clock: string) =>
  userRow(
    id,
    [`Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="pink" summary="report">\n(report)\n</teammate-message>`],
    clock
  )

// The page above the tail.
const previousAnswer = agentRow('8a3424c5-6eaa-4ca5-aad4-db36d49683fb', 'The earlier answer.', '13:15:13.988')
const prompt = userRow('0fa6fd3d-0037-4b14-918f-cff507b8568b', [PROMPT], '13:20:44.026')
const itsReply = agentRow('fb15adfa-9803-421e-8f7d-0fb35bd0c190', 'Continuing the work.', '13:21:07.140')
const itsAnswer = agentRow('91e8988b-1feb-4bdc-bdbd-6a668fb7e9ee', 'Done for now.', '13:22:30.010')
const builderSelect = teammate('db838d66-0000-4000-8000-000000000001', 'builder-select', '13:46:47.262')
const builderSelectAgain = teammate('9bde0d61-0000-4000-8000-000000000002', 'builder-select', '13:48:06.780')
const acknowledged = agentRow('e1c1a90f-3fbf-4a22-bef5-dc57af43511f', 'Noted.', '13:48:12.426')
// The tail page the chat held.
const writerBridge = teammate('6d89d3e9-0000-4000-8000-000000000003', 'writer-bridge', '14:27:03.037')
const stopping = agentRow('f352e96b-994b-4337-8811-9457a9b1a071', 'Stopping the old run.', '14:27:10.812')
const laterAnswer = agentRow(
  '7bb000ff-97ac-4987-b272-ef15019526ba',
  '…fill the one pending Gen4 sentence in the draft, and 2999 (distillation) starts. session:ok',
  '14:27:47.105'
)
// 23:36 local: a photo with no words, and Claude Code's companion row naming
// its paste file.
const photo = userRow('36ee8517-5bdb-4d1c-986f-d8349b695c75', ['[Image #18]'], '21:36:49.036')
const photoSource = userRow(
  '3736ee61-5908-4800-ab99-a8cbb7b72d96',
  ['[Image: source: /var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1790458608290-9e712704-d495-4809-89df-d782edaae451.png]'],
  '21:36:49.036'
)
const finished = agentRow('f19a0ef1-916b-4bd2-a71a-b53273f34ed0', '2998 finished at 23:03 and 2999 (distillation) has started…', '21:38:28.295')

const olderPage = [previousAnswer, prompt, itsReply, itsAnswer, builderSelect, builderSelectAgain, acknowledged]
const tailPage = [writerBridge, stopping, laterAnswer]
const tailAfterPhoto = [...tailPage, photo, photoSource, finished]

/** The tab status as the phone read it that evening: `done` since the last
 *  Stop, still carrying the person's last prompt. The history is what Orca's
 *  agent-status store pushes for the transcript's own turn starts and Stops. */
const history = [
  { state: 'done', prompt: 'whats running on willi now', startedAt: at('13:15:14.407') },
  { state: 'working', prompt: PROMPT, startedAt: at('13:20:44.026') },
  { state: 'done', prompt: PROMPT, startedAt: at('13:22:30.957') },
  { state: 'working', prompt: PROMPT, startedAt: at('13:46:47.262') },
  { state: 'done', prompt: PROMPT, startedAt: at('13:48:06.768') },
  { state: 'working', prompt: PROMPT, startedAt: at('13:48:06.780') },
  { state: 'done', prompt: PROMPT, startedAt: at('13:48:12.723') },
  { state: 'working', prompt: PROMPT, startedAt: at('14:27:03.037') }
]
const DONE = {
  state: 'done',
  prompt: PROMPT,
  updatedAt: at('14:27:47.480'),
  stateStartedAt: at('14:27:47.470'),
  stateHistory: history,
  providerSession: { id: SESSION }
}
/** The status once the photo was sent at 23:36, which the phone watched. */
const PHOTO_SENT = {
  ...DONE,
  state: 'working',
  prompt: '[Image #18]',
  updatedAt: at('21:36:49.100'),
  stateStartedAt: at('21:36:49.100'),
  stateHistory: [...history, { state: 'done', prompt: PROMPT, startedAt: at('14:27:47.470') }]
}

/** Each row a frame draws, in order: its id, and its words (`D` for each
 *  "Image on Desktop" chip). */
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
    text: message.blocks
      .map((block) => (block.type === 'text' ? block.text : block.type === 'image-ref' && isDesktopImageRef(block) ? 'D' : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }))
}
const promptRows = (rows: { text: string }[]) => rows.filter((row) => row.text === PROMPT)

describe('a prompt from a turn that ended before the chat opened', () => {
  const { show } = landingHarness(frames)

  async function openAfterTheTurn(messages: NativeChatMessage[], hasMore: boolean): Promise<AgentStatusPromptState> {
    vi.setSystemTime(at('21:30:00.000'))
    const status = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, DONE)
    await show('21:30:00.000', { messages, hasMore, prompts: [...status.prompts] })
    await show('21:30:01.000', { messages, hasMore, prompts: [...status.prompts] })
    return status
  }

  it('is not drawn under a later turn’s answer while its own row is on the page above', async () => {
    const status = await openAfterTheTurn(tailPage, true)
    // 23:36: the photo is sent and its turn begins.
    const next = observeAgentStatusPrompt(status, SESSION, PHOTO_SENT)
    await show('21:38:30.000', { messages: tailAfterPhoto, hasMore: true, prompts: [...next.prompts], working: true })
    await show('21:38:31.000', { messages: tailAfterPhoto, hasMore: true, prompts: [...next.prompts], working: true })
    // Not in any frame: the order the phone showed was answer, prompt, photo.
    expect(frames.map(rowsIn).flatMap(promptRows)).toEqual([])
    // (The companion row folds into the photo's.)
    expect(rowsIn(frames.at(-1)!).map((row) => row.id)).toEqual([writerBridge, stopping, laterAnswer, photo, finished].map((row) => row.id))
    // The 23:36 row is a photo with no words, drawn as the one chip it carries.
    expect(rowsIn(frames.at(-1)!).find((row) => row.id === photo.id)?.text).toBe('D')
  })

  it('is drawn once, above its own answer, when the page that holds it loads', async () => {
    const status = await openAfterTheTurn(tailPage, true)
    const whole = [...olderPage, ...tailPage]
    await show('21:31:00.000', { messages: whole, hasMore: true, prompts: [...status.prompts] })
    await show('21:31:01.000', { messages: whole, hasMore: true, prompts: [...status.prompts] })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(promptRows(rowsIn(frames.at(-1)!))).toHaveLength(1)
    expect(ids.slice(0, 3)).toEqual([previousAnswer.id, prompt.id, itsReply.id])
    expect(ids.indexOf(prompt.id)).toBeLessThan(ids.indexOf(laterAnswer.id))
  })

  // Degenerate pages: the prompt as the session's first row, and a page of
  // one row.
  it('is not drawn when it is the session’s first row and the page starts just below it', async () => {
    const page = [itsReply, itsAnswer, laterAnswer]
    const status = await openAfterTheTurn(page, true)
    expect(frames.map(rowsIn).flatMap(promptRows)).toEqual([])
    // The page above is that one row.
    await show('21:31:00.000', { messages: [prompt, ...page], hasMore: false, prompts: [...status.prompts] })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(ids).toEqual([prompt.id, itsReply.id, itsAnswer.id, laterAnswer.id])
  })

  it('is not drawn when the page holds nothing but the answer', async () => {
    await openAfterTheTurn([laterAnswer], true)
    expect(frames.map(rowsIn).flatMap(promptRows)).toEqual([])
    expect(rowsIn(frames.at(-1)!).map((row) => row.id)).toEqual([laterAnswer.id])
  })

  it('is drawn once when its own row is the only row the chat holds', async () => {
    // A turn stopped before the agent wrote a word: the session is this row.
    await openAfterTheTurn([prompt], false)
    expect(rowsIn(frames.at(-1)!)).toEqual([{ id: prompt.id, text: PROMPT }])
  })
})
