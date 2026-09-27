import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileSyntaxLanguage } from './use-mobile-syntax-language'

const seen: string[] = []
function Probe({ content }: { content: string }) {
  seen.push(useMobileSyntaxLanguage('bin/deploy', content))
  return null
}

let r: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  seen.length = 0
})
afterEach(() => {
  act(() => r?.unmount())
  vi.useRealTimers()
})

// An edit in the first 4 KB is a new key, read again a tick later; in that
// tick the file fell back to plain, so its document was built twice and
// its folds reset (review, 2026-09-27).
describe('an unnamed script edited near its top', () => {
  it('keeps its language while the edit is read again, never drawing it plain in between', () => {
    const script = '#!/usr/bin/env bash\nset -e\necho one\n'
    act(() => {
      r = create(createElement(Probe, { content: script }))
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(seen.at(-1)).toBe('bash')
    seen.length = 0
    act(() => {
      r!.update(createElement(Probe, { content: script.replace('one', 'two') }))
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(seen).toEqual(['bash'])
  })
})
