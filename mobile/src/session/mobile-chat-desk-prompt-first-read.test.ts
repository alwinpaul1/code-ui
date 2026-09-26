// Review of 784531ee (2026-09-27). That commit holds back a desk prompt the
// chat finds on the tab status when the status says the pane's state began
// after the prompt. Two cases it held back wrongly, each drawn right on
// 9f9aa4a0:
//   - a message typed at the desk after the agent's permission prompt was
//     granted, found later in that run. Orca keeps `waiting` as the last
//     history entry for the rest of the run (it pushes history only on a
//     state change), but the prompt changed after the resume, so the resume
//     is at or before its time.
//   - the hook copy of a phone photo Claude took mid-turn, before such a
//     prompt, found after a relaunch. Dropped outright, it could no longer
//     pair with the phone's send, which then claimed the desk's next photo
//     of as many pictures and hid it.
// The run's shape follows Orca's agent-status store and hook server
// (stateStartedAt moves only on a state change); no status was captured.
import { describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { resetPhotoCopyBindingsForTests } from './desktop-prompt-photo-copies'
import {
  TEMP,
  agentRow,
  userRow,
  before,
  hookCopy,
  claudeScreen,
  landingHarness,
  SESSION,
  at
} from './mobile-chat-phone-photo-landing.test-support'
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

function rowIds(props: Record<string, unknown>): { id: string; text: string }[] {
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

describe('a message typed at the desk mid-turn after a permission was granted', () => {
  const { show } = landingHarness(frames)
  const P1 = 'run the migration on staging'
  const P2 = 'also dump the row counts before and after'
  const opening = userRow('u1', [P1], '07:00:00.000')
  const a1 = agentRow('a1', 'Checking the schema.', '07:00:40.000')
  const a2 = agentRow('a2', 'Migrated; counting rows.', '07:02:00.000')
  // 07:01:00 the agent asks for permission; 07:01:30 it is granted; 07:01:45
  // P2 is typed at the desk and queued. The chat opens at 07:03:10.
  const status = {
    state: 'working',
    prompt: P2,
    updatedAt: at('07:03:05.000'),
    stateStartedAt: at('07:01:30.000'),
    stateHistory: [
      { state: 'done', prompt: 'earlier', startedAt: at('06:50:00.000') },
      { state: 'working', prompt: P1, startedAt: at('07:00:00.000') },
      { state: 'waiting', prompt: P1, startedAt: at('07:01:00.000') }
    ]
  }

  it('is drawn in that run, after the rows written before the resume, when the chat opens later in it', async () => {
    vi.setSystemTime(at('07:03:10.000'))
    const prompts = [...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, status).prompts]
    const messages = [opening, a1, a2]
    await show('07:03:10.000', { messages, working: true, prompts })
    await show('07:03:11.000', { messages, working: true, prompts })
    const rows = rowIds(frames.at(-1)!)
    expect(rows.filter((row) => row.text === P2)).toHaveLength(1)
    const index = rows.findIndex((row) => row.text === P2)
    expect([rows[index - 1]?.id, rows[index + 1]?.id]).toEqual(['a1', 'a2'])
  })
})

describe('a phone photo Claude took before a permission prompt, after a relaunch', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('leaves the desk’s next photo of as many pictures drawn as its own bubble', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const own = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    // The agent asks for permission at 07:05:00; it is granted at 07:05:20.
    // The app is relaunched.
    unmount()
    resetPhotoCopyBindingsForTests()
    const resumed = {
      state: 'working',
      prompt: '[Image #73]',
      updatedAt: at('07:06:00.000'),
      stateStartedAt: at('07:05:20.000'),
      stateHistory: [
        { state: 'working', prompt: 'earlier', startedAt: at('07:02:10.000') },
        { state: 'waiting', prompt: '[Image #73]', startedAt: at('07:05:00.000') }
      ]
    }
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, resumed)
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:09:00.000')]
    await show('07:10:00.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    // A screenshot is pasted at the desk with no words while the run goes on.
    state = observeAgentStatusPrompt(state, SESSION, { ...resumed, prompt: '[Image #74]', updatedAt: at('07:10:40.000') })
    await show('07:11:00.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:11:01.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    const frame = lastFrame()
    expect(frame.filter((bubble) => bubble.images === 'P')).toHaveLength(1)
    expect(frame.filter((bubble) => bubble.images.includes('D'))).toHaveLength(1)
  })
})

