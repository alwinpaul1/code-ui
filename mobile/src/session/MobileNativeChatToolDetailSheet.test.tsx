import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { MAX_TOOL_DETAIL_LENGTH } from '../../../src/shared/native-chat-tool-summary'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { SEND_MESSAGE_BY_ID_2026_09_26 } from './fixtures/claude-send-message-2026-09-26'
import { ToolDetailBody, ToolDetailHeader } from './MobileNativeChatToolDetailSheet'

// The header/body are tested apart from `DraggableDetailSheet`, the same way
// `MobileBackgroundTasksSheetBody` is tested apart from `BottomDrawer` —
// neither content component touches reanimated or the sheet's pans; the
// body's one gesture is the output text's own (mocked below).
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// Same reason `MobileBackgroundTasksSheet.test.tsx` mocks out `BottomDrawer`:
// the drawer shell pulls in reanimated's Flow-typed RN internals, which Node
// cannot parse, and the content under test never touches it.
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileMarkdown: (props: { content: string; textScale?: number }) =>
      h('MobileMarkdown', { content: props.content, textScale: props.textScale })
  }
})
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))
vi.mock('../components/DraggableDetailSheet', () => ({
  DraggableDetailSheet: 'DraggableDetailSheet'
}))
// The shared gesture-handler mock hands back one untyped builder for every
// gesture; this one keeps the kind, so a test can tell a Native gesture from
// a Pan. Any configuration call still returns the same builder.
vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react')
  const builder = (kind: string): unknown => {
    const self: unknown = new Proxy({}, { get: (_, key) => (key === 'kind' ? kind : () => self) })
    return self
  }
  return {
    Gesture: { Native: () => builder('native'), Pan: () => builder('pan'), Tap: () => builder('tap') },
    GestureDetector: (props: Record<string, unknown>) => h('GestureDetector', props)
  }
})

const SEND_MESSAGE_PAIR: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'SendMessage',
    input: {
      to: 'a8f65c53ecfad2908',
      type: 'handback',
      content: 'Finished the fix.',
      summary: 'Fixed the count.',
      recipient: 'peer',
      message: 'Done'
    }
  },
  result: { type: 'tool-result', output: '{"ok":true}' }
}

// `Txt` is a composite wrapper around a host `Text`; both carry whatever
// `testID` its caller passed, so `findByProps` is ambiguous between them and
// `.props.style` off the wrong one is `undefined` (the composite never
// received a `style` prop at all — only the host's merged array has color).
// `findAllByType('Text')` keeps this to the host node the mock actually
// renders.
function findTextNode(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByType('Text' as never).find((node) => node.props.testID === testID)!
}

function findText(renderer: ReactTestRenderer, testID: string): string {
  const children = findTextNode(renderer, testID).props.children
  return Array.isArray(children) ? children.join('') : String(children)
}

function textColor(renderer: ReactTestRenderer, testID: string): string | undefined {
  const style = findTextNode(renderer, testID).props.style
  const entries = Array.isArray(style) ? style : [style]
  return entries.find((entry: { color?: string } | null) => entry?.color)?.color
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  const entries = (Array.isArray(style) ? style : [style]) as (Record<string, unknown> | null | undefined)[]
  return Object.assign({}, ...entries.filter(Boolean))
}

// The first host element above `node`, skipping composites like `Txt`: the
// view a gesture-handler detector would attach its handler to.
function nearestHostAncestor(node: ReactTestInstance): ReactTestInstance | null {
  let current = node.parent
  while (current && typeof current.type !== 'string') {
    current = current.parent
  }
  return current
}

function renderTree(children: React.ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer!
}

