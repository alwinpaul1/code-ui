import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_WHICH_LOGO,
  CODEX_REQUEST_USER_INPUT,
  clippedByHost
} from './ask-user-question-fixtures'
import { lookupPendingPrompt } from './permission-lookup'
import {
  markMobileNativeChatTerminalHalfStepped,
  mobileNativeChatTerminalHalfStep,
  resetMobileNativeChatTerminalWritesForTests
} from '../session/mobile-native-chat-terminal-write-lock'

const ESCAPE = String.fromCharCode(27)

function approval(tool: string, summary?: string): string {
  return JSON.stringify({ approval: { tool, ...(summary ? { summary } : {}) } })
}

type Reply = { ok: boolean; result?: unknown }

function makeClient(
  replies: { terminals?: Reply; status?: (handle: string) => Reply },
  state = 'connected'
) {
  const calls: { method: string; params: unknown }[] = []
  const client = {
    getState: () => state,
    sendRequest: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params })
      if (method === 'terminal.list') {
        return replies.terminals ?? { ok: true, result: { terminals: [] } }
      }
      const handle = (params as { terminal: string }).terminal
      return replies.status?.(handle) ?? { ok: true, result: {} }
    })
  } as unknown as RpcClient
  return { client, calls }
}

const TWO_TERMINALS: Reply = {
  ok: true,
  result: {
    terminals: [
      { handle: 'plain-shell' },
      { handle: 'agent-1', agentIdentity: 'claude' },
      { handle: 'agent-2', agentIdentity: 'claude' }
    ]
  }
}

/**
 * The notification event carries a title, a body and some ids — nothing about
 * what is being asked. The desktop HAS it (`agentToolName` and `agentToolInput`
 * are on NotificationDispatchRequest) and does not forward it, and the desktop
 * is stock Orca. So the phone has to go and ask, and it can: the notification
 * arrived over the link, so the link is up.
 */
