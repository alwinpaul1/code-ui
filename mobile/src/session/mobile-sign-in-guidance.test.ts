// Orca #26544 (ff4a51c872): every native-chat agent gets its own sign-in step, on a transcript row the
// phone re-words from the fact and on a refusal the phone words itself. Adapted from upstream's
// src/shared/agent-session-sign-in.test.ts, which this app does not run: this build's failure fact
// has no `account`, so the managed-account case is not here (a host fact carrying one is not read
// whole, and the row keeps the host's own sentence: the last case).
import { describe, expect, it } from 'vitest'
import { agentSessionFailureSentence } from '../../../src/shared/agent-session-failure-words'
import { structuredAgentSessionStatusBlock } from '../../../src/shared/structured-agent-session-status-block'
import type { AgentJournalStatusItem } from '../../../src/shared/agent-session-journal-types'

describe('sign-in guidance for every native chat agent', () => {
  it.each([
    ['Claude', 'claude auth login'],
    ['Codex', 'codex login'],
    ['Grok', 'grok login'],
    ['OpenCode', 'opencode auth login'],
    ['Pi', 'pi'],
    ['OMP', 'Sign in to OMP.']
  ])('names %s and its own sign-in command', (agentName, command) => {
    const fact = {
      kind: 'notSignedIn',
      detail: { text: 'The configured provider has no API key.', audience: 'person' }
    } as const
    const row = agentSessionFailureSentence(fact, 'row', { agentName })
    const rejection = agentSessionFailureSentence(fact, 'rejection', { agentName })
    expect(row).toContain(command)
    expect(rejection).toContain(command)
    expect(row).toContain(fact.detail.text)
    expect(rejection).toContain(fact.detail.text)
    expect(row).not.toContain('send your message again')
    expect(row).not.toContain('selected account')
    if (agentName === 'Pi') {
      expect(row).toContain('`/login`')
    }
  })

  it.each([
    ['Missing key', 'Missing key. Then send your message again.'],
    ['Missing key!', 'Missing key! Then send your message again.'],
    ['“Missing key?”', '“Missing key?” Then send your message again.'],
    ['Missing key。', 'Missing key。Then send your message again.']
  ])('separates the send-again step after the provider detail %j', (detail, tail) => {
    expect(
      agentSessionFailureSentence(
        { kind: 'notSignedIn', detail: { text: detail, audience: 'person' } },
        'rejection',
        { agentName: 'Pi' }
      )
    ).toBe(`Sign in to Pi by running \`pi\` and using \`/login\` on the computer running this chat. ${tail}`)
  })

  it('keeps log-only detail off the sentence and an unknown agent generic', () => {
    const detail = 'No API key found for {{agent}}'
    expect(
      agentSessionFailureSentence({ kind: 'notSignedIn', detail: { text: detail, audience: 'log' } }, 'row', {
        agentName: 'Pi'
      })
    ).not.toContain(detail)
    expect(agentSessionFailureSentence({ kind: 'notSignedIn' }, 'rejection')).toBe(
      'The agent is not signed in. Sign in, then send your message again.'
    )
    expect(
      agentSessionFailureSentence({ kind: 'notSignedIn' }, 'rejection', { agentName: 'Codex', command: 'clear' })
    ).toBe("Codex isn't signed in. Run `codex login`. Run /clear again.")
  })

  it('re-words a sign-in row only when it read the whole fact, else keeps the host sentence', () => {
    const body = (failure: unknown): AgentJournalStatusItem =>
      ({ kind: 'status', tone: 'error', text: 'Host words.', failure }) as AgentJournalStatusItem
    expect(structuredAgentSessionStatusBlock(body({ kind: 'notSignedIn' })).failure).toEqual({
      kind: 'notSignedIn'
    })
    // A newer host's fact names the account; this build cannot read it whole, so no fact is kept.
    expect(
      structuredAgentSessionStatusBlock(body({ kind: 'notSignedIn', account: 'managed' })).failure
    ).toBeUndefined()
  })
})
