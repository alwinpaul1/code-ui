import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// STRUCTURE, not behaviour: which value each pill reads. A source test is the
// only instrument for "the composer's sheet and the header pill read the SAME
// fallback", because a render of the controller would need the whole chat
// stack. Comments are stripped first so prose cannot satisfy the match.
const code = (file: string) =>
  readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the model pills read the fallback with the session command pair laid over it', () => {
  it('feeds the chat rows to the fallback hook, which every pill reads', () => {
    expect(code('./use-mobile-native-chat-controller.ts')).toMatch(/useClaudeTranscriptModel\(\{[^}]*messages: nativeChatSession\.messages \}\)/)
  })
  it('lays the pair over the resolved fallback and never over a live pair or a bare chat', () => {
    const hook = code('./use-claude-transcript-model.ts')
    expect(hook).toMatch(/quiet \? withSessionCommandPair\(resolveClaudeModelFallback\(/)
    expect(hook).toMatch(/quiet && messages \? sessionCommandPair\(messages\) : null/)
  })
  it('lets the composer sheet draw the effort the fallback carries', () => {
    expect(code('./use-mobile-native-chat-session-option-controller.ts')).toMatch(
      /effort: transcriptModel\.effort \?\? null/
    )
  })
})
