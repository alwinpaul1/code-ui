import { createElement, type ComponentProps, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// 2026-10-14, the S23 on 0.9.145 (screenshot): a blank rectangle in the user
// bubble's dark fill (#100F0D, exactly 86% of the list's content width, the
// bubble's maxWidth) covered the chat from under the tab strip to past the
// composer, painted over the reply rows of the running turn, whose words were
// cut off at its left edge. Not one glyph inside it.
//
// A bubble can only draw as an empty box if its native view holds none of
// what the bubble draws. That is the case on Android whenever the bubble is a
// View that forms no stacking context: Fabric then makes it a childless view
// with a background, and mounts its words, its Markdown document, its code
// cards and its controls one by one into whatever ancestor keeps children
// (sliceChildShadowNodeViewPairs.cpp; android-fabric-native-parent.test-support.ts).
// Two rows drew the bubble that way: a prompt queued while the agent works
// (the bubble is a plain View, not the Pressable), and the harness's words
// around a peer message. And one ancestor made every user row's mount move:
// the send dim is a View that keeps its children only while dimmed (opacity
// 0.5), so the desktop's ack moved every native view of the row out of it and
// into the list cell, one by one (react-native#57800, the move the reply's own
// containment was built to rule out, mobile-markdown-pill-native-parent.test.tsx).
// Since 0.9.145 a Markdown prompt puts a whole document in that bubble.
//
// Which mount fault left the rectangle behind on the phone was not caught (no
// log came with it). What this pins is the shape that lets one draw an empty
// bubble over other rows: everything a user bubble draws is mounted into the
// bubble's own native view, and a send's ack moves nothing.

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  return {
    AccessibilityInfo: {
      addEventListener: () => ({ remove: () => {} }),
      isReduceMotionEnabled: () => Promise.resolve(false)
    },
    Animated: {
      View: 'View',
      Text,
      Value: class {
        setValue(): void {}
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: Object.assign(() => null, { getSize: () => undefined }),
    Linking: { openURL: () => Promise.resolve() },
    PixelRatio: { get: () => 3, getFontScale: () => 1 },
    Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    useColorScheme: () => 'dark',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
    Easing: { out: (fn: unknown) => fn, quad: (t: number) => t },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
    cancelAnimation: () => {},
    withTiming: (to: number) => to
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import { androidNativeParent } from '../test/android-fabric-native-parent.test-support'
import { hostParent } from '../components/mobile-markdown-code-pill-phone.test-support'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatPeerBoilerplateRow } from './MobileNativeChatPeerBoilerplateRow'
import { MobileNativeChatPendingDim } from './MobileNativeChatPendingDim'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

/** A long Markdown prompt, as pasted on the phone: steps, fences, pills. */
const PASTED = [
  'The **rsync** copy left the files owned by root, so apt could not write them:',
  '',
  '```bash',
  'sudo rsync -a --chown=alwin:alwin ~/backup/ /home/alwin/ && sudo apt-get update && sudo apt-get install -y openssh-server',
  '```',
  '',
  '1. Check `ls -la ~/.ssh` for the owner.',
  '2. Run `chmod 600 ~/.ssh/authorized_keys` and try the login again.',
  '',
  'Then confirm `claude --version` says 2.1.300.'
].join('\n')

const PLAIN = 'ship it, then tell me what broke'

function userMessage(text: string, id = 'u1'): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

type Style = Record<string, unknown>
function flat(style: unknown): Style {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Style | null | undefined) ?? {})
}

const mounted = (node: ReactTestInstance): object =>
  (node as unknown as { _fiber: { stateNode: object } })._fiber.stateNode

/** Whether `node` is `root` or drawn inside it. */
function within(node: ReactTestInstance, root: ReactTestInstance): boolean {
  for (let up: ReactTestInstance | null = node; up; up = hostParent(up)) {
    if (up === root) {
      return true
    }
  }
  return false
}

function words(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(words).join('')
}

/** FlashList's cell: inverted, so it carries a transform and keeps its children. */
function Cell({ children }: { children: ReactNode }) {
  return createElement('View', { testID: 'cell', style: { transform: [{ scaleY: -1 }] } }, children)
}

function PeerRow({ text }: { text: string }) {
  const styles = useChatMessageStyles()
  return createElement(MobileNativeChatPeerBoilerplateRow, {
    message: { id: 'p1', role: 'system', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' },
    fontScale: 1,
    styles
  } as ComponentProps<typeof MobileNativeChatPeerBoilerplateRow>)
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(row: ReactNode, scheme: 'light' | 'dark'): void {
  const element = createElement(
    ThemeProvider,
    { initialPreference: scheme } as ComponentProps<typeof ThemeProvider>,
    createElement(Cell, null, row)
  )
  if (renderer) {
    act(() => renderer!.update(element))
  } else {
    act(() => {
      renderer = create(element)
    })
  }
}

function sentRow(message: NativeChatMessage, delivery: OutboxDelivery | undefined, queued: boolean): ReactNode {
  return createElement(
    MobileNativeChatPendingDim,
    { delivery } as ComponentProps<typeof MobileNativeChatPendingDim>,
    createElement(MobileNativeChatMessage, {
      message,
      onCancelQueued: queued ? () => undefined : undefined
    } as ComponentProps<typeof MobileNativeChatMessage>)
  )
}

/** The host node that paints the bubble's fill. */
function bubble(scheme: 'light' | 'dark'): ReactTestInstance {
  const fill = (scheme === 'dark' ? darkColors : lightColors).userBubble
  const found = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && flat(node.props.style).backgroundColor === fill
  )
  expect(found, 'one bubble fill').toHaveLength(1)
  return found[0]!
}

function hostsInside(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => typeof node.type === 'string' && node !== root)
}

/**
 * Every native view the bubble draws is mounted into the bubble's own native
 * view or one inside it: none is lifted out into the row or the list cell,
 * which would leave the bubble an empty filled box with its content beside it.
 */
function expectBubbleKeepsWhatItDraws(scheme: 'light' | 'dark', when: string): void {
  const box = bubble(scheme)
  const inside = hostsInside(box)
  expect(inside.length, `${when}: the bubble draws something`).toBeGreaterThan(0)
  for (const node of inside) {
    const parent = androidNativeParent(node, hostParent)
    const where = parent === null ? 'into whatever holds the row' : within(parent, box) ? 'inside the bubble' : `into ${String(parent.props.testID ?? parent.type)} outside the bubble`
    expect(where, `${when}: ${String(node.type)} "${words(node).slice(0, 40)}" is mounted`).toBe('inside the bubble')
  }
}

describe.each(['light', 'dark'] as const)('a user bubble on Android, in %s', (scheme) => {
  it.each([
    ['a Markdown prompt', PASTED],
    ['a plain prompt', PLAIN],
    ['a one-character prompt', 'k']
  ])('keeps everything %s draws inside its own bubble while it is queued behind a running turn', (_name, text) => {
    draw(sentRow(userMessage(text, 'pending-1'), undefined, true), scheme)
    expect(words(bubble(scheme))).toContain('Queued')
    expectBubbleKeepsWhatItDraws(scheme, 'queued')
  })

  it.each([
    ['a Markdown prompt', PASTED],
    ['a plain prompt', PLAIN]
  ])('keeps everything %s draws inside its own bubble once it lands', (_name, text) => {
    draw(sentRow(userMessage(text), undefined, false), scheme)
    expectBubbleKeepsWhatItDraws(scheme, 'landed')
  })

  it('keeps the harness words around a peer message inside their bubble, Markdown or not', () => {
    draw(createElement(PeerRow, { text: PASTED }), scheme)
    expectBubbleKeepsWhatItDraws(scheme, 'peer Markdown')
    act(() => renderer!.unmount())
    renderer = null
    draw(createElement(PeerRow, { text: PLAIN }), scheme)
    expectBubbleKeepsWhatItDraws(scheme, 'peer plain')
  })

  it.each([
    ['queued', true],
    ['not queued', false]
  ])('moves nothing of a sent row when the desktop takes the send (%s)', (_name, queued) => {
    const message = userMessage(PASTED, 'pending-2')
    draw(sentRow(message, 'sending', queued), scheme)
    const box = bubble(scheme)
    const nodes = [box, ...hostsInside(box)]
    const before = new Map(nodes.map((node) => [mounted(node), mounted(androidNativeParent(node, hostParent) ?? node)]))
    // Dimmed while the desktop has not taken it, full strength once it has, and
    // still full strength if the write is refused (a "Not sent" line under it).
    for (const delivery of ['taken', 'failed', 'sending', undefined] as const) {
      draw(sentRow(message, delivery, queued), scheme)
      for (const node of [bubble(scheme), ...hostsInside(bubble(scheme))]) {
        const was = before.get(mounted(node))
        if (was === undefined) {
          continue
        }
        const now = androidNativeParent(node, hostParent)
        expect(
          now !== null && mounted(now) === was,
          `${String(node.type)} "${words(node).slice(0, 30)}" moved to another native parent when the send went ${String(delivery)}`
        ).toBe(true)
      }
    }
  })
})
