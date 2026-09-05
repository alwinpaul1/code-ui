import { describe, expect, it } from 'vitest'
import {
  forgetSessionTab,
  pickNextSessionTabAfterClose,
  recordSessionTabVisit
} from './mobile-session-tab-history'

const tabs = (...ids: string[]) => ids.map((id) => ({ id }))

describe('session tab history (#15219)', () => {
  it('returns to the previously viewed tab after closing the current one', () => {
    const history: string[] = []
    recordSessionTabVisit(history, 'terminal')
    recordSessionTabVisit(history, 'doc-a')
    recordSessionTabVisit(history, 'doc-b')

    const next = pickNextSessionTabAfterClose(tabs('terminal', 'doc-a'), history, 'doc-b')
    expect(next?.id).toBe('doc-a')
  })

  it('skips history entries that are no longer open', () => {
    const history = ['terminal', 'gone', 'doc-b']
    const next = pickNextSessionTabAfterClose(tabs('terminal', 'doc-c'), history, 'doc-b')
    expect(next?.id).toBe('terminal')
  })

  it('falls back to the most recently added remaining tab without history', () => {
    const next = pickNextSessionTabAfterClose(tabs('a', 'b', 'c'), [], 'b')
    expect(next?.id).toBe('c')
  })

  it('returns null when nothing remains', () => {
    expect(pickNextSessionTabAfterClose([], ['a'], 'a')).toBeNull()
  })

  it('re-visiting a tab moves it to the front of recency', () => {
    const history: string[] = []
    recordSessionTabVisit(history, 'a')
    recordSessionTabVisit(history, 'b')
    recordSessionTabVisit(history, 'a')
    expect(history).toEqual(['b', 'a'])
    forgetSessionTab(history, 'a')
    expect(history).toEqual(['b'])
  })

  it('ignores empty ids and caps the history', () => {
    const history: string[] = []
    recordSessionTabVisit(history, null)
    recordSessionTabVisit(history, undefined)
    for (let index = 0; index < 100; index += 1) {
      recordSessionTabVisit(history, `t${index}`)
    }
    expect(history.length).toBe(64)
    expect(history[history.length - 1]).toBe('t99')
  })
})
