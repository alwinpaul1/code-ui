import { describe, expect, it } from 'vitest'
import { nativeChatAgentFromTranscriptPath } from './mobile-native-chat-session-agent'

// Real paths, copied off this machine 2026-09-14 rather than invented: an
// invented fixture agrees with an invented matcher and both stay wrong.
const CLAUDE_TRANSCRIPT =
  '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/' +
  '11ab2e5b-269d-41ec-ac14-6f4cd692eead.jsonl'
const CODEX_TRANSCRIPT =
  '/Users/alwinpaul/.codex/sessions/2026/09/11/' +
  'rollout-2026-09-11T02-42-13-01a08dea-3c89-78e0-b629-04a87f33c43e.jsonl'

describe('naming the agent that wrote a captured transcript', () => {
  it('reads Claude Code off its own projects layout', () => {
    expect(nativeChatAgentFromTranscriptPath(CLAUDE_TRANSCRIPT)).toBe('claude')
  })

  it('reads Codex off its own rollout layout', () => {
    expect(nativeChatAgentFromTranscriptPath(CODEX_TRANSCRIPT)).toBe('codex')
  })

  it('reads the same layouts when a Windows host reports them with backslashes', () => {
    expect(
      nativeChatAgentFromTranscriptPath(
        'C:\\Users\\alwinpaul\\.claude\\projects\\-C--repo\\11ab2e5b.jsonl'
      )
    ).toBe('claude')
  })

  it('says nothing about a transcript it does not recognise', () => {
    // Grok and omp disclose no transcript path at all, and Pi writes its own
    // session file elsewhere; picking the likelier agent here would point a
    // Claude reader at another agent's real session file.
    expect(nativeChatAgentFromTranscriptPath('/tmp/pi-session-1.jsonl')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.gemini/tmp/chat.jsonl')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath(null)).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('')).toBeNull()
  })

  it('refuses a directory or a truncated path that only shares the prefix', () => {
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.claude/projects')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.claude/projects/-repo')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.codex/sessions/2026')).toBeNull()
  })
})
