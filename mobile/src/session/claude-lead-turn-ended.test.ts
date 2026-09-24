import { describe, expect, it } from 'vitest'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { PANE_KEY } from '../../../src/shared/agent-hook-listener-test-harness'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { claudeLeadTurnEnded } from './claude-lead-turn-ended'
import {
  API_ERROR_HOST_STATUS,
  API_ERROR_TURN,
  BASH_OUTPUT,
  CONTINUE_PROMPT,
  REVIEWER_AGENT_ID,
  SAFEGUARDS_API_ERROR_TEXT,
  STOP_HOST_STATUS,
  STOP_REPLY_TEXT,
  STOP_TURN,
  WINDOWS_REVIEWER_AGENT_ID
} from './fixtures/claude-turn-end-2.1.281'

// The hook payloads Claude Code 2.1.281 builds (read out of its binary,
// 2026-09-24): StopFailure is `{hook_event_name, error, error_details,
// last_assistant_message}` and fires instead of Stop when the turn's last
// assistant record is an API error; Stop adds `background_tasks`, where a
// background Agent is `{type: "subagent", status: "running"}`.
const SESSION = { session_id: '967668df-a7d9-40e7-964b-7812815c010d' }

// Straight through `normalizeHookPayload`, as the vendored StopFailure test
// does: Claude's fold keeps its own lead, roster and tool state, and the
// vendored `normalizeAndAccept` harness predates the read-only status view.
function hostStatusAfter(events: Record<string, unknown>[]) {
  const state = createHookListenerState()
  let last: ReturnType<typeof normalizeHookPayload> = null
  for (const event of events) {
    const body = { paneKey: PANE_KEY, payload: { ...SESSION, ...event } }
    last = normalizeHookPayload(state, 'claude', body, 'production') ?? last
  }
  return last!.payload
}

const launch = (toolUseId: string, agentId: string, description: string) => [
  {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: toolUseId,
    tool_input: { description, subagent_type: 'general-purpose', run_in_background: true }
  },
  { hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: 'general-purpose' },
  { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { description } }
]

const afterApiError = () =>
  hostStatusAfter([
    { hook_event_name: 'UserPromptSubmit', prompt: 'Continue' },
    ...launch('toolu_016kspfCR9g72dZCaWpY578L', REVIEWER_AGENT_ID, 'Review mid-turn placement change'),
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_019buoCzXApHfgMJrJufZoMw', tool_input: { command: 'python3 - "$f"' } },
    {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_019buoCzXApHfgMJrJufZoMw',
      tool_input: { command: 'python3 - "$f"' },
      tool_response: { stdout: BASH_OUTPUT, stderr: '', interrupted: false, isImage: false }
    },
    { hook_event_name: 'StopFailure', error: 'invalid_request', last_assistant_message: SAFEGUARDS_API_ERROR_TEXT }
  ])

const afterStop = (reply = STOP_REPLY_TEXT) =>
  hostStatusAfter([
    { hook_event_name: 'UserPromptSubmit', prompt: 'Continue' },
    ...launch('toolu_015RynFNjL6GZGqYgkYNkDZ5', WINDOWS_REVIEWER_AGENT_ID, 'Review Windows host-control fixes'),
    {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: reply,
      background_tasks: [
        {
          id: WINDOWS_REVIEWER_AGENT_ID,
          type: 'subagent',
          status: 'running',
          description: 'Review Windows host-control fixes',
          agent_type: 'general-purpose'
        }
      ],
      session_crons: []
    }
  ])

const roster = (status: { subagents: { id: string; state: string }[] }) =>
  status.subagents.map(({ id, state }) => ({ id, state }))

// Why the phone has to read the transcript at all (docs/claude-app-parity.md
// item 7). These pass on the unfixed phone: they pin what the desktop says,
// the fact the fix stands on. `resolveClaudePaneStatus` answers a working
// child with plain `working`; only shells and crons get `monitoring`.
describe('what Orca reports once the lead turn ends under a background agent', () => {
  it('still says working, with no monitoring mode, after an API error ends the turn', () => {
    const status = afterApiError()
    expect(status.state).toBe('working')
    expect(status.workingMode).toBeUndefined()
    expect(status.lastAssistantMessage).toBe(API_ERROR_HOST_STATUS.lastAssistantMessage)
    expect(status.lastAssistantMessageIsToolOutput).toBe(API_ERROR_HOST_STATUS.lastAssistantMessageIsToolOutput)
    expect(roster({ subagents: status.subagents ?? [] })).toEqual(roster(API_ERROR_HOST_STATUS))
  })

  it('still says working, with no monitoring mode, after a normal Stop ends the turn', () => {
    const status = afterStop()
    expect(status.state).toBe('working')
    expect(status.workingMode).toBeUndefined()
    expect(status.lastAssistantMessage).toBe(STOP_HOST_STATUS.lastAssistantMessage)
    expect(status.lastAssistantMessageIsToolOutput).toBeUndefined()
    expect(roster({ subagents: status.subagents ?? [] })).toEqual(roster(STOP_HOST_STATUS))
  })
})

