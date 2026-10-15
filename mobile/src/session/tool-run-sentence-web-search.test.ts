import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'

// A lone WebSearch read "Fetched a page" (review, 2026-09-30). The Claude app
// (1.261013.20) counts WebSearch and WebFetch as one category, "Browsed the
// web" (`ccr_summary_web`), and names a lone call by its own target: a search
// by its query, a fetch by its URL (`xpz.a`).

function call(name: string, input: Record<string, unknown>): NativeChatBlock {
  return { type: 'tool-call', name, input }
}
function result(isError = false): NativeChatBlock {
  return { type: 'tool-result', output: 'ok', ...(isError ? { isError: true } : {}) }
}

// Claude Code's own tools: WebSearch takes a `query`, WebFetch a `url` and a
// `prompt`.
const search = (query = 'expo sdk 55 release notes'): NativeChatBlock[] => [
  call('WebSearch', { query }),
  result()
]
const fetchPage = (url = 'https://docs.expo.dev/'): NativeChatBlock[] => [
  call('WebFetch', { url, prompt: 'Summarise the page' }),
  result()
]

describe('a web search and a page fetch read in the Claude app words', () => {
  it('reads a lone WebSearch by its query, never as a page it fetched', () => {
    expect(toolRunSentence(search())).toBe('Searched web expo sdk 55 release notes')
  })

  it('reads a lone WebFetch by its URL', () => {
    expect(toolRunSentence(fetchPage())).toBe('Fetched https://docs.expo.dev/')
  })

  it('reads searches and fetches together as "Browsed the web", in either order', () => {
    expect(toolRunSentence([...search(), ...fetchPage()])).toBe('Browsed the web')
    expect(toolRunSentence([...fetchPage(), ...search()])).toBe('Browsed the web')
    expect(toolRunSentence([...search('a'), ...search('b')])).toBe('Browsed the web')
  })

  it("reads Codex's web search the same way", () => {
    for (const name of ['web_search', 'web search', 'websearch']) {
      expect(toolRunSentence([call(name, { query: 'x' }), result()])).toBe('Searched web x')
    }
    expect(toolCallKind('web_search')).toBe(toolCallKind('WebSearch'))
    expect(toolCallKind('web_search')).not.toBe(toolCallKind('WebFetch'))
  })

  it('counts a failed search against the web', () => {
    expect(toolRunSentence([call('WebSearch', { query: 'x' }), result(true), ...fetchPage()])).toBe(
      'Browsed the web (1 failed)'
    )
  })

  it('keeps grep-style searches apart from web searches', () => {
    expect(toolRunSentence([call('Grep', { pattern: 'x' }), result(), ...search()])).toBe(
      'Searched code, browsed the web'
    )
  })
})
