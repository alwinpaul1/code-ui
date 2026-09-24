// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RICH_MARKDOWN_HOST_CLASS,
  applyRichMarkdownWebDocumentTheme,
  mountRichMarkdownWebDocument,
  type RichMarkdownWebDocument
} from './rich-markdown-web-document-mount'
import type { MobileRichMarkdownEditorMessage } from '../mobile-rich-markdown-editor-contract'
import { darkColors, lightColors } from '../../theme/tokens'

const DARK = { colors: darkColors, scheme: 'dark' as const }

/**
 * The page's mount of the editor document, as a unit.
 *
 * What it owns is everything between the component and the factory: the sheet planted once per
 * page and reaching only inside the host, the markup the document reads its surface out of, and
 * the dispose that has to leave the page as it found it. Rulings 20 and 21 are the point of the
 * last one — a second mount must not inherit the first's listeners, and the first's must not go on
 * reporting into a host that has gone.
 *
 * What a browser makes of the sheet is not a question this environment can answer and is measured
 * in `config/scripts/mobile-web-app-rich-markdown-render.test.mjs` instead.
 */
const mounted: RichMarkdownWebDocument[] = []

function mount(posts: MobileRichMarkdownEditorMessage[] = [], url: string | null = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const live = mountRichMarkdownWebDocument(
    host,
    {
      postToHost: (message) => posts.push(message),
      promptForUrl: () => Promise.resolve(url)
    },
    DARK
  )
  mounted.push(live)
  return { host, live, posts }
}

const surfaceIn = (host: HTMLElement) => host.querySelector<HTMLElement>('#editor')

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()!.dispose()
  }
  vi.restoreAllMocks()
})

describe('the editor document mounted in the page', () => {
  // 2026-09-24: the page editor read the static dark palette. The page's one
  // sheet is written in whichever theme the first editor opened in, so each
  // host carries the theme in use itself, and follows a switch.
  it('draws in the theme in use, and follows a switch while open', () => {
    const { host } = mount()
    expect(host.style.getPropertyValue('--background')).toBe(darkColors.bg)
    applyRichMarkdownWebDocumentTheme(host, { colors: lightColors, scheme: 'light' })
    expect(host.style.getPropertyValue('--background')).toBe(lightColors.bg)
    expect(host.style.getPropertyValue('--foreground')).toBe(lightColors.text)
    expect(host.style.getPropertyValue('color-scheme')).toBe('light')
  })

  it('plants the markup in the host and reports itself ready through the seam', () => {
    const { host, posts } = mount()
    expect(surfaceIn(host)?.getAttribute('contenteditable')).toBe('true')
    expect(posts).toEqual([{ type: 'ready' }])
    // Never the shell's bridge: on the page that object is the host's own channel.
    expect(window.ReactNativeWebView).toBeUndefined()
  })

  it('never reports a keyboard inset, because the screen measures the same viewport', () => {
    // The seam supplies no source, so the document has nothing to observe and nothing to post. A
    // report here would lift the screen's own bar a second time.
    const { posts } = mount()
    window.dispatchEvent(new Event('resize'))
    expect(posts.filter((message) => message.type === 'keyboardInset')).toEqual([])
  })

  it('injects one sheet for the page, held entirely under the host class', () => {
    mount()
    mount()
    const sheets = document.querySelectorAll('#orca-rich-markdown-document-style')
    expect(sheets).toHaveLength(1)
    const text = sheets[0]!.textContent ?? ''
    expect(text.length).toBeGreaterThan(1000)
    const selectors = [...text.matchAll(/(?:^|\})\s*([^{}]+)\{/g)].flatMap((match) =>
      match[1]!.split(',').map((one) => one.trim())
    )
    expect(selectors.length).toBeGreaterThan(40)
    expect(selectors.filter((one) => !one.startsWith(`.${RICH_MARKDOWN_HOST_CLASS}`))).toEqual([])
  })

  it('gives the host back on dispose, so every rule of the sheet matches nothing', () => {
    const { host, live } = mount()
    expect(host.classList.contains(RICH_MARKDOWN_HOST_CLASS)).toBe(true)
    live.dispose()
    mounted.pop()
    expect(host.innerHTML).toBe('')
    expect(host.classList.contains(RICH_MARKDOWN_HOST_CLASS)).toBe(false)
  })

  it('leaves no listener of the first mount reporting into the second', () => {
    const first = mount()
    const firstSurface = surfaceIn(first.host)!
    first.live.dispose()
    mounted.pop()
    first.posts.length = 0

    const second = mount()
    second.posts.length = 0
    surfaceIn(second.host)!.innerHTML = '<p>second</p>'
    surfaceIn(second.host)!.dispatchEvent(new Event('input', { bubbles: true }))

    expect(second.posts).toEqual([{ type: 'change', markdown: 'second', generation: 0 }])
    // The precondition the empty list needs: the detached surface is still an element events can
    // be dispatched on, so nothing reporting from it is the listeners being gone rather than the
    // event never happening.
    firstSurface.innerHTML = '<p>first</p>'
    firstSurface.dispatchEvent(new Event('input', { bubbles: true }))
    expect(first.posts).toEqual([])
  })

  it('gives the host back when the document fails to start, rather than leaving a dead one', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    // The one failure the start sequence has: a surface it cannot read. Faked at the element read
    // rather than at the factory, so the unwind under test is the real one.
    vi.spyOn(host, 'querySelector').mockReturnValue(null)

    expect(() =>
      mountRichMarkdownWebDocument(
        host,
        {
          postToHost: () => {},
          promptForUrl: () => Promise.resolve(null)
        },
        DARK
      )
    ).toThrow()
    expect(host.innerHTML).toBe('')
    expect(host.classList.contains(RICH_MARKDOWN_HOST_CLASS)).toBe(false)
  })

  it('answers the URL commands from the host rather than from a dialog the shell never shows', async () => {
    // `execCommand` is the browser's and happy-dom has none, so what the command *does* is the
    // render check's to measure; what this can say is that the URL comes from the host's seam and
    // reaches the command with it.
    const executed: [string, string | undefined][] = []
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string, _ui: boolean, value?: string) => {
        executed.push([command, value])
        return true
      }
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const promptForUrl = vi.fn(() => Promise.resolve('https://example.com/a'))
    const live = mountRichMarkdownWebDocument(host, { postToHost: () => {}, promptForUrl }, DARK)
    mounted.push(live)

    await live.send.runCommand('image')

    expect(promptForUrl.mock.calls).toEqual([['image']])
    expect(executed).toContainEqual(['insertImage', 'https://example.com/a'])
  })

  it('runs nothing when the host cancels, which is what the shell used to do for every URL', async () => {
    const executed: string[] = []
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        executed.push(command)
        return true
      }
    })
    const { live } = mount([], null)
    await live.send.runCommand('link')
    expect(executed).toEqual([])
  })
})