const notice: NativeChatMessage = {
  id: 'notice-1',
  role: 'system',
  timestamp: Date.parse('2026-09-23T23:01:14.813Z'),
  source: 'transcript',
  blocks: [{ type: 'text', text: 'Context compacted', tone: 'notice' }]
}

describe('the lead turn is over when the transcript says so', () => {
  it('ends at an API error with no status code that nothing followed', () => {
    expect(claudeLeadTurnEnded('claude', API_ERROR_TURN, afterApiError())).toBe(true)
  })

  it('ends at the reply the host says its Stop hook reported', () => {
    expect(claudeLeadTurnEnded('claude', STOP_TURN, afterStop())).toBe(true)
  })

  it('goes on once a prompt follows the API error', () => {
    expect(claudeLeadTurnEnded('claude', [...API_ERROR_TURN, CONTINUE_PROMPT], afterApiError())).toBe(false)
  })

  it('goes on after a note the host has not reported a Stop for', () => {
    // Line 7310, written 14 s before the Agent call that followed it: prose
    // that is the newest row for a moment is not yet a turn end.
    const note: NativeChatMessage = {
      id: 'fba92384-d842-4b42-b9b7-0a5040273b32',
      role: 'assistant',
      timestamp: Date.parse('2026-09-23T21:56:45.681Z'),
      source: 'transcript',
      blocks: [
        {
          type: 'text',
          text: 'Lint is clean and the gate is green: 1168 files, 11,934 tests, with the PowerShell tests run. This changes the probe\'s parsing, so a second reviewer checks it before I commit:'
        }
      ]
    }
    const midTurn = hostStatusAfter([
      { hook_event_name: 'UserPromptSubmit', prompt: 'Continue' },
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_x', tool_input: { command: 'npx oxlint' } },
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'toolu_x',
        tool_input: { command: 'npx oxlint' },
        tool_response: { stdout: 'Found 0 warnings and 0 errors.', stderr: '', interrupted: false, isImage: false }
      }
    ])
    expect(midTurn.state).toBe('working')
    expect(claudeLeadTurnEnded('claude', [note], midTurn)).toBe(false)
  })

  it('does not take tool output that matches the reply for a Stop', () => {
    expect(
      claudeLeadTurnEnded('claude', STOP_TURN, { lastAssistantMessage: STOP_REPLY_TEXT, lastAssistantMessageIsToolOutput: true })
    ).toBe(false)
  })

  it('goes on while a tool call is the newest row', () => {
    expect(claudeLeadTurnEnded('claude', API_ERROR_TURN.slice(0, 3), afterApiError())).toBe(false)
  })

  it('looks past host rows drawn after the error', () => {
    expect(claudeLeadTurnEnded('claude', [...API_ERROR_TURN, notice], afterApiError())).toBe(true)
  })

  it('ends at a reply longer than the host keeps, compared as the host cut it', () => {
    const long = `${STOP_REPLY_TEXT}\n\n\n\n${'x'.repeat(9000)}`
    const reply: NativeChatMessage = { ...STOP_TURN[2]!, blocks: [{ type: 'text', text: long }] }
    const status = afterStop(long)
    expect(status.lastAssistantMessage?.length).toBeLessThan(long.length)
    expect(claudeLeadTurnEnded('claude', [...STOP_TURN.slice(0, 2), reply], status)).toBe(true)
  })

  it('refuses for an agent whose errors and hooks it has not read', () => {
    expect(claudeLeadTurnEnded('codex', API_ERROR_TURN, afterApiError())).toBe(false)
    expect(claudeLeadTurnEnded(null, STOP_TURN, afterStop())).toBe(false)
  })

  it('refuses on no rows, or only host rows', () => {
    expect(claudeLeadTurnEnded('claude', [], afterStop())).toBe(false)
    expect(claudeLeadTurnEnded('claude', [notice], afterStop())).toBe(false)
  })

  it('ends at an API error that is the only row', () => {
    expect(claudeLeadTurnEnded('claude', API_ERROR_TURN.slice(-1), null)).toBe(true)
  })
})
