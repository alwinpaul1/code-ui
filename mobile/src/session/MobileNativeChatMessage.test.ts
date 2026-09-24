import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOOL_DETAIL_LENGTH } from '../../../src/shared/native-chat-tool-summary'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// A tapped row opens the real detail sheet in a bare shell: the draggable one
// needs RN exports this mock leaves out, and what matters here is what the
// tap shows (the same stand-in MobileNativeChatToolDetailSheet.test.tsx uses).
vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, header, children }: { visible: boolean; header?: unknown; children?: unknown }) =>
      visible ? React.createElement('DraggableDetailSheet', null, header, children) : null
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      Text,
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Pressable: 'Pressable',
    Text,
    View: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { DESKTOP_PROMPT_IMAGE_REF, SENT_PHOTO_REF } from './mobile-desktop-prompt-images'

function userMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks, timestamp: null, source: 'transcript' }
}

function toolMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'a1', role: 'assistant', blocks, timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    message: NativeChatMessage,
    props: Omit<Parameters<typeof MobileNativeChatMessage>[0], 'message'> = {}
  ): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(MobileNativeChatMessage, { message, ...props }))
    })
    return renderer!
  }

  const textIn = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  // 2026-09-15, reported against the terminal: a reply read as though it came
  // after work it had actually come before. The renderer bucketed a turn into
  // all prose then all tools, so the words lost their place relative to the
  // work. The transcript's order is the record of what happened.
  it('draws a turn in the order it happened, not words first and work after', () => {
    const tree = render(
      toolMessage([
        { type: 'text', text: 'BEFORE the command' },
        { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool-result', output: 'ok' },
        { type: 'text', text: 'AFTER the command' }
      ])
    )
    // The serialized tree preserves render order, and prose goes through a
    // mocked MobileMarkdown rather than a Text node.
    const order = JSON.stringify(tree.toJSON())
    const before = order.indexOf('BEFORE the command')
    const after = order.indexOf('AFTER the command')
    // The collapsed run names itself, not the tool inside it.
    const work = order.indexOf('Ran a command')
    expect(before).toBeGreaterThanOrEqual(0)
    expect(after).toBeGreaterThanOrEqual(0)
    expect(work).toBeGreaterThanOrEqual(0)
    // The words written before the command sit above it; the words written
    // after sit below. Bucketing put both above.
    expect(before).toBeLessThan(work)
    expect(work).toBeLessThan(after)
  })

  // 2026-09-21, the user: "automatic copy on long hold on user send prompts
  // instead of long hold and copy button". A hold on a sent prompt now copies
  // the whole prompt and tints the bubble, the way the agent's Copy control
  // does; nothing to select, nothing to tap after. The bubble's text is
  // therefore no longer a selection target — a selectable Text would take the
  // hold for Android's own selection and the copy would never fire. The
  // agent's prose keeps its selection (2026-09-12).
  it('copies the whole prompt on a hold, and confirms it on the bubble', async () => {
    const clipboard = await import('expo-clipboard')
    const tree = render(userMessage([{ type: 'text', text: 'run the full gate' }]))
    const bubble = tree.root.findByProps({ accessibilityLabel: 'Sent prompt' })
    expect(bubble.props.delayLongPress).toBe(400)
    act(() => {
      bubble.props.onLongPress()
    })
    expect(clipboard.setStringAsync).toHaveBeenCalledWith('run the full gate')
    expect(bubble.props.accessibilityHint).toMatch(/hold to copy/i)
  })

  it('does not make the prompt text a selection target, so the hold reaches the bubble', () => {
    const tree = render(userMessage([{ type: 'text', text: 'run the full gate' }]))
    const selectable = tree.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
    expect(selectable).not.toContain('run the full gate')
  })

  it('discloses no copy button on a tap any more, and none on a queued echo', () => {
    const sent = render(userMessage([{ type: 'text', text: 'record' }]))
    act(() => {
      sent.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onPress()
    })
    expect(sent.root.findAllByProps({ accessibilityLabel: 'Copy prompt' })).toHaveLength(0)
    act(() => sent.unmount())

    const queued = render(userMessage([{ type: 'text', text: 'record' }]), {
      onCancelQueued: vi.fn()
    })
    expect(queued.root.findAllByProps({ accessibilityLabel: 'Sent prompt' })).toHaveLength(0)
    expect(queued.root.findAllByProps({ accessibilityLabel: 'Copy prompt' })).toHaveLength(0)
  })

  // The VS Code extension puts "Rewind to here" on every user message; on the
  // phone it is the disclosed control of a sent prompt (Copy is the hold), and
  // only when the lane hands the row a way to rewind (the structured lane,
  // on a host that said it will). The row itself never decides that.
  it('offers Rewind to here on a sent prompt only when the lane can rewind, and hands back the message id', () => {
    const onRewindToHere = vi.fn()
    const sent = render(userMessage([{ type: 'text', text: 'record' }]), { onRewindToHere })
    expect(sent.root.findAllByProps({ accessibilityLabel: 'Rewind to here' })).toHaveLength(0)
    act(() => {
      sent.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onPress()
    })
    const control = sent.root.findByProps({ accessibilityLabel: 'Rewind to here' })
    act(() => control.props.onPress())
    expect(onRewindToHere).toHaveBeenCalledWith('u1')
    act(() => sent.unmount())

    const withoutLane = render(userMessage([{ type: 'text', text: 'record' }]))
    act(() => {
      withoutLane.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onPress()
    })
    // Copy moved onto the hold, so with no lane to rewind a tap discloses nothing.
    expect(withoutLane.root.findAllByProps({ accessibilityLabel: 'Copy prompt' })).toHaveLength(0)
    expect(withoutLane.root.findAllByProps({ accessibilityLabel: 'Rewind to here' })).toHaveLength(0)
  })

  it.each([
    ['light', lightColors, darkColors],
    ['dark', darkColors, lightColors]
  ] as const)('draws Rewind to here in the %s bubble ink, not a fixed colour', (preference, colors, other) => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: preference },
          createElement(MobileNativeChatMessage, {
            message: userMessage([{ type: 'text', text: 'record' }]),
            onRewindToHere: vi.fn()
          })
        )
      )
    })
    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onPress()
    })
    const control = renderer!.root.findByProps({ accessibilityLabel: 'Rewind to here' })
    const label = control.findAllByType('Text' as never).find((node) => node.children.includes('Rewind to here'))
    const style = Object.assign({}, ...([] as unknown[]).concat(label?.props.style).flat(Infinity).filter(Boolean))
    expect(style.color).toBe(colors.userBubbleText)
    expect(style.color).not.toBe(other.userBubbleText)
    expect(control.findByType('Undo2' as never).props.color).toBe(colors.userBubbleText)
  })

  // 2026-09-21, beside the Claude app: it draws the injected peer turn as a
  // user bubble holding the harness's words, before the reply. The phone's
  // fold makes that a system row with a hint; it must LOOK like a sent prompt.
  it.each([
    ['light', lightColors, darkColors],
    ['dark', darkColors, lightColors]
  ] as const)('draws the peer boilerplate as a right-aligned user bubble in the %s ink, with no prompt controls', (preference, colors, other) => {
    const boilerplate: NativeChatMessage = {
      id: 'u2:peer-boilerplate',
      role: 'system',
      timestamp: null,
      source: 'transcript',
      blocks: [{ type: 'text', text: 'Another Claude session sent a message: This came from another Claude session — not typed by your user.', presentation: 'peer-boilerplate' }]
    }
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: preference }, createElement(MobileNativeChatMessage, { message: boilerplate, onRewindToHere: vi.fn() }))
      )
    })
    const bubble = renderer!.root.findByProps({ testID: 'native-chat-peer-boilerplate' })
    const bubbleStyle = Object.assign({}, ...([] as unknown[]).concat(bubble.props.style).flat(Infinity).filter(Boolean))
    expect(bubbleStyle.backgroundColor).toBe(colors.userBubble)
    expect(bubbleStyle.backgroundColor).not.toBe(other.userBubble)
    const rowStyle = Object.assign({}, ...([] as unknown[]).concat(bubble.parent!.props.style).flat(Infinity).filter(Boolean))
    expect(rowStyle.alignItems).toBe('flex-end')
    const label = bubble.findAllByType('Text' as never).find((node) => String(node.children.join('')).startsWith('Another Claude session'))
    const textStyle = Object.assign({}, ...([] as unknown[]).concat(label?.props.style).flat(Infinity).filter(Boolean))
    expect(textStyle.color).toBe(colors.userBubbleText)
    expect(bubble.props.accessibilityLabel).toBe('Injected by Claude Code')
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Sent prompt' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Rewind to here' })).toHaveLength(0)
  })

  it('never offers Rewind to here on an agent reply or a queued echo, even when the lane can rewind', () => {
    const onRewindToHere = vi.fn()
    const reply = render(toolMessage([{ type: 'text', text: 'done' }]), { onRewindToHere })
    expect(reply.root.findAllByProps({ accessibilityLabel: 'Rewind to here' })).toHaveLength(0)
    act(() => reply.unmount())

    const queued = render(userMessage([{ type: 'text', text: 'record' }]), {
      onRewindToHere,
      onCancelQueued: vi.fn()
    })
    expect(queued.root.findAllByProps({ accessibilityLabel: 'Rewind to here' })).toHaveLength(0)
  })

  it('renders a loadable preview URI as an image thumbnail', () => {
    const tree = render(userMessage([{ type: 'image-ref', url: 'file:///a.jpg', alt: 'a photo' }]))
    const image = tree.root.findByType('Image' as never)
    expect(image.props.source).toEqual({ uri: 'file:///a.jpg' })
    expect(image.props.accessibilityLabel).toBe('a photo')
  })

  it('prefers the url over the path when both are present', () => {
    const tree = render(
      userMessage([{ type: 'image-ref', url: 'file:///local.jpg', path: '/tmp/host.png' }])
    )
    expect(tree.root.findByType('Image' as never).props.source).toEqual({
      uri: 'file:///local.jpg'
    })
  })

  it('shows an image chip, never the raw host path, for an unloadable image', () => {
    // A host temp path (a desktop paste, or an SSH host) is not loadable on the
    // device until the host grants it; the bubble must not print the path.
    const tree = render(userMessage([{ type: 'image-ref', path: '/tmp/host.png' }]))
    expect(tree.root.findAllByType('Image' as never)).toHaveLength(0)
    const texts = tree.root
      .findAllByType('Text' as never)
      .map((node) => String(node.children.join('')))
    expect(texts.some((text) => text.includes('/tmp/host.png'))).toBe(false)
    expect(texts).toContain('Image')
  })

  it('does not send inaccessible desktop paste paths through the failing file opener', () => {
    const onOpenFile = vi.fn()
    const tree = render(
      userMessage([
        {
          type: 'image-ref',
          path: '/var/folders/0y/session/T/orca-paste-1788732989689-c9b48721-60fe-4649-9ee3-a1369133656b.png'
        }
      ]),
      { onOpenFile }
    )
    expect(textIn(tree.root)).toContain('Image on Desktop')
    // The bubble itself is tappable (it discloses the copy control); the
    // image chip must not be.
    expect(
      tree.root
        .findAllByType('Pressable')
        .filter((node) => node.props.onPress && node.props.accessibilityLabel !== 'Sent prompt')
    ).toHaveLength(0)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('draws a desktop-pasted image the phone has no bytes for as the same chip, not tappable', () => {
    // Device 2026-09-19: the `[Image #N]` in a landed prompt was drawn as the
    // words "Image on Desktop" inside the sentence. It is now an image block
    // with the desktop stand-in path, and that block draws the chip.
    const onOpenFile = vi.fn()
    const tree = render(
      userMessage([
        { type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF },
        { type: 'text', text: 'see this i already send' }
      ]),
      { onOpenFile }
    )
    expect(textIn(tree.root)).toContain('Image on Desktop')
    expect(textIn(tree.root)).toContain('see this i already send')
    expect(tree.root.findAllByType('Image' as never)).toHaveLength(0)
    expect(
      tree.root
        .findAllByType('Pressable')
        .filter((node) => node.props.onPress && node.props.accessibilityLabel !== 'Sent prompt')
    ).toHaveLength(0)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  // 2026-09-24: a photo sent from the Claude app reached the phone as words
  // alone. Claude's screen says it was there, and it is drawn as a chip that
  // says so, in the theme in use, and opens nothing (there is no file to open).
  it('draws a photo sent from the Claude app as a Photo chip, not tappable, in light and dark', () => {
    const colors: unknown[] = []
    for (const scheme of ['light', 'dark'] as const) {
      const onOpenFile = vi.fn()
      act(() => {
        renderer?.unmount()
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(MobileNativeChatMessage, {
              message: userMessage([
                { type: 'image-ref', path: SENT_PHOTO_REF },
                { type: 'text', text: 'See this photo from the Claude app please' }
              ]),
              onOpenFile
            })
          )
        )
      })
      const tree = renderer!
      expect(textIn(tree.root)).toContain('Photo')
      expect(textIn(tree.root)).not.toContain('Image on Desktop')
      const chip = tree.root.findAll((node) => node.props.accessibilityLabel === 'Photo. Preview unavailable.')
      expect(chip.length).toBeGreaterThan(0)
      expect(chip[0]!.props.disabled).toBe(true)
      expect(onOpenFile).not.toHaveBeenCalled()
      const label = tree.root.findAllByType('Text' as never).find((node) => textIn(node).includes('Photo'))!
      const style = [label.props.style].flat(Infinity) as { color?: string }[]
      colors.push(style.find((entry) => entry?.color)?.color)
    }
    expect(colors[0]).toBeDefined()
    expect(colors[0]).not.toBe(colors[1])
  })

  it('labels a tool row with the target path instead of raw input JSON', () => {
    const tree = render(
      toolMessage([{ type: 'tool-call', name: 'Read', input: { file_path: 'src/index.ts' } }]),
      { toolsExpanded: true }
    )
    const texts = textIn(tree.root)
    expect(texts).toContain('src/index.ts')
    expect(texts.some((text) => text.includes('"file_path":"src/index.ts"'))).toBe(false)
  })

  // The Tools toggle no longer expands a row that opens the detail sheet
  // (docs/claude-app-parity.md item 4), so the cap moved with the detail.
  it('draws a 100 KB tool input only through the sheet, capped before native text layout', () => {
    const tree = render(
      toolMessage([
        { type: 'tool-call', name: 'CustomTool', input: { payload: 'x'.repeat(100_000) } }
      ]),
      { toolsExpanded: true }
    )
    const longest = () => Math.max(...textIn(tree.root).map((text) => text.length))
    expect(longest()).toBeLessThan(MAX_TOOL_DETAIL_LENGTH)
    act(() => tree.root.findByProps({ testID: 'tool-run-header' }).props.onPress())
    const detail = textIn(tree.root).find((text) => text.startsWith('xxx'))
    expect(detail).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(detail?.endsWith('…')).toBe(true)
    expect(longest()).toBe(MAX_TOOL_DETAIL_LENGTH + 1)
  })

  it('opens a JSON-string tool input in the sheet as named fields', () => {
    const tree = render(
      toolMessage([
        {
          type: 'tool-call',
          name: 'CustomTool',
          input: '{"cmd":"git status","description":"Inspect changes"}'
        }
      ])
    )
    // Closed, the row says only what ran: no field of the input is drawn yet.
    expect(textIn(tree.root)).not.toContain('Inspect changes')
    act(() => tree.root.findByProps({ testID: 'tool-run-header' }).props.onPress())
    const shown = textIn(tree.root)
    expect(shown).toEqual(expect.arrayContaining(['cmd', 'git status', 'description', 'Inspect changes']))
    expect(shown.indexOf('cmd')).toBeLessThan(shown.indexOf('description'))
  })

  it('does not echo the row label as detail when a row has nothing to expand', () => {
    // The Tools toggle opens every row at once, bypassing the tap guard — a row
    // whose formatted input is its own label would echo itself in a panel that
    // no tap can dismiss.
    const tree = render(toolMessage([{ type: 'tool-call', name: 'ListTodos', input: '{}' }]), {
      toolsExpanded: true
    })
    expect(textIn(tree.root).filter((text) => text === '{}')).toHaveLength(1)
    // The chevron has to agree with the panel, or the row claims to be open over
    // nothing and the tap that would close it is guarded off. Only the run header
    // is open here; the row itself stays collapsed.
    expect(tree.root.findAllByType('ChevronDown' as never)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronRight' as never)).toHaveLength(1)
  })

  it('does not expand a plain input that already fits in the row label', () => {
    const input = 'x'.repeat(60)
    const tree = render(toolMessage([{ type: 'tool-call', name: 'CustomTool', input }]), {
      toolsExpanded: true
    })
    expect(textIn(tree.root).filter((text) => text === input)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronDown' as never)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronRight' as never)).toHaveLength(1)
  })

  describe('the structured lane', () => {
    const settledRun: NativeChatMessage['blocks'] = [
      { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'failed' },
      { type: 'tool-result', output: '1 failing', isError: true }
    ]

    it('hangs the turn status under the user message it belongs to', () => {
      const tree = render(userMessage([{ type: 'text', text: 'go' }]), {
        structuredActivityUi: true,
        turnStatus: { startedAt: 1_000, thinking: false, workedSeconds: 184 },
        turnKey: 'u1',
        onToggleTurn: vi.fn()
      })
      expect(textIn(tree.root)).toContain('Worked for 3m 4s')
    })

    it("does not leave a settled turn's failed command reading as a failed reply", () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false
      })
      // The run is behind the turn caret now, not loose in the transcript.
      expect(textIn(tree.root).join(' ')).not.toContain('pnpm test')
    })

    it('brings that run back the moment the turn caret discloses it', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        turnExpanded: true
      })
      expect(textIn(tree.root).join(' ')).toContain('pnpm test')
    })

    it('still answers the global Tools toggle on a settled turn', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        toolsExpanded: true
      })
      expect(textIn(tree.root).join(' ')).toContain('pnpm test')
    })

    it('keeps the run visible while the turn is still working', () => {
      const running: NativeChatMessage['blocks'] = [
        { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'running' }
      ]
      const tree = render(toolMessage(running), {
        structuredActivityUi: true,
        activeTurnIsWorking: true
      })
      expect(textIn(tree.root)).toContain('Running')
    })

    it('leaves the bridge lane exactly as it was', () => {
      const tree = render(toolMessage(settledRun), { activeTurnIsWorking: false })
      expect(textIn(tree.root).some((text) => text.startsWith('Ran '))).toBe(true)
      expect(textIn(tree.root).some((text) => text.startsWith('Running'))).toBe(false)
    })
  })

  // Focus view (extension `claudeCode.focusView`): tool activity folds to one
  // "N tool calls" row per run, and nothing else about the turn moves.
  describe('Focus view', () => {
    const settledRun: NativeChatMessage['blocks'] = [
      { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'completed' },
      { type: 'tool-result', output: 'ok' }
    ]
    const shape = (tree: ReactTestRenderer): string =>
      JSON.stringify(tree.toJSON(), (_key, value: unknown) =>
        typeof value === 'function' ? '[fn]' : value
      )

    it('folds a bridge-lane run to its count, where today it reads the sentence', () => {
      const tree = render(toolMessage(settledRun), { activeTurnIsWorking: false, focusView: true })
      expect(textIn(tree.root)).toContain('1 tool call')
      expect(textIn(tree.root).some((text) => text.startsWith('Ran '))).toBe(false)
      expect(textIn(tree.root).join(' ')).not.toContain('pnpm test')
    })

    it('keeps a settled structured turn behind its caret: no new row appears', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        focusView: true
      })
      expect(textIn(tree.root).join(' ')).not.toContain('tool call')
      expect(textIn(tree.root).join(' ')).not.toContain('pnpm test')
    })

    it('reads the count once the caret discloses that turn', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        turnExpanded: true,
        focusView: true
      })
      expect(textIn(tree.root)).toContain('1 tool call')
    })

    it('off is today, on both lanes', () => {
      for (const structuredActivityUi of [false, true]) {
        const today = shape(
          render(toolMessage(settledRun), { structuredActivityUi, activeTurnIsWorking: false, turnExpanded: true })
        )
        act(() => renderer?.unmount())
        renderer = null
        const off = shape(
          render(toolMessage(settledRun), {
            structuredActivityUi,
            activeTurnIsWorking: false,
            turnExpanded: true,
            focusView: false
          })
        )
        act(() => renderer?.unmount())
        renderer = null
        expect(off).toBe(today)
      }
    })
  })

  // docs/claude-app-parity.md item 9. Real text of session
  // 967668df-a7d9-40e7-964b-7812815c010d's "76514539-Screen_Recording" row
  // (Claude Code 2.1.281): Claude Code's own `@"<path>"` mention for a
  // dropped file, byte for byte including the doubled space before "in that
  // sheet".
  const REAL_MENTION_TEXT =
    '@"/Users/alwinpaul/.claude-work/uploads/967668df-a7d9-40e7-964b-7812815c010d/76514539-Screen_Recording_20260924_010304_Claude.mp4" See when a agent is running i can see that running using clicking on running task then  in that sheet there is a view transcript option to see the running agents transcript and in the conversation I can see animation an agent is running we need this all'

  describe('a file Claude Code mentioned in the prompt', () => {
    it('draws it as a card and drops the marker from the bubble, keeping the caption', () => {
      const tree = render(userMessage([{ type: 'text', text: REAL_MENTION_TEXT }]))
      const texts = textIn(tree.root)
      expect(texts.some((text) => text.includes('@"'))).toBe(false)
      expect(texts.some((text) => text.includes('.claude-work/uploads'))).toBe(false)
      expect(texts).toContain('MP4')
      expect(texts).toContain('Screen_Recording_20260924_010304_Claude')
      expect(
        texts.some((text) =>
          text.includes(
            'See when a agent is running i can see that running using clicking on running task'
          )
        )
      ).toBe(true)
    })

    it('leaves an ordinary sent prompt with no mention exactly as it was', () => {
      const tree = render(userMessage([{ type: 'text', text: 'run the full gate' }]))
      expect(textIn(tree.root)).toContain('run the full gate')
      expect(tree.root.findAllByProps({ accessibilityLabel: /^Attached file/ })).toHaveLength(0)
    })

    it('cards a mention with no caption after it, without a dangling empty line', () => {
      const tree = render(
        userMessage([
          { type: 'text', text: '@"/tmp/uploads/abcdef01-notes.pdf"' }
        ])
      )
      const texts = textIn(tree.root)
      expect(texts).toContain('PDF')
      expect(texts).toContain('notes')
      expect(texts.some((text) => text.trim() === '')).toBe(false)
    })

    it('cards every file a message names more than one of', () => {
      const tree = render(
        userMessage([
          {
            type: 'text',
            text: '@"/tmp/uploads/abcdef01-a.pdf" and @"/tmp/uploads/12345678-b.png" please'
          }
        ])
      )
      const texts = textIn(tree.root)
      expect(texts).toContain('PDF')
      expect(texts).toContain('a')
      expect(texts).toContain('PNG')
      expect(texts).toContain('b')
      expect(texts).toContain('and please')
    })

    it('never turns the same-looking text in an agent reply into a card', () => {
      // The marker is Claude Code's own record of what THE USER attached; an
      // agent quoting a path in its own prose is not that, and must not be
      // read as one. Agent prose renders through MobileMarkdown (mocked to a
      // bare tag here), so the untouched text shows up in its `content` prop
      // rather than as a Text child — read the serialized tree instead.
      const tree = render(toolMessage([{ type: 'text', text: REAL_MENTION_TEXT }]))
      const serialized = JSON.stringify(tree.toJSON())
      expect(serialized).toContain('/Users/alwinpaul/.claude-work/uploads')
      expect(serialized).not.toContain('MP4')
    })

    it('does nothing on a tap, with no failing file-open call wired to a card nothing on the phone can preview', () => {
      const onOpenFile = vi.fn()
      const tree = render(userMessage([{ type: 'text', text: REAL_MENTION_TEXT }]), { onOpenFile })
      const card = tree.root.findByProps({ accessibilityLabel: 'Attached file Screen_Recording_20260924_010304_Claude' })
      expect(card.props.onPress).toBeUndefined()
      expect(onOpenFile).not.toHaveBeenCalled()
    })

    it.each([
      ['light', lightColors, darkColors],
      ['dark', darkColors, lightColors]
    ] as const)('draws the card from the live theme in %s, not a fixed colour', (preference, colors, other) => {
      act(() => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: preference },
            createElement(MobileNativeChatMessage, { message: userMessage([{ type: 'text', text: REAL_MENTION_TEXT }]) })
          )
        )
      })
      const card = renderer!.root.findByProps({
        accessibilityLabel: 'Attached file Screen_Recording_20260924_010304_Claude'
      })
      const cardStyle = Object.assign(
        {},
        ...([] as unknown[]).concat(card.props.style).flat(Infinity).filter(Boolean)
      )
      expect(cardStyle.backgroundColor).toBe(colors.bgRaised)
      expect(cardStyle.backgroundColor).not.toBe(other.bgRaised)
    })
  })
})
