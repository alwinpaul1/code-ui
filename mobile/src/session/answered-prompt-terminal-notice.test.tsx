import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { AskAnswerSelection } from '../../../src/shared/native-chat-ask'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { createHookListenerState, type HookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeAndAccept } from '../../../src/shared/agent-hook-listener-test-harness'
import type { RpcClient } from '../transport/rpc-client'

// Reported from the phone on 2026-09-29: "when a user question appears and I
// click one option and click submit the screen flashes".
//
// What flashed: the dock swapped the answered card for "A menu is open in the
// terminal / This chat can't show the prompt. Answer it in the terminal." and
// its full-width "Open terminal" button, then took that away again. The notice
// (2026-09-27) is raised from the last screen read, and nothing re-read the
// screen after the phone's own answer: the poll comes once a second. So once
// the hook row and the transcript said the question was taken, the card went,
// and the read from BEFORE the answer, which still showed Claude's question
// dialog, raised the notice until the next poll.
//
// These cases drive the real controller: Claude Code's hook rows through
// Orca's vendored normalizer, the real screen poll reading Claude Code's own
// screens (tmux captures of 2.1.282's question and 2.1.276's plan review), the
// real answer and approval sends, and the dock's card choice, recording every
// frame the dock commits. An approval whose card comes from the hook row (the
// plan review) flashed "Waiting for approval in the terminal" the same way.

