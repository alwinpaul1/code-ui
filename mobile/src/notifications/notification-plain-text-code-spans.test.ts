import { describe, expect, it } from 'vitest'
import { notificationPlainText, styleText } from './notification-plain-text'

const mono = (text: string) => styleText(text, 'mono')

// The shade read the links in a line before its code spans, so a call written
// as code, `handlers[name](args)`, read as a link: it came out as mono
// "handlersname", brackets and "(args)" gone. The chat draws the span
// literally; a code span binds tighter than a link (CommonMark), so the link
// rule no longer sees inside one (review, 2026-09-30).
describe('a link-shaped call inside a code span in the shade', () => {
  it('keeps the call whole, in the code style', () => {
    expect(notificationPlainText('Fixed `handlers[name](args)` in the router')).toBe(
      `Fixed ${mono('handlers[name](args)')} in the router`
    )
    expect(notificationPlainText('call `arr[i](x)` now')).toBe(`call ${mono('arr[i](x)')} now`)
    expect(notificationPlainText('see `[a](b)` here')).toBe(`see ${mono('[a](b)')} here`)
  })

  it('keeps a code span that is the whole body', () => {
    expect(notificationPlainText('`[a](b)`')).toBe(mono('[a](b)'))
  })

  it('still reads the words of a link that hold code', () => {
    expect(notificationPlainText('[`x`](https://x.dev)')).toBe(mono('x'))
    expect(notificationPlainText('see [the `parse` fix](https://x.dev/1) now')).toBe(
      `see the ${mono('parse')} fix now`
    )
  })

  it('reads a link beside a code span', () => {
    expect(notificationPlainText('`a` [b](c) `d`')).toBe(`${mono('a')} b ${mono('d')}`)
  })

  it('reads a link after a backtick that closes nothing, which stays as typed', () => {
    expect(notificationPlainText('a `b [c](d)')).toBe('a `b c')
  })
})