// Re-review of 0d5853d3: the held copy's text stood in the list of messages
// the queue box's own witness leaves to the hook, so a desk message Claude
// took from the box mid-turn, whose status copy was held back, drew nowhere.
describe('a desk message still in the queue box when the chat first reads the status', () => {
  const { show } = landingHarness(frames)
  const P1 = 'run the migration on staging'
  const P2 = 'also dump the row counts before and after'
  const opening = userRow('u1', [P1], '07:00:00.000')
  const a1 = agentRow('a1', 'Checking the schema.', '07:00:40.000')
  const a2 = agentRow('a2', 'Migrated; counting rows.', '07:02:00.000')
  // 07:00:50 P2 is typed at the desk and queued; the hook takes it then.
  // 07:01:00 the agent asks for permission; 07:01:30 it is granted.
  const status = {
    state: 'working',
    prompt: P2,
    updatedAt: at('07:01:40.000'),
    stateStartedAt: at('07:01:30.000'),
    stateHistory: [
      { state: 'working', prompt: P2, startedAt: at('07:00:00.000') },
      { state: 'waiting', prompt: P2, startedAt: at('07:01:00.000') }
    ]
  }

  it('is drawn once after Claude takes it out of the box', async () => {
    vi.setSystemTime(at('07:01:45.000'))
    const prompts = [...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, status).prompts]
    const box = queuedMessagesFromScreen(claudeScreen([P2]))
    await show('07:01:45.000', { messages: [opening, a1], working: true, prompts, queued: box })
    await show('07:01:46.000', { messages: [opening, a1], working: true, prompts, queued: box })
    // Claude takes it after the granted tool: the box empties, no row lands.
    await show('07:02:05.000', { messages: [opening, a1, a2], working: true, prompts, queued: [] })
    await show('07:02:06.000', { messages: [opening, a1, a2], working: true, prompts, queued: [] })
    expect(rowIds(frames.at(-1)!).filter((row) => row.text === P2)).toHaveLength(1)
  })
})