const session = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => session
}))
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({
    isTabChatView: () => true,
    toggleTabChatView: vi.fn(),
    peekTerminalTab: vi.fn(),
    endTerminalPeek: vi.fn()
  })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('./use-mobile-structured-agent-session', () => ({
  useMobileStructuredAgentSession: () => ({
    session: { messages: [], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: vi.fn() },
    isWorking: false,
    turnId: null,
    turnActivity: null,
    sendWithOutcome: vi.fn(),
    sendConditions: { client: null, sendable: false },
    cancel: vi.fn(),
    permission: null,
    question: null,
    optionSnapshot: [],
    optionSurface: { getSnapshot: () => [], setOption: vi.fn(), invokeAction: vi.fn(), subscribe: () => () => {} },
    pendingOptionId: null,
    respondPermission: vi.fn(),
    respondQuestion: vi.fn(),
    setStructuredOption: vi.fn(),
    invokeStructuredOption: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: vi.fn(),
    getComposerEditGeneration: () => 0,
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))

// The dock's cards, as tags that say which one each frame drew. The ask card
// keeps its props, so a case can press its Submit (`onAnswer`) or Cancel.
let drawn: string[] = []
let askProps: {
  onAnswer: (selections: AskAnswerSelection[]) => Promise<boolean>
  onCancel?: () => Promise<boolean>
  sentAt: number | null
} | null = null
let permissionProps: { onRespond: (send: string) => Promise<boolean> } | null = null
vi.mock('./MobileNativeChatAsk', () => ({
  MobileNativeChatAsk: (props: NonNullable<typeof askProps>) => {
    askProps = props
    drawn.push(props.sentAt === null ? 'question card' : 'question card, sent')
    return null
  }
}))
vi.mock('./MobileNativeChatPermission', () => ({
  MobileNativeChatPermission: (props: NonNullable<typeof permissionProps>) => {
    permissionProps = props
    drawn.push('approval card')
    return null
  }
}))
vi.mock('./MobileNativeChatQuestion', () => ({
  MobileNativeChatQuestion: () => {
    drawn.push('heuristic question card')
    return null
  }
}))
vi.mock('./MobileNativeChatTerminalWait', () => ({
  MobileNativeChatTerminalWait: (props: { wait: { source: string; kind?: string } }) => {
    drawn.push(`terminal notice (${props.wait.source}${props.wait.kind ? ` ${props.wait.kind}` : ''})`)
    return null
  }
}))

import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

/** Each screen of a capture, after its `=== screen: … ===` marker. */
function readScreens(file: string): Record<string, string[]> {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
  const screens: Record<string, string[]> = {}
  let current: string[] | null = null
  for (const row of text.split('\n')) {
    const marker = /^=== screen: (.*) ===$/.exec(row)
    if (marker) {
      current = screens[marker[1]!] = []
    } else {
      current?.push(row)
    }
  }
  return screens
}

// Claude Code 2.1.282 (tmux, 2026-09-25): the question's dialog, and the screen
// once option 2 was sent ("⏺ User answered Claude's questions", input row back).
const SINGLE = readScreens('claude-screen-ask-single-select-2.1.282.txt')
const QUESTION_ON_SCREEN = SINGLE.ask!
const ANSWERED_ON_SCREEN = SINGLE['after 2']!

/** The question that capture asked (its tool input, as Claude sent it). */
const QUESTION = {
  questions: [
    {
      question: 'Push the branch?',
      header: 'Push',
      multiSelect: false,
      options: [
        { label: 'Yes, push to PR 1100', description: 'Push now' },
        { label: 'No, keep it local', description: 'Stay local' }
      ]
    }
  ]
}
const PROMPT_ROW: NativeChatMessage = {
  id: 'user-prompt',
  role: 'user',
  timestamp: 1,
  source: 'transcript',
  blocks: [{ type: 'text', text: 'This is a UI test. Call the AskUserQuestion tool exactly once.' }]
}
const ASK_CALL: NativeChatMessage = {
  id: 'assistant-ask',
  role: 'assistant',
  timestamp: 2,
  source: 'transcript',
  blocks: [{ type: 'tool-call', name: 'AskUserQuestion', input: QUESTION }]
}
const ASK_RESULT: NativeChatMessage = {
  id: 'ask-result',
  role: 'tool',
  timestamp: 3,
  source: 'transcript',
  blocks: [{ type: 'tool-result', output: 'User has answered your questions: "Push the branch?"="No, keep it local".' }]
}

type Row = Record<string, unknown>
const TURN: Row = { hook_event_name: 'UserPromptSubmit', prompt: 'This is a UI test.' }
const ASKS: Row = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: QUESTION, tool_use_id: 'toolu_ask' }
const TOOK: Row = {
  ...ASKS,
  hook_event_name: 'PostToolUse',
  tool_response: 'User has answered your questions: "Push the branch?"="No, keep it local".'
}

const TRANSCRIPT = '/Users/me/.claude/projects/-private-tmp-claude-501-cui-ask-282/session-1.jsonl'

let renderer: ReactTestRenderer | null = null
let controller: MobileNativeChatController | null = null
let hookState: HookListenerState
let status: AgentStatusEntry | null = null
let rowAt = 0
let frames: string[] = []
/** What a screen read returns now (null: the host declines the read). */
let screen: string[] | null = []
/** Set by a case: every screen read the phone starts after its own write
 *  comes back only on `landReads`, later than the agent's own reports. */
let slowReadsAfterWrite = false
/** Set by a case: every screen read, whenever it began, waits for `landReads`. */
let slowReads = false
let wrote = false
let heldReads: (() => void)[] = []
/** The keys the phone wrote into the terminal. */
let writes: string[] = []

const sendRequest = vi.fn(async (method: string, params?: { text?: string }) => {
  if (method === 'terminal.send') {
    // The host takes every key, as it did on the phone.
    wrote = true
    writes.push(params?.text ?? '')
    return { ok: true, result: { send: { handle: 'term-1', accepted: true, bytesWritten: 1 } } }
  }
  if (method !== 'terminal.read') {
    return { ok: false, error: { code: 'unavailable', message: 'not in this test' } }
  }
  if (slowReads || (slowReadsAfterWrite && wrote)) {
    await new Promise<void>((resolve) => heldReads.push(resolve))
  }
  return screen
    ? { ok: true, result: { terminal: { lines: screen, source: 'screen' } } }
    : { ok: false, error: { code: 'unavailable', message: 'the host declined the read' } }
})
const clientStub = { sendRequest, getState: () => 'connected' as const, notifyForeground: vi.fn() }
const handleRef = { current: 'term-1' }
const deviceTokenRef = { current: null }

/** The controller, and the dock's card as MobileNativeChatView hands it the
 *  controller's fields (through the overlay, unchanged). */
function Harness({ tab }: { tab: object }): React.JSX.Element {
  drawn = []
  controller = useMobileNativeChatController({
    client: clientStub as unknown as RpcClient,
    connState: 'connected',
    tabsLive: true,
    hostId: 'h',
    worktreeId: 'w',
    activeSessionTab: tab as never,
    activeSessionTabId: 'tab-1',
    activeHandle: 'term-1',
    activeHandleRef: handleRef,
    deviceTokenRef,
    nativeChatTranscriptIsLocalReadable: true,
    nativeChatInputLeaseReady: true,
    onSendError: vi.fn(),
    onSendResolved: vi.fn()
  })
  // Every commit: what the dock drew in it.
  useLayoutEffect(() => {
    frames.push(drawn.join(' + ') || 'nothing')
  })
  const c = controller
  return createElement(MobileNativeChatPromptCard, {
    ask: c.nativeChatAsk,
    askKey: c.nativeChatAskKey,
    askSentAt: c.nativeChatAskSentAt,
    onDismissAsk: c.dismissNativeChatAsk,
    onAnswerAsk: c.handleNativeChatAnswerAsk,
    onCancelAsk: c.handleNativeChatCancelAsk,
    onCancelPrompt: c.handleNativeChatCancelPrompt,
    question: c.nativeChatQuestion,
    onAnswerQuestion: c.handleNativeChatQuestionAnswer,
    permission: c.nativeChatPermission,
    onRespondPermission: c.handleNativeChatRespondPermission,
    terminalWait: c.nativeChatTerminalWait,
    onOpenTerminal: c.openNativeChatTerminal
  })
}

function tab(): object {
  return {
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: 'claude',
    agentStatus: { ...status, providerSession: { id: 'session-1', transcriptPath: TRANSCRIPT } },
    isActive: true
  }
}

async function draw(): Promise<void> {
  await act(async () => {
    if (renderer) {
      renderer.update(createElement(Harness, { tab: tab() }))
    } else {
      renderer = create(createElement(Harness, { tab: tab() }))
    }
  })
}

/** One hook post to Orca: the tab status the phone is sent next. */
async function hook(row: Row): Promise<void> {
  rowAt += 1
  const event = normalizeAndAccept(hookState, 'claude', { session_id: 'session-1', ...row })
  if (event) {
    status = { ...event.payload, updatedAt: rowAt, stateStartedAt: rowAt } as AgentStatusEntry
  }
  await draw()
}

/** The transcript read lands with these rows. */
async function transcript(messages: NativeChatMessage[]): Promise<void> {
  session.messages = messages
  await draw()
}

/** Every screen read still in flight comes back, reading `lines` (null: the
 *  host declines it). */
async function landReads(lines: string[] | null): Promise<void> {
  screen = lines
  slowReadsAfterWrite = false
  slowReads = false
  await act(async () => {
    for (const land of heldReads.splice(0)) {
      land()
    }
  })
}

/** The question is up: Claude asked, the transcript has the call, and the
 *  screen poll has read Claude's dialog. */
async function questionUp(): Promise<void> {
  screen = QUESTION_ON_SCREEN
  await hook(TURN)
  await hook(ASKS)
  await transcript([PROMPT_ROW, ASK_CALL])
  expect(frames.at(-1)).toBe('question card')
  expect(controller?.nativeChatTerminalWait).toBeNull()
}

beforeEach(() => {
  // The poll's one-second tick fires only when a case moves the clock; every
  // read here is one the controller asked for itself.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  hookState = createHookListenerState()
  status = null
  rowAt = 0
  frames = []
  screen = []
  slowReadsAfterWrite = false
  slowReads = false
  wrote = false
  heldReads = []
  writes = []
  askProps = null
  permissionProps = null
  session.messages = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  controller = null
  vi.useRealTimers()
})

/** Taps Submit with option 2 picked, as the card's Submit calls it. */
async function submitSecondOption(): Promise<void> {
  await act(async () => {
    expect(await askProps!.onAnswer([{ indices: [1] }])).toBe(true)
  })
  expect(writes).toEqual(['2'])
}

/** The notice's frames from `start` on. */
function noticesIn(start: number): string[] {
  return frames.slice(start).filter((frame) => frame.startsWith('terminal notice'))
}

describe("the dock after Submit on Claude Code 2.1.282's question", () => {
  it.each([
    ['the hook row, then the transcript', 'row first'],
    ['the transcript, then the hook row', 'transcript first']
  ])(
    'does not flash "A menu is open in the terminal" before the screen is read again (%s)',
    async (_label, order) => {
      await questionUp()
      slowReadsAfterWrite = true
      const start = frames.length
      await submitSecondOption()
      if (order === 'row first') {
        await hook(TOOK)
        await transcript([PROMPT_ROW, ASK_CALL, ASK_RESULT])
      } else {
        await transcript([PROMPT_ROW, ASK_CALL, ASK_RESULT])
        await hook(TOOK)
      }
      await landReads(ANSWERED_ON_SCREEN)
      expect(noticesIn(start), frames.slice(start).join(' → ')).toEqual([])
      expect(frames.at(-1)).toBe('nothing')
    }
  )

  // A poll can be on the wire when Submit is tapped. What it read was painted
  // before the key landed, so it cannot say the question is still up either.
  it('does not flash it when a poll begun before Submit comes back after it, still showing the question', async () => {
    await questionUp()
    slowReads = true
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })
    expect(heldReads, 'the poll tick sent no read').toHaveLength(1)
    const start = frames.length
    await submitSecondOption()
    await hook(TOOK)
    await transcript([PROMPT_ROW, ASK_CALL, ASK_RESULT])
    await landReads(QUESTION_ON_SCREEN)
    expect(noticesIn(start), frames.slice(start).join(' → ')).toEqual([])
    // The next tick is the first look since the answer.
    screen = ANSWERED_ON_SCREEN
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })
    expect(noticesIn(start), frames.slice(start).join(' → ')).toEqual([])
    expect(frames.at(-1)).toBe('nothing')
  })

  // The failure path: the look after the answer is the one that may speak.
  it("still says a menu is open when the screen read after the answer shows Claude's next question", async () => {
    // Claude Code 2.1.282's multi-select question (tmux, 2026-09-25), drawn
    // before its hook row reaches the phone: nothing gives it a card yet.
    const nextQuestion = readScreens('claude-screen-ask-multi-select-2.1.282.txt').ask!
    await questionUp()
    slowReadsAfterWrite = true
    await submitSecondOption()
    await hook(TOOK)
    await transcript([PROMPT_ROW, ASK_CALL, ASK_RESULT])
    const start = frames.length
    await landReads(nextQuestion)
    expect(frames.slice(start).at(-1)).toBe('terminal notice (screen menu)')
  })

  it('says nothing about the answered dialog while the host will not read the screen again', async () => {
    await questionUp()
    slowReadsAfterWrite = true
    const start = frames.length
    await submitSecondOption()
    await hook(TOOK)
    await transcript([PROMPT_ROW, ASK_CALL, ASK_RESULT])
    await landReads(null)
    expect(noticesIn(start), frames.slice(start).join(' → ')).toEqual([])
    expect(frames.at(-1)).toBe('nothing')
  })
})

