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

// Same review, swept: the code rule styled a span, then the bold, italic and
// strike rules ran over the styled text, whose marks were still in it. A
// code span's marks are its own, as the chat draws them; emphasis that holds
// a whole code span still styles the words around it.
describe('the marks inside a code span in the shade', () => {
  const bold = (text: string) => styleText(text, 'bold')
  const italic = (text: string) => styleText(text, 'italic')

  it('keeps the stars of a code span that holds them', () => {
    expect(notificationPlainText('use `a*b*c` here')).toBe(`use ${mono('a*b*c')} here`)
  })

  it('keeps the underscores of a dunder name in a code span', () => {
    expect(notificationPlainText('edit `__init__` now')).toBe(`edit ${mono('__init__')} now`)
  })

  it('keeps the tildes of a code span that holds them', () => {
    expect(notificationPlainText('the `~~x~~` mark')).toBe(`the ${mono('~~x~~')} mark`)
  })

  it('reads a two-backtick span holding a backtick as the chat does', () => {
    expect(notificationPlainText('``a`b`` done')).toBe(`${mono('a`b')} done`)
    // A run with no partner of its length is text.
    expect(notificationPlainText('type `` to open')).toBe('type `` to open')
  })

  it('still styles emphasis and strike that hold a whole code span', () => {
    expect(notificationPlainText('**Alphabetical `/` menu.**')).toBe(
      `${bold('Alphabetical ')}${mono('/')}${bold(' menu.')}`
    )
    expect(notificationPlainText('*see `x`*')).toBe(`${italic('see ')}${mono('x')}`)
    expect(notificationPlainText('~~drop `a~b`~~')).toBe(`drop ${mono('a~b')}`)
  })
})
