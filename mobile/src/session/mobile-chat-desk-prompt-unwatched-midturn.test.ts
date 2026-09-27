// Reported from the phone on 2026-09-27 (Galaxy S23 Ultra, release build of
// main 6b1be352), Claude Code 2.1.283 on the desktop, chat mode, session
// 790eafa8. A message sent at the desk while a turn ran went into Claude
// Code's queue and was taken mid-turn. The session's own records (1-based
// transcript lines):
//   17114 queue-operation enqueue            17:27:57.547Z
//   17118 queue-operation remove, reason `absorbed_mid_turn`, 17:28:16.714Z
//   17122 attachment, `attachment.type: "queued_command"`, `origin.kind:
//         "human"`, timestamp 17:27:57.547Z (the enqueue), parentUuid the
//         PostToolUse hook record of the Bash call bd650cd1
// Orca's transcript reader keeps only `user` and `assistant` records
// (decodeClaudeTranscriptLine, origin/main 8d6fec597b), so no row of it
// reaches the phone: the tab status's `agentStatus.prompt` is its only copy.
//
// The phone sat on the host's worktree list from 17:24 to 17:31Z and then
// opened the chat. The session screen paints its tab strip from the tabs the
// last visit cached (mobile-session-tabs-cache.ts), so the first tab status
// the chat read was that visit's, from before the message. The host's next
// snapshot carried the message and was read as one the chat had watched
// arrive: timed by its `updatedAt`, the last tool ping before 17:31, the
// bubble sat at the tail, under the agent's reply and the rows after it, and
// stayed there as more came in below it.
//
// The rows are the transcript's own records (uuid, role, time, the text where
// the reduced records kept it) from 17:27:51 on. The rows before the chat was
// left, the rows after 17:30:08 and every status are modeled: no status was
// captured. The statuses follow Orca's agent-status store, which pushes a
// history entry only on a state change, so a prompt taken mid-run leaves the
// state's start where it was.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { landingHarness } from './mobile-chat-phone-photo-landing.test-support'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

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

const SESSION = '790eafa8-07b2-4380-abc2-90e22f965369'
const at = (clock: string) => Date.parse(`2026-09-27T${clock}Z`)

/** The message, as the tab status carries it: 176 characters, whole. */
const MESSAGE =
  "'/Users/alwinpaul/Desktop/Project/Code UI/docs/mobile-model-from-transcript.md'  will this get updated in users screen asap he changes model in claude code or claude mobile app"

const text = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
const user = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
/** A tool call and its result, as Orca projects the two records. */
const tool = (callId: string, resultId: string, name: string, called: string, returned: string): NativeChatMessage[] => [
  { id: callId, role: 'assistant', blocks: [{ type: 'tool-call', name, input: {} }], timestamp: at(called), source: 'transcript' },
  { id: resultId, role: 'tool', blocks: [{ type: 'tool-result', output: '' }], timestamp: at(returned), source: 'transcript' }
]

