import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildNativeChatVisualDocument,
  NATIVE_CHAT_VISUAL_PING_TYPE,
  NATIVE_CHAT_VISUAL_PONG_TYPE
} from '../../../src/shared/native-chat-visual-shell'
import { buildMobileNativeChatVisualHostDocument } from './mobile-native-chat-visual-host-document'

// Orca #26729 (7b91405547): an in-page link (`#details`, a `#/route`) inside a chat visual
// switches sections instead of doing nothing. Two things stopped it on the phone: the srcdoc
// page resolved `#x` against the host page, and WebKit fires a second `load` for an in-page
// navigation, which the host page read as the frame leaving its document and removed the
// visual ("escaped"). Now the visual keeps an `about:srcdoc` base, and a later load is asked
// whether the shell still runs before the frame is taken away.

const CHANNEL = 'orca-visual-channel-1'
const TOKEN = 'host-token-1'

type Listener = (event: unknown) => void

/** Runs the host page's one script against a stub DOM and hands back its frame and the app's inbox. */
function runHostPage(pongTimeoutMs = 50) {
  const html = buildMobileNativeChatVisualHostDocument({
    visualDocument: '<p>hi</p>',
    channel: CHANNEL,
    token: TOKEN,
    title: 'Visual',
    mode: 'inline',
    pongTimeoutMs
  })
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'))
  const toApp: unknown[] = []
  const frameListeners: Record<string, Listener[]> = {}
  const windowListeners: Record<string, Listener[]> = {}
  const childWindow = { postMessage: vi.fn() }
  const frame = {
    removed: false,
    style: {} as Record<string, string>,
    contentWindow: childWindow,
    srcdoc: '',
    setAttribute: () => {},
    addEventListener: (type: string, listener: Listener) => {
      ;(frameListeners[type] ??= []).push(listener)
    },
    remove() {
      this.removed = true
    }
  }
  const fakeWindow = {
    ReactNativeWebView: { postMessage: (message: string) => toApp.push(JSON.parse(message)) },
    addEventListener: (type: string, listener: Listener) => {
      ;(windowListeners[type] ??= []).push(listener)
    }
  }
  const fakeDocument = {
    createElement: () => frame,
    body: { appendChild: () => {} },
    activeElement: null
  }
  new Function('window', 'document', 'navigator', script)(fakeWindow, fakeDocument, {})
  return {
    frame,
    childWindow,
    toApp,
    load: () => frameListeners.load?.forEach((listener) => listener({})),
    fromChild: (data: unknown) =>
      windowListeners.message?.forEach((listener) => listener({ source: childWindow, data }))
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('an in-page link inside a chat visual on the phone', () => {
  it('keeps the visual when the shell answers the load an in-page link fires', () => {
    vi.useFakeTimers()
    const page = runHostPage()
    page.load()
    page.load()
    expect(page.childWindow.postMessage).toHaveBeenCalledWith(
      { type: NATIVE_CHAT_VISUAL_PING_TYPE, channel: CHANNEL, id: 2 },
      '*'
    )
    page.fromChild({ type: NATIVE_CHAT_VISUAL_PONG_TYPE, channel: CHANNEL, id: 2 })
    vi.advanceTimersByTime(1_000)
    expect(page.frame.removed).toBe(false)
    expect(page.toApp).toEqual([])
  })

  it('still removes a frame whose document stopped answering, and says so', () => {
    vi.useFakeTimers()
    const page = runHostPage()
    page.load()
    page.load()
    vi.advanceTimersByTime(49)
    expect(page.frame.removed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.frame.removed).toBe(true)
    expect(page.toApp).toEqual([{ kind: 'escaped', token: TOKEN }])
  })

  it('takes no answer from another channel or for an older load', () => {
    vi.useFakeTimers()
    const page = runHostPage()
    page.load()
    page.load()
    page.fromChild({ type: NATIVE_CHAT_VISUAL_PONG_TYPE, channel: 'other', id: 2 })
    page.fromChild({ type: NATIVE_CHAT_VISUAL_PONG_TYPE, channel: CHANNEL, id: 1 })
    vi.advanceTimersByTime(50)
    expect(page.frame.removed).toBe(true)
  })

  it('gives the visual an about:srcdoc base ahead of its policy, which then refuses any other', () => {
    const document = buildNativeChatVisualDocument({
      html: '<p>hi</p>',
      channel: CHANNEL,
      theme: { colorScheme: 'light', tokens: {} }
    })
    const base = document.indexOf('<base href="about:srcdoc">')
    expect(base).toBeGreaterThan(-1)
    expect(base).toBeLessThan(document.indexOf('Content-Security-Policy'))
    expect(document).toContain("base-uri 'none'")
  })

  it("lets the host page admit that base, since the srcdoc child inherits the host's policy", () => {
    const html = buildMobileNativeChatVisualHostDocument({
      visualDocument: '<p>hi</p>',
      channel: CHANNEL,
      token: TOKEN,
      title: 'Visual',
      mode: 'inline'
    })
    expect(html).toContain('base-uri about:')
    expect(html).not.toContain("base-uri 'none'")
  })
})
