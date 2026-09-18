import { describe, expect, it } from 'vitest'
import {
  subagentTranscriptBodyState,
  subagentTranscriptPath,
  subagentTranscriptTarget
} from './mobile-subagent-transcript'

/**
 * Claude Code writes each subagent's transcript beside its parent's:
 *   ~/.claude/projects/<slug>/<parentSessionId>.jsonl              the parent
 *   ~/.claude/projects/<slug>/<parentSessionId>/subagents/agent-<id>.jsonl
 * Layout verified on this machine on 2026-09-18 (Claude Code 2.1.275): the
 * `agentId: <id>` in the Agent tool's result is exactly the `<id>` in the file
 * name, and every record in the file carries `isSidechain: true` and that
 * `agentId`.
 *
 * The host's reader was exercised against the LIVE Orca (1.4.201 running,
 * 1.4.205 bundle on disk) the same day, through the CLI's unix socket:
 *   - `nativeChat.readSession{agent:'claude', transcriptPath:<subagent file>}`
 *     reads that file (2 messages for a finished agent, a 40-message tail with
 *     `hasMore` for a live one).
 *   - An ABSENT subagent path does NOT come back `notFound` when `sessionId`
 *     is the parent's: the host falls back to a by-session-id lookup and
 *     returns the PARENT transcript. A viewer would then paint the parent
 *     conversation under the subagent's title.
 *   - With `sessionId: 'agent-<id>'` an absent file comes back
 *     `{error:'Transcript unavailable', notFound:true}`, and the same key with
 *     no `transcriptPath` at all still finds `subagents/agent-<id>.jsonl`,
 *     because the host's by-id walk is recursive. The bare id (no `agent-`)
 *     finds nothing.
 * So the session id the phone hands the host is `agent-<id>`: it can only ever
 * name the subagent's own file.
 */
const PARENT = '/Users/me/.claude/projects/-Users-me-Desktop-Project/5d877e39-1867-424f-86b5-c080713c1563.jsonl'
const AGENT_ID = 'a68211cb9358e29c3'
const SUBAGENT =
  '/Users/me/.claude/projects/-Users-me-Desktop-Project/5d877e39-1867-424f-86b5-c080713c1563/subagents/agent-a68211cb9358e29c3.jsonl'

describe('locating a subagent transcript', () => {
  it('derives the subagent file next to the parent transcript', () => {
    expect(subagentTranscriptPath(PARENT, AGENT_ID)).toBe(SUBAGENT)
  })

  it('keeps a Windows host\'s separators', () => {
    expect(
      subagentTranscriptPath(
        'C:\\Users\\me\\.claude\\projects\\C--Users-me-proj\\5d877e39.jsonl',
        AGENT_ID
      )
    ).toBe(
      'C:\\Users\\me\\.claude\\projects\\C--Users-me-proj\\5d877e39\\subagents\\agent-a68211cb9358e29c3.jsonl'
    )
  })

  it('refuses a parent path that is not a .jsonl transcript', () => {
    expect(subagentTranscriptPath('/Users/me/.claude/projects/x/5d877e39', AGENT_ID)).toBeNull()
    expect(subagentTranscriptPath('/Users/me/.claude/projects/x/5d877e39.meta.json', AGENT_ID)).toBeNull()
    expect(subagentTranscriptPath('', AGENT_ID)).toBeNull()
  })

  // The id goes into a file path the host opens. Anything outside the id
  // alphabet the roster reader accepts is refused, not escaped.
  it.each(['', ' ', '../5d877e39', 'a68211cb/9358e29c3', 'a68211cb\\9358', 'agent-a68211cb9358e29c3'])(
    'refuses the id %j',
    (id) => {
      expect(subagentTranscriptPath(PARENT, id)).toBeNull()
    }
  )
})