// Modeled: the prompt that opened the turn, and the last row the chat showed
// before it was left (the screenshots put the chat last open at 17:20–17:23Z).
const OPENING_TEXT = 'go ahead with all three fixes'
const OPENING = user('opening', OPENING_TEXT, '17:12:04.980')
const LEFT = text('left', 'Phone check first, then the fixes.', '17:19:48.000')
// The transcript's records, 17:27:51 to 17:28:16: three Reads, the words
// after the send, and the Bash call Claude Code took the message after.
const BEFORE_TAKE = [
  ...tool('951ee7fc-555c-4d6c-9de5-fee3689a1f4f', 'e2f434ac-82a8-4433-89a4-fe10153a5c45', 'Read', '17:27:51.890', '17:27:51.997'),
  ...tool('eb7e988f-a2e4-4a63-b9d8-8e7b7356df49', '5d672958-01ba-4814-8640-ab281c20dbfa', 'Read', '17:27:52.817', '17:27:52.927'),
  ...tool('6b8af0ec-1375-4860-9186-7abb5f12de6a', '5ce2673e-58e9-404e-8081-111a4da49ea5', 'Read', '17:27:56.683', '17:27:56.788'),
  text(
    '8f1e7455-e4ee-4998-82bd-5b211386673a',
    'Launching the fixes now. Checking one thing first: how existing tests render a screen in light and dark, so every agent writes the same kind of test.',
    '17:28:14.091'
  ),
  ...tool('bd650cd1-fa71-461b-9368-29e740e9bf11', 'b67cf228-bc4b-4d76-9aff-9e352cf77967', 'Bash', '17:28:15.855', '17:28:16.693')
]
const AFTER_SEND = '8f1e7455-e4ee-4998-82bd-5b211386673a'
// The turn after the take: two more calls, then the reply's first words.
const REPLY = 'ae102bb6-5067-47f8-b400-236fc3026570'
const TOOK_AND_REPLIED = [
  ...BEFORE_TAKE,
  ...tool('b83c3520-7afe-4b47-8807-c7a8e1b0cee4', '9dbc14f6-ee48-4973-9b84-c764f4d3fc94', 'Bash', '17:28:18.995', '17:28:19.598'),
  ...tool('d9bbbe9b-dc6b-4e7f-8e9a-fd53a35dcc5e', '640ed52f-792d-4eab-92f8-61213945c903', 'Bash', '17:28:32.496', '17:28:33.238'),
  text(REPLY, 'Creating the worktrees.', '17:28:34.652'),
  ...tool('454de0ec-69af-4635-9ed3-96bc9d55015b', 'defa3d33-e982-4ab3-a658-13daf82d4c22', 'Bash', '17:28:36.766', '17:28:43.425'),
  ...tool('dfa9e144-ba20-498a-a256-65c61153aef7', '08fed049-e705-4e54-b341-ac7013bd2b3a', 'Bash', '17:28:50.542', '17:28:51.310'),
  ...tool('54fdcd62-67eb-4054-8725-4dc04e0f004a', 'f0ad42ec-2ecf-4dad-918b-93badca8957b', 'Bash', '17:28:58.843', '17:29:00.184'),
  ...tool('65c57a7e-1dcb-4b7e-b551-6570797f1c23', '92ce34a7-cfe1-4203-8365-5916ef442ba8', 'Write', '17:29:38.319', '17:29:38.489'),
  { id: '925f0304-7530-45c2-9439-8cb9bc7e8c56', role: 'assistant', blocks: [{ type: 'tool-call', name: 'Agent', input: {} }], timestamp: at('17:29:54.077'), source: 'transcript' },
  { id: 'a9b5c4ca-dd99-4b5a-9326-5dd81d1259d4', role: 'assistant', blocks: [{ type: 'tool-call', name: 'Agent', input: {} }], timestamp: at('17:30:01.078'), source: 'transcript' },
  { id: '6fc0f119-b442-41cc-ab73-50336579395e', role: 'assistant', blocks: [{ type: 'tool-call', name: 'Agent', input: {} }], timestamp: at('17:30:08.828'), source: 'transcript' },
  // Modeled times, the words from the phone's screenshot.
  text(
    'six-agents',
    'Six agents are running: four for the theme sweep, one for the blank chat, one for the MCP guard. Meanwhile I’m finishing the last phone check, the Background tasks sheet.',
    '17:30:40.000'
  ),
  ...tool('bash-1', 'bash-1-result', 'Bash', '17:30:45.000', '17:30:47.000'),
  ...tool('bash-2', 'bash-2-result', 'Bash', '17:30:52.000', '17:30:58.000')
] as NativeChatMessage[]
// Modeled: what landed after the chat opened (screenshot 51).
const LATER = [
  ...TOOK_AND_REPLIED,
  ...tool('read-4', 'read-4-result', 'Read', '17:31:10.000', '17:31:10.200'),
  text('sheet-works', 'The tasks sheet works: it expands, keeps its title pinned, and lists all six tasks. Checking it closes cleanly.', '17:31:30.000')
]

/** The pane as Orca's store holds it while the turn runs: `working` since the
 *  opening prompt, and the turn before it done. */
const run = (prompt: string, updatedAt: string): NonNullable<AgentStatusPromptSource> => ({
  state: 'working',
  prompt,
  updatedAt: at(updatedAt),
  stateStartedAt: at('17:12:05.000'),
  stateHistory: [
    { state: 'working', prompt: 'the handover doc', startedAt: at('16:58:00.000') },
    { state: 'done', prompt: 'the handover doc', startedAt: at('17:05:30.000') }
  ],
  providerSession: { id: SESSION }
})
/** The status the last visit cached: the last one the chat read before it
 *  was left, from before the message. */
const CACHED = run(OPENING_TEXT, '17:23:10.000')

/** The chat's status reader (use-agent-status-prompts.ts) as the controller
 *  mounts it: the tab's status, whether the link is up, and whether the tab
 *  list is the host's (live) or still the one the last visit cached. */
