import { createElement, type ReactNode, type ComponentType } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'

/** The provider as these tests mount it: createElement passes its child as the third argument. */
const Themed = ThemeProvider as unknown as ComponentType<{ initialPreference: 'light' | 'dark'; children?: ReactNode }>
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  // The card sizes its reading area against the window so a long prompt cannot
  // push the choices off a short screen.
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))

vi.mock('lucide-react-native', () => ({
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  ShieldQuestion: 'ShieldQuestion',
  X: 'X'
}))
vi.mock('../components/TextInputModal', () => ({ TextInputModal: 'TextInputModal' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

/**
 * The Claude app 1.261009.20 draws a request it has no special face for as
 * its arguments (uuy): name over value, the first six, each value cut at 150
 * characters, then "+ N more arguments" and "Show full input" / "Show less".
 * Ours drew the structured lane's detail, the tool input as one JSON line, as
 * prose.
 */
describe('a tool input on a permission card', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  /** A Slack MCP search's input, Claude Code 2.1.291 (tool_use
   *  toolu_01YDmfR9D3WwDRMHMf3LE2EQ, a session on this machine, 2026-10-06). */
  const SLACK_SEARCH_2_1_291 = {
    filters: 'from:<@U0A0Q634T50>',
    after: '1791205200',
    natural_language_query: '',
    sort: 'timestamp',
    sort_dir: 'asc',
    include_context: false,
    response_format: 'concise',
    limit: 20
  }
  /** A WebFetch's input, Claude Code 2.1.239 (a session on this machine, 2026-08-22). */
  const WEB_FETCH_2_1_239 = {
    url: 'https://hermes-agent.nousresearch.com/docs/',
    prompt:
      'List the full documentation table of contents / all guide pages with their URLs. Also give the installation instructions (install command, requirements) and how to run the gateway/service.'
  }
  const OPTIONS = [
    { label: 'Yes', send: '1' },
    { label: 'No', send: '2' }
  ]

  function render(title: string, detail: string, scheme: 'light' | 'dark' = 'light'): void {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(
          Themed,
          { initialPreference: scheme },
          createElement(MobileNativeChatPermission, {
            permission: { title, detail, options: OPTIONS },
            onRespond: vi.fn(async () => true)
          })
        )
      )
    })
  }
  const block = () => renderer!.root.findAllByProps({ testID: 'native-chat-approval-raw-args' })
  const texts = (): string[] =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === 'string')
  const toggle = () =>
    renderer!.root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        (node.props.accessibilityLabel === 'Show full input' || node.props.accessibilityLabel === 'Show less') &&
        typeof node.props.onPress === 'function'
    )[0]!

  it('lists a Slack search’s eight arguments six at a time, then "+ 2 more arguments" and Show full input', () => {
    render('Allow slack_search_public_and_private?', JSON.stringify(SLACK_SEARCH_2_1_291))
    expect(block()).toHaveLength(1)
    const names = Object.keys(SLACK_SEARCH_2_1_291)
    expect(names.slice(0, 6).every((name) => texts().includes(name))).toBe(true)
    expect(texts()).not.toContain('response_format')
    expect(texts()).toContain('+ 2 more arguments')
    expect(texts()).toContain('Show full input')
    // The JSON slab is not drawn beside it.
    expect(texts().some((text) => text.startsWith('{"filters"'))).toBe(false)

    act(() => toggle().props.onPress())
    expect(names.every((name) => texts().includes(name))).toBe(true)
    expect(texts()).not.toContain('+ 2 more arguments')
    expect(texts()).toContain('Show less')
    expect(texts()).toContain('false')
  })

  it('cuts a long value at 150 characters until Show full input', () => {
    render('Allow WebFetch?', JSON.stringify(WEB_FETCH_2_1_239))
    const folded = `${WEB_FETCH_2_1_239.prompt.slice(0, 150)}…`
    expect(texts()).toContain(folded)
    expect(texts()).not.toContain(WEB_FETCH_2_1_239.prompt)
    act(() => toggle().props.onPress())
    expect(texts()).toContain(WEB_FETCH_2_1_239.prompt)
  })

  it('offers no toggle when every argument already shows whole', () => {
    render('Allow WebFetch?', JSON.stringify({ url: WEB_FETCH_2_1_239.url }))
    expect(block()).toHaveLength(1)
    expect(texts()).not.toContain('Show full input')
  })

  it('keeps the text it always had for a detail the host clipped', () => {
    const json = JSON.stringify(SLACK_SEARCH_2_1_291)
    render('Allow slack_search_public_and_private?', `${json.slice(0, 60)}\n[Orca: output truncated — 9000 bytes total, digest 0123456789ab]`)
    expect(block()).toHaveLength(0)
  })

  it('leaves an Edit ask to its diff', () => {
    render(
      'Allow Edit?',
      JSON.stringify({ file_path: '/w/src/app.ts', old_string: 'const b = 2', new_string: 'const b = 9', replace_all: false })
    )
    expect(block()).toHaveLength(0)
  })

  // Codex 0.153.4's approval reaches the card as the TUI's words, not a JSON
  // input (mobile-native-chat-dialog-guard.test.ts): nothing to list.
  it('leaves a Codex approval’s words as they were', () => {
    render(
      'Would you like to run the following command?',
      'Environment: local\nReason: May I run the full test suite, including the local WebSocket integration tests?\n$ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1'
    )
    expect(block()).toHaveLength(0)
  })

  it.each(['light', 'dark'] as const)('sits in the sunken block and the theme’s inks, in %s', (scheme) => {
    const palette = scheme === 'dark' ? darkColors : lightColors
    render('Allow WebFetch?', JSON.stringify(WEB_FETCH_2_1_239), scheme)
    const scroller = block()[0]!.findByType('ScrollView' as never)
    expect([scroller.props.style].flat(Infinity)).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: palette.bgSunken })])
    )
    const colorOf = (text: string): string | undefined => {
      const node = renderer!.root.findAllByType('Text' as never).find((entry) => entry.props.children === text)
      const styles = [node?.props.style].flat(Infinity) as { color?: string }[]
      return styles.reduce<string | undefined>((found, entry) => entry?.color ?? found, undefined)
    }
    expect(colorOf('url')).toBe(palette.textSecondary)
    expect(colorOf(WEB_FETCH_2_1_239.url)).toBe(palette.text)
  })
})