describe('the tap target on a roster row', () => {
  const agentRow = { id: AGENT_ID, kind: 'agent' as const, title: 'Port the subagent viewer' }

  it('reads a Claude subagent by the key the host can only match to its own file', () => {
    expect(
      subagentTranscriptTarget({ agent: 'claude', task: agentRow, parentTranscriptPath: PARENT })
    ).toEqual({
      agent: 'claude',
      agentId: AGENT_ID,
      sessionId: 'agent-a68211cb9358e29c3',
      transcriptPath: SUBAGENT,
      title: 'Port the subagent viewer'
    })
  })

  it('never hands the host the parent session id, so an unwritten agent cannot come back as the parent', () => {
    const target = subagentTranscriptTarget({
      agent: 'claude',
      task: agentRow,
      parentTranscriptPath: PARENT
    })
    expect(target?.sessionId).not.toBe('5d877e39-1867-424f-86b5-c080713c1563')
    expect(target?.sessionId).toMatch(/^agent-/)
  })

  it('leaves the path to the host when the parent transcript is unknown', () => {
    expect(
      subagentTranscriptTarget({ agent: 'claude', task: agentRow, parentTranscriptPath: null })
    ).toMatchObject({ sessionId: 'agent-a68211cb9358e29c3', transcriptPath: null })
  })

  it('gives a Codex roster no tap target: Codex has no subagents', () => {
    expect(
      subagentTranscriptTarget({ agent: 'codex', task: agentRow, parentTranscriptPath: null })
    ).toBeNull()
    expect(
      subagentTranscriptTarget({ agent: null, task: agentRow, parentTranscriptPath: PARENT })
    ).toBeNull()
  })

  it.each(['shell', 'monitor', 'workflow', 'unknown'] as const)(
    'gives a %s row no tap target',
    (kind) => {
      expect(
        subagentTranscriptTarget({
          agent: 'claude',
          task: { id: 'bzp6f42la', kind, title: 'pnpm build' },
          parentTranscriptPath: PARENT
        })
      ).toBeNull()
    }
  )

  it('refuses a placeholder row the phone invented rather than the agent', () => {
    expect(
      subagentTranscriptTarget({
        agent: 'claude',
        task: { id: 'onscreen-shell-0', kind: 'agent', title: 'Background shell' },
        parentTranscriptPath: PARENT
      })
    ).toBeNull()
  })
})

describe('what the viewer body shows', () => {
  it('shows nothing written yet for an absent file, never an error', () => {
    expect(subagentTranscriptBodyState({ status: 'awaiting-transcript', messageCount: 0 })).toEqual({
      kind: 'nothing-yet'
    })
  })

  it('shows nothing written yet for a settled read with no turns', () => {
    expect(subagentTranscriptBodyState({ status: 'ready', messageCount: 0 })).toEqual({
      kind: 'nothing-yet'
    })
  })

  it('spins only while the first read is still open', () => {
    expect(subagentTranscriptBodyState({ status: 'loading', messageCount: 0 })).toEqual({
      kind: 'loading'
    })
    expect(subagentTranscriptBodyState({ status: 'idle', messageCount: 0 })).toEqual({
      kind: 'loading'
    })
    expect(subagentTranscriptBodyState({ status: 'waiting-session', messageCount: 0 })).toEqual({
      kind: 'loading'
    })
  })

  it('keeps the turns it has over an error card', () => {
    expect(
      subagentTranscriptBodyState({ status: 'error', messageCount: 3, error: 'socket closed' })
    ).toEqual({ kind: 'messages' })
    expect(subagentTranscriptBodyState({ status: 'ready', messageCount: 1 })).toEqual({
      kind: 'messages'
    })
  })

  it('names the failure inline when there is nothing else to show', () => {
    expect(
      subagentTranscriptBodyState({ status: 'error', messageCount: 0, error: 'socket closed' })
    ).toEqual({ kind: 'error', message: 'socket closed' })
    expect(subagentTranscriptBodyState({ status: 'error', messageCount: 0 })).toEqual({
      kind: 'error',
      message: 'The desktop could not read this transcript.'
    })
  })
})