// The same shape on an approval whose card comes from the hook row, not the
// screen: the screen reader does not know the plan review, so the card leaves
// with the row while the read that saw the review stays.
// Claude Code 2.1.276's plan review, `claude --permission-mode plan`, tmux
// capture on 2026-09-18 (mobile-native-chat-permission-send.test.ts).
const PLAN_REVIEW_ON_SCREEN = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   ❯ 1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]
/** What the same session drew once the review was approved (quoted there). */
const PLAN_APPROVED_ON_SCREEN = [
  "⏺ User approved Claude's plan",
  '  ⎿  Plan saved to: ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md · /plan to edit',
  '  ⏸ manual mode on · ← for agents'
]
const PLAN = { plan: 'Print hello to stdout with echo hello.' }
const PLAN_STARTS: Row = { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: PLAN, tool_use_id: 'toolu_plan' }
const PLAN_ASKS: Row = { ...PLAN_STARTS, hook_event_name: 'PermissionRequest' }
const PLAN_TAKEN: Row = { ...PLAN_STARTS, hook_event_name: 'PostToolUse', tool_response: 'User has approved your plan.' }

describe("the dock after approving Claude Code 2.1.276's plan review", () => {
  it('does not flash "Waiting for approval in the terminal" before the screen is read again', async () => {
    screen = PLAN_REVIEW_ON_SCREEN
    await hook(TURN)
    await hook(PLAN_STARTS)
    await hook(PLAN_ASKS)
    expect(frames.at(-1)).toBe('approval card')
    slowReadsAfterWrite = true
    const start = frames.length
    await act(async () => {
      expect(await permissionProps!.onRespond('1')).toBe(true)
    })
    expect(writes).toEqual(['1'])
    await hook(PLAN_TAKEN)
    await landReads(PLAN_APPROVED_ON_SCREEN)
    expect(noticesIn(start), frames.slice(start).join(' → ')).toEqual([])
    expect(frames.at(-1)).toBe('nothing')
  })
})
