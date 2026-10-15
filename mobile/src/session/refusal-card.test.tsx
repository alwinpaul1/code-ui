import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTextBlock, type NativeChatTextBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { resetCcrRefusalExpandedForTests } from './ccr-refusal-expanded'
import { resetCcrRefusalRetryForTests, useCcrRefusalRetryHost } from './ccr-refusal-retry'
import { prompt, refusalFallback, refusalNoFallback } from './fixtures/ccr-refusal-suggestion-events-2.1.300'
import { isRenderableNativeChatNotice } from './mobile-native-chat-notice-kind'
import { MobileNativeChatNoticeRow } from './MobileNativeChatNoticeRow'

// G10: the refusal cards as the Claude app 1.261013.20 draws them (np30.java, op30.java), from
// Claude Code 2.1.300's events (never captured live, fixtures/ccr-refusal-suggestion-events-2.1.300.ts).

const openURL = vi.fn(async (_url: string) => true)
vi.mock('react-native', () => ({
  Linking: { openURL: (url: string) => openURL(url) },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => Object.fromEntries(['AlertCircle', 'AlertTriangle', 'ChevronDown', 'ChevronRight', 'Info'].map((name) => [name, name])))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

function blockOf(events: Parameters<typeof decodeCcrEvents>[0]): NativeChatTextBlock {
  const row = decodeCcrEvents(events, new WeakMap()).at(-1)!
  const block = row.blocks[0]!
  if (!isTextBlock(block)) {
    throw new Error('not a text block')
  }
  return block
}

const SWITCHED = blockOf([prompt('u-refused', 'Scan my server'), refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: 'cyber', refused: 'u-refused' })])
const PAUSED = blockOf([prompt('u-refused', 'Scan my server'), refusalNoFallback({ original: 'claude-opus-5', category: 'bio', refused: 'u-refused' })])

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetCcrRefusalRetryForTests()
  resetCcrRefusalExpandedForTests()
  openURL.mockClear()
})

function Host(props: { rewindTo?: (uuid: string) => Promise<string | null>; setComposerText: (text: string) => void; onSendError: (message: string) => void }) {
  useCcrRefusalRetryHost({ rewindTo: props.rewindTo, setComposerText: props.setComposerText, onSendError: props.onSendError })
  return null
}

function render(block: NativeChatTextBlock, scheme: 'light' | 'dark' = 'light', host?: Parameters<typeof Host>[0]) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {host ? <Host {...host} /> : null}
        <MobileNativeChatNoticeRow block={block} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const byId = (root: ReactTestInstance, id: string) => root.findAll((node) => node.props.testID === id && typeof node.type === 'string')
const words = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : words(child))).join('')
const colorOf = (node: ReactTestInstance): unknown => [node.props.style].flat(3).reduce((found: unknown, style) => (style && typeof style === 'object' && 'color' in style ? style.color : found), undefined)

