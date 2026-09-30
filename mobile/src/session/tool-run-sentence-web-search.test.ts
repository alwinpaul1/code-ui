import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'

// A lone WebSearch read "Fetched a page", and a WebSearch beside a WebFetch
// "Fetched 2 pages", although the search fetched nothing: one noun covered
// both tools (review, 2026-09-30). A search now reads as a search, a fetch as
// a fetch, and a run of both names both.

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

describe('a web search reads as a search, a page fetch as a fetch', () => {
  it('reads a lone WebSearch as "Searched the web", not a page it never fetched', () => {
    expect(toolRunSentence(search())).toBe('Searched the web')
  })

  it('names both when a run searches and then fetches a page', () => {
    expect(toolRunSentence([...search(), ...fetchPage()])).toBe('Searched the web, fetched a page')
    expect(toolRunSentence([...fetchPage(), ...search()])).toBe('Fetched a page, searched the web')
  })

  it('counts several searches and several fetches each on their own', () => {
    expect(toolRunSentence([...search('a'), ...search('b')])).toBe('Searched the web 2 times')
    expect(toolRunSentence([...fetchPage('https://a.dev/'), ...fetchPage('https://b.dev/')])).toBe(
      'Fetched 2 pages'
    )
    expect(
      toolRunSentence([...search('a'), ...fetchPage(), ...search('b'), ...search('c')])
    ).toBe('Searched the web 3 times, fetched a page')
  })

  it("reads Codex's web search the same way", () => {
    for (const name of ['web_search', 'web search', 'websearch']) {
      expect(toolRunSentence([call(name, { query: 'x' }), result()])).toBe('Searched the web')
    }
    expect(toolCallKind('web_search')).toBe(toolCallKind('WebSearch'))
    expect(toolCallKind('web_search')).not.toBe(toolCallKind('WebFetch'))
  })

  it('counts a failed search against the search', () => {
    expect(toolRunSentence([call('WebSearch', { query: 'x' }), result(true), ...fetchPage()])).toBe(
      'Searched the web (1 failed), fetched a page'
    )
  })

  it('keeps grep-style searches apart from web searches', () => {
    expect(toolRunSentence([call('Grep', { pattern: 'x' }), result(), ...search()])).toBe(
      'Searched once, searched the web'
    )
  })
})