// Re-review of 0d5853d3: a phone text send Claude took mid-turn pairs by its
// words. After a remount its own copy is held back (untimed), and a copy of
// the same words typed at the desk later, timed, was nearer by time: the send
// claimed the desk's and hid it.
describe('a phone send Claude took mid-turn, when the desk later sends the same words', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const YES = 'yes do it'
  const OTHER = 'and keep the old index until the counts match'

  it('leaves the desk’s copy drawn beside the phone’s', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', YES, [])
    const own = hookCopy('07:03:54.573', YES)
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen([YES])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    // The agent asks for permission at 07:05:00; it is granted at 07:05:20.
    // The chat is left and opened again.
    unmount()
    const resumed = {
      state: 'working',
      prompt: YES,
      updatedAt: at('07:06:00.000'),
      stateStartedAt: at('07:05:20.000'),
      stateHistory: [
        { state: 'working', prompt: 'earlier', startedAt: at('07:02:10.000') },
        { state: 'waiting', prompt: YES, startedAt: at('07:05:00.000') }
      ]
    }
    vi.setSystemTime(at('07:06:30.000'))
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, resumed)
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:06:10.000')]
    await show('07:06:30.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    // At the desk, mid-turn: another message, then the same words again.
    vi.setSystemTime(at('07:07:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { ...resumed, prompt: OTHER, updatedAt: at('07:07:00.000') })
    await show('07:07:01.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    vi.setSystemTime(at('07:08:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { ...resumed, prompt: YES, updatedAt: at('07:08:00.000') })
    await show('07:08:01.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:08:02.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    expect(lastFrame().filter((bubble) => bubble.text === YES)).toHaveLength(2)
  })
})

// Third review, of 280868b3: in one mount, a phone send's own copy watched
// arrive, and the same words read again later on the ended turn's pane, held.
// Preferring any held copy read after the send took that one, and the send's
// own watched copy drew as a second bubble.
describe('a phone send whose own copy the chat watched, read again after the turn', () => {
  const { show, send, lastFrame } = landingHarness(frames)
  const YES = 'yes do it'

  async function sendTakeAndEnd(): Promise<{ state: ReturnType<typeof observeAgentStatusPrompt>; ended: NativeChatMessage[] }> {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', YES, [])
    vi.setSystemTime(at('07:03:54.700'))
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { state: 'working', prompt: '', updatedAt: at('07:03:50.000') })
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: YES, updatedAt: at('07:03:54.573') })
    await show('07:03:55.000', { messages: working, working: true, prompts: [...state.prompts], queued: queuedMessagesFromScreen(claudeScreen([YES])) })
    const ended = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916'), agentRow('55906d18', 'Fixed.', '07:06:00.000')]
    await show('07:04:36.000', { messages: ended, working: true, prompts: [...state.prompts], queued: [] })
    return { state, ended }
  }

  it('is drawn once after a reading with no status', async () => {
    let { state, ended } = await sendTakeAndEnd()
    state = observeAgentStatusPrompt(state, SESSION, null)
    vi.setSystemTime(at('07:07:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { state: 'done', prompt: YES, updatedAt: at('07:06:00.100'), stateStartedAt: at('07:06:00.050') })
    await show('07:07:00.000', { messages: ended, prompts: [...state.prompts], queued: [] })
    await show('07:07:01.000', { messages: ended, prompts: [...state.prompts], queued: [] })
    expect(lastFrame().filter((bubble) => bubble.text === YES)).toHaveLength(1)
  })

  it('is drawn once after another desk message in between', async () => {
    let { state, ended } = await sendTakeAndEnd()
    vi.setSystemTime(at('07:05:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: 'and keep the old table around', updatedAt: at('07:05:00.000') })
    vi.setSystemTime(at('07:07:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { state: 'done', prompt: YES, updatedAt: at('07:06:00.100'), stateStartedAt: at('07:06:00.050') })
    await show('07:07:00.000', { messages: ended, prompts: [...state.prompts], queued: [] })
    await show('07:07:01.000', { messages: ended, prompts: [...state.prompts], queued: [] })
    expect(lastFrame().filter((bubble) => bubble.text === YES)).toHaveLength(1)
  })
})

// A message typed at the desk mid-turn has no row. Read first after its turn
// ended, the pane is `done`; the history still names the run it came in, so it
// is drawn in that turn, from the run's start, never under the turn's answer.
describe('a desk message typed mid-turn, first read after its turn ended', () => {
  const { show } = landingHarness(frames)
  const P1 = 'now run the tests'
  const P2 = 'and paste the failing names here'
  const opening = userRow('u1', [P1], '07:00:00.000')
  const a1 = agentRow('a1', 'Running the suite.', '07:00:40.000')
  const answer = agentRow('a2', 'All tests pass.', '07:02:00.000')
  const status = {
    state: 'done',
    prompt: P2,
    updatedAt: at('07:02:00.300'),
    stateStartedAt: at('07:02:00.200'),
    stateHistory: [
      { state: 'done', prompt: 'earlier', startedAt: at('06:50:00.000') },
      { state: 'working', prompt: P2, startedAt: at('07:00:00.000') }
    ]
  }

  it('is drawn once inside its turn, above the turn\u2019s answer', async () => {
    vi.setSystemTime(at('07:10:00.000'))
    const prompts = [...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, status).prompts]
    const messages = [opening, a1, answer]
    await show('07:10:00.000', { messages, prompts })
    await show('07:10:01.000', { messages, prompts })
    const rows = rowIds(frames.at(-1)!)
    expect(rows.filter((row) => row.text === P2)).toHaveLength(1)
    const index = rows.findIndex((row) => row.text === P2)
    expect(index).toBeLessThan(rows.findIndex((row) => row.id === 'a2'))
    expect(index).toBeGreaterThan(rows.findIndex((row) => row.id === 'u1'))
  })
})


// Review of the commits after 3c755ab5: after a remount, a phone send's own
// copy found in a run that waited is timed at the run's start, hours before
// the send; only a lower bound. Ranked by time, the desk's later repeat of
// the same words was nearer, and the send claimed it and hid it.
describe('a phone send Claude took mid-turn in a run that waited, after a remount', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const YES = 'yes do it'
  const OTHER = 'and keep the old index until the counts match'

  it('leaves the desk’s later repeat of its words drawn beside it', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', YES, [])
    const own = hookCopy('07:03:54.573', YES)
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen([YES])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    unmount()
    const run = {
      state: 'working',
      prompt: YES,
      updatedAt: at('07:06:00.000'),
      stateStartedAt: at('07:05:20.000'),
      stateHistory: [
        { state: 'done', prompt: 'earlier', startedAt: at('04:59:00.000') },
        // A long run: its start is two hours before the send.
        { state: 'working', prompt: YES, startedAt: at('05:00:00.000') },
        { state: 'waiting', prompt: YES, startedAt: at('07:05:00.000') }
      ]
    }
    vi.setSystemTime(at('07:06:30.000'))
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, run)
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:06:10.000')]
    await show('07:06:30.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    vi.setSystemTime(at('07:07:00.000'))
    state = observeAgentStatusPrompt(state, SESSION, { ...run, prompt: OTHER, updatedAt: at('07:07:00.000') })
    await show('07:07:01.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    vi.setSystemTime(at('07:10:40.000'))
    state = observeAgentStatusPrompt(state, SESSION, { ...run, prompt: YES, updatedAt: at('07:10:40.000') })
    await show('07:10:41.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:10:42.000', { messages: later, working: true, prompts: [...state.prompts], queued: [] })
    // The phone's bubble, and the desk's repeat by its own copy (watched at
    // 07:10:40): not the send's copy found at the run's start.
    const yes = lastFrame().filter((bubble) => bubble.text === YES)
    expect(yes.map((bubble) => (bubble.id.startsWith('desk-') ? bubble.id : 'phone')).sort()).toEqual(
      [`desk-status:${SESSION}:${at('07:10:40.000')}:2`, 'phone'].sort()
    )
  })
})