describe('a refusal card in a matched Claude tab', () => {
  it('is drawn as a card, not as prose', () => {
    expect(isRenderableNativeChatNotice(SWITCHED)).toBe(true)
    expect(isRenderableNativeChatNotice(PAUSED)).toBe(true)
  })

  it.each(['light', 'dark'] as const)('the switch notice reads "Switched to Sonnet 5" and opens its reason on Why? in the theme’s colours (%s)', (scheme) => {
    const root = render(SWITCHED, scheme)
    const colors = scheme === 'light' ? lightColors : darkColors
    expect(words(byId(root, 'refusal-text')[0]!)).toBe('Switched to Sonnet 5')
    expect(colorOf(byId(root, 'refusal-text')[0]!)).toBe(colors.textSecondary)
    expect(byId(root, 'refusal-reason')).toHaveLength(0)
    expect(words(byId(root, 'refusal-why')[0]!)).toContain('Why?')
    act(() => byId(root, 'refusal-why')[0]!.props.onPress())
    expect(words(byId(root, 'refusal-reason')[0]!)).toBe(
      'Opus 5 has specific safety measures that flag messages with cybersecurity topics. Switched to Sonnet 5. Learn moreDetails: [cyber]'
    )
    expect(words(byId(root, 'refusal-why')[0]!)).toContain('Hide')
    act(() => byId(root, 'refusal-learn-more')[0]!.props.onPress())
    expect(openURL).toHaveBeenCalledWith('https://support.claude.com/articles/15363606')
  })

  it.each(['light', 'dark'] as const)('the paused notice reads "Session paused: …" with its category (%s)', (scheme) => {
    const root = render(PAUSED, scheme)
    const colors = scheme === 'light' ? lightColors : darkColors
    expect(words(byId(root, 'refusal-text')[0]!)).toBe(
      'Session paused: Opus 5’s safety measures flagged this message for sensitive biology topics. To continue, switch to a different model or continue by editing your prompt on web or desktop.'
    )
    expect(colorOf(byId(root, 'refusal-details')[0]!)).toBe(colors.textMuted)
  })

  it('offers no Edit and retry while the control lane cannot rewind the session', () => {
    expect(byId(render(PAUSED), 'refusal-edit-and-retry')).toHaveLength(0)
    expect(byId(render(SWITCHED), 'refusal-edit-and-retry')).toHaveLength(0)
  })

  it('Edit and retry rewinds to the refused prompt, then puts its words back in the composer', async () => {
    const rewindTo = vi.fn(async () => null)
    const setComposerText = vi.fn()
    const root = render(PAUSED, 'light', { rewindTo, setComposerText, onSendError: vi.fn() })
    // Offered, the body takes the app's rewindable wording.
    expect(words(byId(root, 'refusal-text')[0]!)).toContain('You can edit your prompt and try again, or switch to a different model.')
    await act(async () => byId(root, 'refusal-edit-and-retry')[0]!.props.onPress())
    expect(rewindTo).toHaveBeenCalledWith('u-refused')
    expect(setComposerText).toHaveBeenCalledWith('Scan my server')
  })

  it('a rewind the session refused says so and leaves the composer alone', async () => {
    const setComposerText = vi.fn()
    const onSendError = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const root = render(SWITCHED, 'light', { rewindTo: async () => 'Couldn’t rewind the conversation. The session is unchanged.', setComposerText, onSendError })
    await act(async () => byId(root, 'refusal-edit-and-retry')[0]!.props.onPress())
    expect(onSendError).toHaveBeenCalledWith('Couldn’t rewind the conversation. The session is unchanged.')
    expect(setComposerText).not.toHaveBeenCalled()
    expect(warn.mock.calls[0]![0]).toContain('rewind_conversation to u-refused failed')
    warn.mockRestore()
  })

  // Review 2026-10-15: the list virtualises its rows, so a card scrolled out and back is a new
  // mount, and an opened Why? came back closed. The open state is keyed by the row's id now.
  it('keeps Why? open across an unmount and remount of the same row', () => {
    let root = render(SWITCHED)
    act(() => byId(root, 'refusal-why')[0]!.props.onPress())
    expect(byId(root, 'refusal-reason')).toHaveLength(1)
    act(() => renderer?.unmount())
    root = render(SWITCHED)
    expect(byId(root, 'refusal-reason')).toHaveLength(1)
    expect(words(byId(root, 'refusal-why')[0]!)).toContain('Hide')
    act(() => byId(root, 'refusal-why')[0]!.props.onPress())
    act(() => renderer?.unmount())
    expect(byId(render(SWITCHED), 'refusal-reason')).toHaveLength(0)
  })

  it('opening one card’s Why? leaves another card closed', () => {
    const other = blockOf([prompt('u-other', 'Scan it again'), refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: 'cyber', refused: 'u-other' })])
    const root = render(SWITCHED)
    act(() => byId(root, 'refusal-why')[0]!.props.onPress())
    act(() => renderer?.unmount())
    expect(byId(render(other), 'refusal-reason')).toHaveLength(0)
  })

  it('a refusal whose prompt is not loaded offers no Edit and retry even with the lane live', () => {
    const orphan = blockOf([refusalNoFallback({ original: 'claude-opus-5', refused: 'u-not-loaded' })])
    const root = render(orphan, 'light', { rewindTo: async () => null, setComposerText: vi.fn(), onSendError: vi.fn() })
    expect(byId(root, 'refusal-edit-and-retry')).toHaveLength(0)
  })
})