describe('finding the permission a notification is about', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the prompt out of the agent terminal', async () => {
    const { client } = makeClient({
      terminals: TWO_TERMINALS,
      status: (handle) =>
        handle === 'agent-1'
          ? { ok: true, result: { agentStatus: { state: 'waiting', interactivePrompt: approval('Bash', 'Recompile page 2') } } }
          : { ok: true, result: { agentStatus: {} } }
    })
    expect(await lookupPendingPrompt(client, 'wt-1')).toEqual({
      kind: 'permission',
      terminal: 'agent-1',
      agent: 'claude',
      permission: {
        title: 'Allow Bash?',
        detail: 'Recompile page 2',
        options: [
          { label: 'Allow', send: '1' },
          { label: 'Deny', send: ESCAPE }
        ]
      }
    })
  })

  it('asks only terminals the host says are running an agent', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS })
    await lookupPendingPrompt(client, 'wt-1')
    const asked = calls.filter((c) => c.method === 'terminal.agentStatus').map((c) => c.params)
    expect(asked).toEqual([{ terminal: 'agent-1' }, { terminal: 'agent-2' }])
  })

  it('stops at the first terminal that is actually waiting', async () => {
    const { client, calls } = makeClient({
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { state: 'waiting', interactivePrompt: approval('Edit') } } })
    })
    await lookupPendingPrompt(client, 'wt-1')
    expect(calls.filter((c) => c.method === 'terminal.agentStatus')).toHaveLength(1)
  })

  // A stale handle answers for a PTY that has gone, and the prompt it reports
  // belongs to nothing.
  it('asks the host to exclude dead PTYs', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS })
    await lookupPendingPrompt(client, 'wt-1')
    expect(calls[0]).toEqual({
      method: 'terminal.list',
      params: { worktree: 'wt-1', requireFreshPtyLiveness: true }
    })
  })

  /**
   * Every failure path returns null and the caller keeps the desktop's own
   * notification. A decorated banner is an improvement, never a requirement —
   * a permission ask that never appeared because a lookup threw would be far
   * worse than the plain caption it replaces.
   */
  it.each([
    ['the host refuses the listing', { terminals: { ok: false } as Reply }],
    ['the listing is empty', { terminals: { ok: true, result: { terminals: [] } } as Reply }],
    ['no terminal is running an agent', { terminals: { ok: true, result: { terminals: [{ handle: 'sh' }] } } as Reply }],
    ['nothing is waiting', { terminals: TWO_TERMINALS }],
    ['the prompt is neither an approval nor a question', {
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { state: 'waiting', interactivePrompt: '{"question":{}}' } } }) as Reply
    }],
    ['the question has no questions in it', {
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { state: 'waiting', interactivePrompt: '{"questions":[]}' } } }) as Reply
    }],
    // The host clips `interactivePrompt` at 16,000 characters (Orca 1.4.205's
    // status sanitizer: `interactivePrompt: i.i(t.interactivePrompt, 16e3)`), so a
    // question with long option previews arrives cut mid-JSON. This fixture is
    // cut the same way — mid-string, at its own midpoint. No question is the
    // right answer: a banner built from half the options would offer the wrong ones.
    ['the question was clipped by the host', {
      terminals: TWO_TERMINALS,
      status: () => ({
        ok: true,
        result: {
          agentStatus: {
            state: 'waiting',
            interactivePrompt: clippedByHost(JSON.stringify(ASK_USER_QUESTION_WHICH_LOGO))
          }
        }
      }) as Reply
    }],
    ['the prompt is malformed', {
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { state: 'waiting', interactivePrompt: '{not json' } } }) as Reply
    }]
  ])('returns nothing when %s', async (_label, replies) => {
    const { client } = makeClient(replies as Parameters<typeof makeClient>[0])
    expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
  })

  /**
   * "❓ Claude needs input · NexOS / main — Using AskUserQuestion" in the shade
   * with no buttons (Galaxy S23, 2026-09-18). The lookup only knew one prompt
   * shape, the approval envelope, and a question is the other thing an agent
   * waits on. The host puts the tool's raw input on `interactivePrompt` for a
   * question tool, which is exactly what the chat card already parses.
   */
  describe('a question the agent is waiting on', () => {
    it('reads a Claude AskUserQuestion out of the agent terminal, with who is asking', async () => {
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: (handle) =>
          handle === 'agent-1'
            ? {
                ok: true,
                result: {
                  agentStatus: {
                    state: 'waiting',
                    interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING)
                  }
                }
              }
            : { ok: true, result: { agentStatus: {} } }
      })
      expect(await lookupPendingPrompt(client, 'wt-1')).toEqual({
        kind: 'question',
        terminal: 'agent-1',
        agent: 'claude',
        prompt: {
          questions: [
            {
              question:
                'Codex only reports context via /status, not continuously. How should the context indicator work?',
              header: 'Context ring',
              multiSelect: false,
              options: [
                {
                  label: 'Tap to refresh',
                  description:
                    'A small context chip that runs /status on tap and shows "N% left (used/total)" once. Not live, but real data on demand.'
                },
                {
                  label: 'Skip it for Codex',
                  description:
                    "Leave the context ring out for Codex since it can't stream live like Claude. Cleaner, no /status noise in the transcript."
                }
              ]
            }
          ]
        }
      })
    })

    // Codex's request_user_input takes the same road on the host: Orca's `jt()`
    // accepts `requestuserinput` beside `askuserquestion`, and the Codex reducer
    // stringifies the tool input the same way. The agent comes back with it so
    // the answer can use Codex's keystrokes, which differ from Claude's.
    it('reads a Codex request_user_input the same way, naming Codex', async () => {
      const { client } = makeClient({
        terminals: {
          ok: true,
          result: { terminals: [{ handle: 'codex-1', agentIdentity: 'codex' }] }
        },
        status: () => ({
          ok: true,
          result: {
            agentStatus: { state: 'waiting', interactivePrompt: JSON.stringify(CODEX_REQUEST_USER_INPUT) }
          }
        })
      })
      expect(await lookupPendingPrompt(client, 'wt-1')).toEqual({
        kind: 'question',
        terminal: 'codex-1',
        agent: 'codex',
        prompt: {
          questions: [
            {
              question: 'Which color do you prefer: red or blue?',
              header: 'Color',
              multiSelect: false,
              options: [{ label: 'Blue', description: 'Choose blue.' }]
            }
          ]
        }
      })
    })

    it('keeps the previews a newer Claude puts on an option out of the prompt', async () => {
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: () => ({
          ok: true,
          result: {
            agentStatus: { state: 'waiting', interactivePrompt: JSON.stringify(ASK_USER_QUESTION_WHICH_LOGO) }
          }
        })
      })
      const pending = await lookupPendingPrompt(client, 'wt-1')
      expect(pending?.kind).toBe('question')
      expect(pending?.kind === 'question' && pending.prompt.questions[0]!.options).toEqual([
        { label: 'The app icon', description: expect.stringContaining('launcher') },
        { label: 'The agent session chip', description: expect.stringContaining('pill') },
        { label: 'The notification icon tint', description: expect.stringContaining('shade') }
      ])
    })

    // The clip is real: 16,000 characters on the host, and this cut has the same
    // shape (mid-string). Half a question is no question.
    it('returns nothing for a question the host clipped mid-JSON', async () => {
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: () => ({
          ok: true,
          result: {
            agentStatus: {
              interactivePrompt: clippedByHost(JSON.stringify(ASK_USER_QUESTION_WHICH_LOGO))
            }
          }
        })
      })
      expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
    })
  })

  /**
   * The host keeps `interactivePrompt` STICKY after the prompt is answered: the
   * approval envelope and the question both outlive their answer on the status
   * row (STA-3144), which is why the chat card only surfaces them while the
   * agent is waiting or blocked (use-mobile-native-chat-prompts.ts). A lookup
   * that read the prompt alone found one minutes after the desk had answered,
   * and a button tapped then would have written a digit into a live composer
   * to ride along with the next real message (review finding F2, 2026-09-18).
   *
   * Not verified on a live host: every terminal to hand was hand-started with
   * no agentStatus at all. The gate is on the card's evidence.
   */
  describe('a prompt that outlived its answer', () => {
    function withState(state: string | undefined, interactivePrompt: string) {
      return makeClient({
        terminals: TWO_TERMINALS,
        status: () => ({
          ok: true,
          result: {
            agentStatus: { ...(state === undefined ? {} : { state }), interactivePrompt }
          }
        })
      })
    }

    it.each(['working', 'done', 'idle'])(
      'finds no question while the agent is %s, whatever the status row still says',
      async (state) => {
        const { client } = withState(state, JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING))
        expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
      }
    )

    it.each(['working', 'done'])('finds no permission while the agent is %s either', async (state) => {
      const { client } = withState(state, approval('Bash', 'rm -rf build'))
      expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
    })

    it('finds the prompt while the agent is blocked, as it does while waiting', async () => {
      const { client } = withState('blocked', JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING))
      expect((await lookupPendingPrompt(client, 'wt-1'))?.kind).toBe('question')
    })

    // A status row with no state is not one the host emits; refuse over guess.
    it('finds nothing when the status row does not say what state the agent is in', async () => {
      const { client } = withState(undefined, JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING))
      expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
    })

    // Two agents in one worktree: the one that already answered must not
    // shadow the one still asking.
    it('walks past a terminal whose prompt is stale to one that is still waiting', async () => {
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: (handle) => ({
          ok: true,
          result: {
            agentStatus: {
              state: handle === 'agent-1' ? 'working' : 'waiting',
              interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING)
            }
          }
        })
      })
      expect((await lookupPendingPrompt(client, 'wt-1'))?.terminal).toBe('agent-2')
    })
  })

  /**
   * A half-written reply marks its terminal so nothing retries into a moved
   * selector (F4). The mark is for the prompt that was being answered; once
   * the agent has left waiting/blocked — answered at the desk, timed out —
   * the selector is gone, and the lookup is the one place that sees the
   * state, so it lifts the mark.
   */
  describe('a terminal left half-stepped', () => {
    beforeEach(() => resetMobileNativeChatTerminalWritesForTests())

    it('is unmarked once the agent has left waiting', async () => {
      markMobileNativeChatTerminalHalfStepped('agent-1', { promptKey: 'q', detail: 'write 2/3' })
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: () => ({
          ok: true,
          result: {
            agentStatus: { state: 'working', interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING) }
          }
        })
      })
      await lookupPendingPrompt(client, 'wt-1')
      expect(mobileNativeChatTerminalHalfStep('agent-1')).toBeNull()
    })

    it('stays marked while the agent is still waiting on it', async () => {
      markMobileNativeChatTerminalHalfStepped('agent-1', { promptKey: 'q', detail: 'write 2/3' })
      const { client } = makeClient({
        terminals: TWO_TERMINALS,
        status: () => ({
          ok: true,
          result: {
            agentStatus: { state: 'waiting', interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING) }
          }
        })
      })
      await lookupPendingPrompt(client, 'wt-1')
      expect(mobileNativeChatTerminalHalfStep('agent-1')).not.toBeNull()
    })
  })

  it('does not throw when the request rejects', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(lookupPendingPrompt(client, 'wt-1')).resolves.toBeNull()
  })

  it('does not dial a host that is not connected', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS }, 'connecting')
    expect(await lookupPendingPrompt(client, 'wt-1')).toBeNull()
    expect(calls).toEqual([])
  })

  // Degenerate: a worktree with more agents than is worth waiting on.
  it('does not fan out over every agent in a busy worktree', async () => {
    const many = {
      ok: true,
      result: {
        terminals: Array.from({ length: 9 }, (_, i) => ({
          handle: `agent-${i}`,
          agentIdentity: 'claude'
        }))
      }
    }
    const { client, calls } = makeClient({ terminals: many })
    await lookupPendingPrompt(client, 'wt-1')
    expect(calls.filter((c) => c.method === 'terminal.agentStatus')).toHaveLength(4)
  })
})