describe('tool detail header: title and status', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('titles a SendMessage by its recipient alone, with Completed as the status', () => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: SEND_MESSAGE_PAIR }))
    // The Claude app's sheet title (2026-09-26): "Messaged @<to>", no summary.
    expect(findText(renderer, 'tool-detail-title')).toBe('Messaged @a8f65c53ecfad2908')
    expect(findText(renderer, 'tool-detail-status')).toBe('Completed')
  })

  // 2026-09-26 screenshots: the Claude app centres the title, on one line, with
  // the status centred under it, and the close cross on the left. Code UI had
  // both left-aligned, clear of a cross on the right.
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('centres the title on one line and the status under it (%s)', (scheme, colors) => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: SEND_MESSAGE_BY_ID_2026_09_26 }), scheme)
    expect(findText(renderer, 'tool-detail-title')).toBe('Messaged @a07ea6f616a8e32a1')
    const title = findTextNode(renderer, 'tool-detail-title')
    expect(title.props.numberOfLines).toBe(1)
    expect(flatStyle(title).textAlign).toBe('center')
    expect(flatStyle(findTextNode(renderer, 'tool-detail-status')).textAlign).toBe('center')
    // Centred on the sheet, not in the space beside the cross: equal room both sides.
    const box = flatStyle(nearestHostAncestor(title)!)
    const left = box.paddingLeft ?? box.paddingHorizontal ?? 0
    const right = box.paddingRight ?? box.paddingHorizontal ?? 0
    expect(left).toBeGreaterThan(0)
    expect(right).toBe(left)
    expect(textColor(renderer, 'tool-detail-title')).toBe(colors.text)
    expect(textColor(renderer, 'tool-detail-status')).toBe(colors.textSecondary)
  })

  it('shows Failed in the danger tone, in both light and dark', () => {
    const failed: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'false' } },
      result: { type: 'tool-result', output: 'exit 1', isError: true }
    }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: failed }))
    expect(findText(renderer, 'tool-detail-status')).toBe('Failed')
    expect(textColor(renderer, 'tool-detail-status')).toBe(lightColors.danger)
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailHeader, { pair: failed }), 'dark')
    expect(textColor(renderer, 'tool-detail-status')).toBe(darkColors.danger)
  })
})