function statusReader() {
  let renderer: ReactTestRenderer | null = null
  let prompts: DesktopPrompt[] = []
  function Reader({ status, connected, live }: { status: AgentStatusPromptSource; connected: boolean; live: boolean }) {
    prompts = useAgentStatusPrompts(SESSION, status, undefined, connected, live).prompts
    return null
  }
  return {
    read(status: AgentStatusPromptSource, { connected = true, live = true }: { connected?: boolean; live?: boolean } = {}): DesktopPrompt[] {
      act(() => {
        const element = createElement(Reader, { status, connected, live })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return [...prompts]
    },
    unmount(): void {
      act(() => renderer?.unmount())
      renderer = null
    }
  }
}

function rows(props: Record<string, unknown>): { id: string; text: string }[] {
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

describe('a mid-turn message sent at the desk', () => {
  const { show, unmount } = landingHarness(frames)
  /** The harness's clock is a day earlier; the chat is shown at this day's
   *  time, moved to first. */
  async function showAt(clock: string, messages: NativeChatMessage[], prompts: DesktopPrompt[]): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
    await show('00:00:00.000', { messages, working: true, prompts })
  }
  /** The row the message's bubble is drawn after. */
  function anchorOf(body: string): string | null | undefined {
    const pending = frames.at(-1)!.pending as { text: string; baselineTailMessageId: string | null }[]
    return pending.find((echo) => echo.text === body)?.baselineTailMessageId
  }
  function placement(): { message: number; left: number; afterSend: number; reply: number; count: number } {
    const drawn = rows(frames.at(-1)!)
    const index = (id: string) => drawn.findIndex((row) => row.id === id)
    return {
      message: drawn.findIndex((row) => row.text === MESSAGE),
      left: index('left'),
      afterSend: index(AFTER_SEND),
      reply: index(REPLY),
      count: drawn.filter((row) => row.text === MESSAGE).length
    }
  }

  it('keeps a mid-turn message the chat did not watch arrive above the agent’s reply to it', async () => {
    vi.setSystemTime(at('17:31:00.000'))
    const reader = statusReader()
    // The chat opens on the tab list the last visit cached…
    reader.read(CACHED, { live: false })
    // …and the host's snapshot comes in, carrying the message.
    const prompts = reader.read(run(MESSAGE, '17:31:02.000'))
    const opened = [OPENING, LEFT, ...TOOK_AND_REPLIED]
    await showAt('17:31:03.000', opened, prompts)
    await showAt('17:31:04.000', opened, prompts)
    let where = placement()
    expect(where.count).toBe(1)
    expect(where.message).toBeGreaterThan(where.left)
    expect(where.message).toBeLessThan(where.afterSend)
    expect(where.message).toBeLessThan(where.reply)
    // Rows keep coming in below it; it does not move down with them.
    await showAt('17:31:40.000', [OPENING, LEFT, ...LATER], prompts)
    await showAt('17:31:41.000', [OPENING, LEFT, ...LATER], prompts)
    where = placement()
    expect(where.count).toBe(1)
    expect(where.message).toBeLessThan(where.reply)
    reader.unmount()
    unmount()
  })

  // What the chat did before the fix, and must go on doing: a message it
  // watched arrive is timed by the status that first carried it. Claude Code
  // runs UserPromptSubmit for a message queued mid-turn at Enter (read out of
  // the 2.1.281 binary, mobile-chat-mid-turn-phone-send.test.ts), so that is
  // the enqueue, 17:27:57.547, and the bubble sits where it was sent.
  it('stays where it was sent when the chat was open as it arrived', async () => {
    vi.setSystemTime(at('17:27:56.900'))
    const reader = statusReader()
    reader.read(run(OPENING_TEXT, '17:27:56.800'))
    const prompts = reader.read(run(MESSAGE, '17:27:57.600'))
    const sent = [OPENING, LEFT, ...BEFORE_TAKE.slice(0, 6)]
    await showAt('17:27:58.000', sent, prompts)
    await showAt('17:27:59.000', sent, prompts)
    expect(anchorOf(MESSAGE)).toBe('5ce2673e-58e9-404e-8081-111a4da49ea5')
    await showAt('17:31:40.000', [OPENING, LEFT, ...LATER], prompts)
    await showAt('17:31:41.000', [OPENING, LEFT, ...LATER], prompts)
    const where = placement()
    expect(where.count).toBe(1)
    expect(anchorOf(MESSAGE)).toBe('5ce2673e-58e9-404e-8081-111a4da49ea5')
    expect(where.message).toBeLessThan(where.afterSend)
    reader.unmount()
    unmount()
  })

  it('keeps it above the reply when the link was down while it was sent', async () => {
    vi.setSystemTime(at('17:23:00.000'))
    const reader = statusReader()
    reader.read(run(OPENING_TEXT, '17:22:50.000'))
    const lastBeforeDrop = run(OPENING_TEXT, '17:25:30.000')
    reader.read(lastBeforeDrop)
    reader.read(lastBeforeDrop, { connected: false })
    // Back at 17:31, still holding the status it read before the drop, then
    // the host's, restamped by the reconnect.
    vi.setSystemTime(at('17:31:00.000'))
    reader.read(lastBeforeDrop)
    const prompts = reader.read(run(MESSAGE, '17:31:02.000'))
    const opened = [OPENING, LEFT, ...TOOK_AND_REPLIED]
    await showAt('17:31:03.000', opened, prompts)
    await showAt('17:31:04.000', opened, prompts)
    const where = placement()
    expect(where.count).toBe(1)
    expect(where.message).toBeGreaterThan(where.left)
    expect(where.message).toBeLessThan(where.afterSend)
    expect(where.message).toBeLessThan(where.reply)
    reader.unmount()
    unmount()
  })

  // Degenerate: the message is the only row after the turn's start. The chat
  // was left before the turn began; the message was typed before the agent
  // wrote anything. Claude Code stamps a prompt's row when it creates the
  // message, before its UserPromptSubmit hooks run, so the row is stamped just
  // before the state's start Orca records from the hook.
  it('sits right under the turn’s opening prompt when it is the only row after the turn’s start', async () => {
    vi.setSystemTime(at('17:12:30.000'))
    const answered = text('answered', 'Handover doc written.', '17:05:29.000')
    const opening = user('opening-2', 'go ahead with all three fixes', '17:12:04.980')
    const reader = statusReader()
    reader.read(
      {
        state: 'done',
        prompt: 'the handover doc',
        updatedAt: at('17:05:31.000'),
        stateStartedAt: at('17:05:30.000'),
        stateHistory: [{ state: 'working', prompt: 'the handover doc', startedAt: at('16:58:00.000') }],
        providerSession: { id: SESSION }
      },
      { live: false }
    )
    const prompts = reader.read(run(MESSAGE, '17:12:29.000'))
    await showAt('17:12:31.000', [answered, opening], prompts)
    await showAt('17:12:32.000', [answered, opening], prompts)
    expect(anchorOf(MESSAGE)).toBe('opening-2')
    // The agent's first words come after it.
    await showAt('17:12:41.000', [answered, opening, text('first-words', 'On it.', '17:12:40.000')], prompts)
    await showAt('17:12:42.000', [answered, opening, text('first-words', 'On it.', '17:12:40.000')], prompts)
    const drawn = rows(frames.at(-1)!)
    const index = drawn.findIndex((row) => row.text === MESSAGE)
    expect([drawn[index - 1]?.id, drawn[index + 1]?.id]).toEqual(['opening-2', 'first-words'])
    reader.unmount()
    unmount()
  })

  // Degenerate: the chat opens after Claude Code took the message and before
  // the agent wrote anything after it.
  it('is drawn, and stays above the reply that comes after the chat opened', async () => {
    vi.setSystemTime(at('17:28:17.000'))
    const reader = statusReader()
    reader.read(CACHED, { live: false })
    const prompts = reader.read(run(MESSAGE, '17:28:16.700'))
    const opened = [OPENING, LEFT, ...BEFORE_TAKE]
    await showAt('17:28:17.500', opened, prompts)
    await showAt('17:28:18.000', opened, prompts)
    expect(placement().count).toBe(1)
    await showAt('17:28:35.000', [OPENING, LEFT, ...TOOK_AND_REPLIED.slice(0, BEFORE_TAKE.length + 5)], prompts)
    await showAt('17:28:36.000', [OPENING, LEFT, ...TOOK_AND_REPLIED.slice(0, BEFORE_TAKE.length + 5)], prompts)
    const where = placement()
    expect(where.count).toBe(1)
    expect(where.reply).toBeGreaterThan(-1)
    expect(where.message).toBeLessThan(where.reply)
    reader.unmount()
    unmount()
  })
})

// The fix is a wire from the session screen to the chat's status reader, and
// the reader's own tests cannot see it. `terminalsLoaded` is the screen's
// mark that a tab list the host sent has been applied since it opened; the
// cached list it paints first leaves it false. These read the code, not its
// comments.
describe('the session screen telling the chat its tab list is the host’s', () => {
  const code = (file: string) =>
    readFileSync(join(import.meta.dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it('hands the chat whether the host’s tab list has come in', () => {
    expect(code('use-mobile-session-native-chat-dictation.ts')).toMatch(/\btabsLive:\s*scope\.terminalsLoaded\b/)
    const controller = code('use-mobile-native-chat-controller.ts')
    const start = controller.indexOf('useAgentStatusPrompts(')
    // The call's arguments, up to its closing parenthesis on its own line.
    const call = controller.slice(start, controller.indexOf('\n  )', start))
    expect(call).toMatch(/,\s*args\.tabsLive\s*$/)
  })

  it('marks it only where a tab list the host sent is applied', () => {
    const setters = readdirSync(import.meta.dirname)
      .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
      .filter((name) => /setTerminalsLoaded\(\s*true\s*\)/.test(code(name)))
    expect(setters).toEqual(['use-mobile-session-tab-application.ts'])
  })
})