describe('tool detail body: Inputs and Output', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)(
    "draws a SendMessage's message as Markdown, not as raw marks, in %s",
    (scheme) => {
      const pair = {
        ...SEND_MESSAGE_PAIR,
        call: { ...SEND_MESSAGE_PAIR.call!, input: { to: 'a4a57562399d1a73c', message: '1. **CONFIRMED:** `a.ts:220`', summary: 's', type: 'message' } }
      } as NativeChatToolPair
      renderer = renderTree(createElement(ToolDetailBody, { pair }), scheme)
      const markdown = renderer.root.findAllByType('MobileMarkdown' as never)
      expect(markdown.map((node) => node.props.content)).toEqual(['1. **CONFIRMED:** `a.ts:220`'])
      // The other inputs stay plain text rows.
      const plain = renderer.root.findAllByType('Text' as never).map((node) => node.props.children)
      expect(plain).toContain('a4a57562399d1a73c')
      expect(plain).not.toContain('1. **CONFIRMED:** `a.ts:220`')
    }
  )

  it('lists every input by name, alphabetically, the evidenced SendMessage order', () => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }))
    const names = renderer.root
      .findAllByProps({ testID: 'tool-detail-section' })
      .map((row) => row.findAllByType('Text' as never)[0]!.props.children)
      .filter((name) => name !== 'Output')
    expect(names).toEqual(['content', 'message', 'recipient', 'summary', 'to', 'type'])
  })

  it('shows the raw output and no Prettify pill when it is not JSON', () => {
    const plain: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      result: { type: 'tool-result', output: 'a.ts\nb.ts\n' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: plain }))
    expect(findText(renderer, 'tool-detail-output')).toBe('a.ts\nb.ts\n')
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-prettify' })).toHaveLength(0)
  })

  it('prettifies JSON output on tap, and un-prettifies it back on a second tap', () => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }))
    expect(findText(renderer, 'tool-detail-output')).toBe('{"ok":true}')
    const pill = renderer.root.findByProps({ testID: 'tool-detail-prettify' })
    act(() => {
      pill.props.onPress()
    })
    expect(findText(renderer, 'tool-detail-output')).toBe(
      JSON.stringify({ ok: true }, null, 2)
    )
    const pillAgain = renderer.root.findByProps({ testID: 'tool-detail-prettify' })
    act(() => {
      pillAgain.props.onPress()
    })
    expect(findText(renderer, 'tool-detail-output')).toBe('{"ok":true}')
  })

  it('renders no Inputs section for a call with no arguments at all', () => {
    const noArgs: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: {} },
      result: { type: 'tool-result', output: 'ok' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: noArgs }))
    expect(
      renderer.root.findAllByProps({ testID: 'tool-detail-section' }).map((row) => row.findAllByType('Text' as never)[0]!.props.children)
    ).toEqual(['Output'])
  })

  it('renders no Output section for a call still running with no result yet', () => {
    const running: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'sleep 5' }, state: 'running' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: running }))
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-output' })).toHaveLength(0)
  })

  // The inline row capped both before native text layout; a 100 KB string in
  // one Android Text stalls the UI thread, and a tap now lands here instead.
  it('does not freeze on a 100 KB input: each value stops at the detail cap', () => {
    const huge: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'CustomTool', input: { payload: 'x'.repeat(100_000) } },
      result: { type: 'tool-result', output: 'ok' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: huge }))
    const value = renderer.root
      .findAllByProps({ testID: 'tool-detail-section' })[0]!
      .findAllByType('Text' as never)[1]!.props.children as string
    expect(value).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(value.endsWith('…')).toBe(true)
  })

  it('does not freeze on a 100 KB output, raw or prettified: it stops at the detail cap', () => {
    const json = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, i) => `row ${i}`) })
    const huge: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'cat big.json' } },
      result: { type: 'tool-result', output: json }
    }
    expect(json.length).toBeGreaterThan(MAX_TOOL_DETAIL_LENGTH * 10)
    renderer = renderTree(createElement(ToolDetailBody, { pair: huge }))
    const raw = findText(renderer, 'tool-detail-output')
    expect(raw).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(raw.endsWith('…')).toBe(true)
    act(() => {
      renderer!.root.findByProps({ testID: 'tool-detail-prettify' }).props.onPress()
    })
    const pretty = findText(renderer, 'tool-detail-output')
    expect(pretty).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(pretty.startsWith('{\n  "rows": [\n')).toBe(true)
  })

  // Reported 2026-09-26 (screen recording): a finger dragged over the Output
  // block scrolled the sheet a little, then Android selected the word under
  // the finger and raised Copy / Translate / Select all, on every attempt.
  // The sheet's pans run under gesture-handler, whose root stops passing the
  // touch to the Android views once a pan takes it, without a cancel. A
  // selectable TextView with no gesture of its own keeps the long-press it
  // armed on touch-down, and it fires mid-scroll. Its own native gesture is
  // what the pan cancels, which delivers ACTION_CANCEL to the TextView.
  it.each(['light', 'dark'] as const)(
    'scrolls instead of selecting a word when a drag starts on the output (%s)',
    (scheme) => {
      renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }), scheme)
      const output = findTextNode(renderer, 'tool-detail-output')
      // Still selectable by a deliberate, still long-press.
      expect(output.props.selectable).toBe(true)
      const selectable = renderer.root
        .findAllByType('Text' as never)
        .filter((node) => node.props.selectable === true)
      expect(selectable.length).toBeGreaterThan(0)
      for (const node of selectable) {
        const detector = nearestHostAncestor(node)
        expect(detector?.type).toBe('GestureDetector')
        expect((detector?.props.gesture as { kind?: string } | undefined)?.kind).toBe('native')
      }
    }
  )

  // Review of a1bda082: gesture-handler's detector sets user-select: none on
  // web unless told otherwise, so the web bundle lost the output's selection.
  it.each(['light', 'dark'] as const)('still lets the web bundle select the output (%s)', (scheme) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }), scheme)
    const detector = nearestHostAncestor(findTextNode(renderer, 'tool-detail-output'))
    expect(detector?.type).toBe('GestureDetector')
    expect(detector?.props.userSelect).toBe('text')
  })

  it('keeps an output of exactly the cap whole, with no ellipsis', () => {
    const exact: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'yes' } },
      result: { type: 'tool-result', output: 'y'.repeat(MAX_TOOL_DETAIL_LENGTH) }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: exact }))
    expect(findText(renderer, 'tool-detail-output')).toBe('y'.repeat(MAX_TOOL_DETAIL_LENGTH))
  })
})
