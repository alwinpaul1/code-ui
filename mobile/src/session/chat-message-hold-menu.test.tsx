import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The user, 2026-10-15: "we need exact hold to copy from Claude mobile, and scrolls must not
// trigger hold to copy." The Claude app (com.anthropic.claude 1.261009.20) selects nothing in
// place on a Code session's timeline. A hold on a prose row, Claude's or the user's, buzzes,
// holds the message and hangs a menu card from it: Copy and Select text (rgs.java:85-110,
// t030.t), each with the row's words as drawn (Claude gives the Markdown source; Code UI gives plain text, by the user's choice, 2026-10-15). Select text opens a sheet with that text in
// a SelectionContainer (code/remote/bottomsheet/b.java:2349-2362). Before this, a hold on a reply
// started Android's selection in the list, which a finger stopping a fling could start too.

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  return {
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
    ActivityIndicator: 'ActivityIndicator',
    Image: Object.assign(() => null, { getSize: () => undefined }),
    Linking: { openURL: () => Promise.resolve() },
    Modal: ({ children, ...props }: { children?: ReactNode }) => React.createElement('Modal', props, children),
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
const focusReports = vi.hoisted(() => ({ report: null as null | ((focused: boolean) => void) }))
vi.mock('./use-native-chat-screen-focus', () => ({
  useNativeChatScreenFocus: (onFocusChange: (focused: boolean) => void) => {
    focusReports.report = onFocusChange
  }
}))
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
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
// The real drawer is a Modal with gestures: this one shows its header and children while visible.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: (props: { visible: boolean; header?: ReactNode; children?: ReactNode; onAfterClose?: () => void }) => {
      const was = useRef(props.visible)
      useEffect(() => {
        if (was.current && !props.visible) {
          props.onAfterClose?.()
        }
        was.current = props.visible
      }, [props.visible, props.onAfterClose])
      return props.visible ? React.createElement('BottomDrawer', props as never, props.header, props.children) : null
    }
  }
})

import * as Clipboard from 'expo-clipboard'
import { ChatTextHoldSelectsContext } from '../components/chat-text-selectable-context'
import { triggerError, triggerMediumImpact } from '../platform/haptics'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { CHAT_HOLD_MS } from './chat-message-hold'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { markdownPlainText } from '../components/markdown-plain-text'

const REPLY = ['First paragraph of the reply.', '', 'Second, with **bold** and `code`.', '', '- one item', '- another item'].join(
  '\n'
)

const message = (role: NativeChatMessage['role'], text: string, id = `${role}-1`): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: null,
  source: 'transcript'
})

const words = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(words).join('')
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))
const touch = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } })

let renderer: ReactTestRenderer | null = null

function tree(row: NativeChatMessage, scheme: 'light' | 'dark', listAtRest: boolean): ReactElement {
  return (
    <ThemeProvider initialPreference={scheme}>
      <ChatTextHoldSelectsContext.Provider value={listAtRest}>
        <MobileNativeChatMessage message={row} />
      </ChatTextHoldSelectsContext.Provider>
    </ThemeProvider>
  )
}

function render(row: NativeChatMessage, scheme: 'light' | 'dark' = 'light', listAtRest = true): ReactTestInstance {
  act(() => {
    renderer = create(tree(row, scheme, listAtRest))
  })
  return renderer!.root
}

/** What takes a hold in the row: a Pressable with a long press. */
const holdTargets = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.onLongPress === 'function')
const holdTarget = (root: ReactTestInstance): ReactTestInstance => {
  const found = holdTargets(root)
  expect(found).toHaveLength(1)
  return found[0]!
}
const menu = (root: ReactTestInstance): ReactTestInstance | undefined =>
  root.findAll((node) => node.props.testID === 'message-menu' && typeof node.type === 'string')[0]
const menuRows = (root: ReactTestInstance): string[] =>
  root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'menuitem').map(words)
const choose = async (root: ReactTestInstance, label: string): Promise<void> => {
  const row = root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'menuitem' && words(node) === label
  )
  await act(async () => {
    row.props.onPress()
  })
}
const selectBody = (root: ReactTestInstance): ReactTestInstance | undefined =>
  root.findAll((node) => node.props.testID === 'select-text-body' && typeof node.type !== 'string')[0]

async function holdStill(target: ReactTestInstance, x = 120, y = 300): Promise<void> {
  await act(async () => {
    target.props.onPressIn(touch(x, y))
  })
  await act(async () => {
    target.props.onLongPress(touch(x, y))
  })
}

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  vi.mocked(triggerMediumImpact).mockClear()
  vi.mocked(triggerError).mockClear()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('holding a message in a %s session', (scheme, palette) => {
  it('opens the Claude menu on a reply, with the long-press buzz, instead of starting a selection', async () => {
    const root = render(message('assistant', REPLY), scheme)
    expect(menu(root)).toBeUndefined()
    const target = holdTarget(root)
    expect(target.props.delayLongPress).toBe(CHAT_HOLD_MS)
    await holdStill(target)
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
    expect(triggerMediumImpact).toHaveBeenCalledTimes(1)
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    // Hung from the reply's start (the point the finger was on, where nothing measures it here).
    const card = flat(menu(root)!.props.style)
    expect(card.left).toBe(120)
    expect(card.right).toBeUndefined()
    expect(card.backgroundColor).toBe(palette.askCardFill)
    expect(card.borderColor).toBe(palette.askDivider)
    expect(card.borderRadius).toBe(12)
    const label = menu(root)!.find((node) => typeof node.type !== 'string' && words(node) === 'Copy' && node.props.style)
    expect(flat(label.props.style).color).toBe(palette.askText)
  })

  it('opens the same menu on a sent prompt, hung from its end', async () => {
    const root = render(message('user', 'run the gate\n\n- then **push**'), scheme)
    await holdStill(holdTarget(root), 300, 200)
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
    const card = flat(menu(root)!.props.style)
    expect(card.right).toBe(390 - 300)
    expect(card.left).toBeUndefined()
  })

  it('copies the reply as the words it shows, without its Markdown marks, and puts the message down', async () => {
    const root = render(message('assistant', REPLY), scheme)
    await holdStill(holdTarget(root))
    await choose(root, 'Copy')
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(markdownPlainText(REPLY))
    expect(markdownPlainText(REPLY)).not.toMatch(/\*\*|`/)
    expect(menu(root)).toBeUndefined()
  })

  it('says so under the reply when the clipboard refuses the copy', async () => {
    vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false)
    const root = render(message('assistant', REPLY), scheme)
    await holdStill(holdTarget(root))
    await choose(root, 'Copy')
    expect(triggerError).toHaveBeenCalledTimes(1)
    const notice = root.findAll((node) => String(node.type) === 'Text' && words(node).startsWith("Couldn't copy"))
    expect(notice).toHaveLength(1)
    expect(flat(notice[0]!.props.style).color).toBe(palette.danger)
  })

  it('opens Select text as a sheet with the whole reply selectable, in the sheet ink', async () => {
    const root = render(message('assistant', REPLY), scheme)
    await holdStill(holdTarget(root))
    await choose(root, 'Select text')
    expect(menu(root)).toBeUndefined()
    const body = selectBody(root)
    expect(body).toBeDefined()
    expect(body!.props.selectable).toBe(true)
    expect(words(body!)).toBe(markdownPlainText(REPLY))
    expect(words(body!)).not.toMatch(/\*\*|`/)
    expect(flat(body!.props.style).color).toBe(palette.askText)
  })

  it('puts the message down on a tap off the card', async () => {
    const root = render(message('assistant', REPLY), scheme)
    await holdStill(holdTarget(root))
    const backdrop = root.find((node) => node.props.testID === 'message-menu-backdrop' && String(node.type) === 'Pressable')
    await act(async () => {
      backdrop.props.onPress()
    })
    expect(menu(root)).toBeUndefined()
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  })
})

describe('nothing in a message row is selected in place', () => {
  const selectableTexts = (root: ReactTestInstance): ReactTestInstance[] =>
    root.findAll((node) => node.props.selectable === true && node.props.testID !== 'select-text-body')

  it.each([
    ['a reply', message('assistant', REPLY)],
    ['a reply with a code fence and a table', message('assistant', 'Run:\n\n```sh\nnpm test\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |')],
    ['a sent prompt written in Markdown', message('user', '- one\n- **two**')],
    ['a plan document', { ...message('system', 'Plan intro.\n\n1. Do it'), blocks: [{ type: 'text', text: 'Plan intro.\n\n1. Do it', presentation: 'plan-document' }] } as NativeChatMessage]
  ])('%s has no selectable text', (_label, row) => {
    const root = render(row)
    expect(selectableTexts(root)).toEqual([])
    // Not vacuous: the row's document did draw Texts, each told not to select.
    expect(root.findAll((node) => String(node.type) === 'Text' && node.props.selectable === false).length).toBeGreaterThan(0)
  })

  it('gives a thought no menu: only prose rows are held, as in the Claude app', () => {
    expect(holdTargets(render(message('reasoning', 'Thinking about it.')))).toEqual([])
  })
})

describe('a scroll never opens the menu', () => {
  it('opens nothing for a press that turns into a scroll before the timeout', async () => {
    const root = render(message('assistant', REPLY))
    const target = holdTarget(root)
    await act(async () => {
      target.props.onPressIn(touch(120, 300))
      target.props.onTouchMove(touch(121, 330))
      target.props.onLongPress(touch(121, 330))
    })
    expect(menu(root)).toBeUndefined()
    expect(triggerMediumImpact).not.toHaveBeenCalled()
  })

  it('opens the menu for a hold that wanders less than the touch slop', async () => {
    const root = render(message('assistant', REPLY))
    const target = holdTarget(root)
    await act(async () => {
      target.props.onPressIn(touch(120, 300))
      target.props.onTouchMove(touch(123, 304))
      target.props.onLongPress(touch(123, 304))
    })
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
  })

  it('opens nothing when the list starts scrolling while the hold is pending, even once it settles', async () => {
    const row = message('assistant', REPLY)
    const root = render(row)
    await act(async () => {
      holdTarget(root).props.onPressIn(touch(120, 300))
    })
    act(() => renderer!.update(tree(row, 'light', false)))
    act(() => renderer!.update(tree(row, 'light', true)))
    await act(async () => {
      holdTarget(root).props.onLongPress(touch(120, 300))
    })
    expect(menu(root)).toBeUndefined()
  })

  it('opens nothing for a finger that went down to stop a fling', async () => {
    const row = message('assistant', REPLY)
    const root = render(row, 'light', false)
    await act(async () => {
      holdTarget(root).props.onPressIn(touch(120, 300))
    })
    // The fling stopped under the finger, and the list is at rest when the timeout fires.
    act(() => renderer!.update(tree(row, 'light', true)))
    await act(async () => {
      holdTarget(root).props.onLongPress(touch(120, 300))
    })
    expect(menu(root)).toBeUndefined()
    // The next, deliberate hold still opens it.
    await holdStill(holdTarget(root))
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
  })

  it('opens nothing for a long press Pressable reports with no press-in of its own', async () => {
    const root = render(message('assistant', REPLY))
    await act(async () => {
      holdTarget(root).props.onLongPress(touch(120, 300))
    })
    expect(menu(root)).toBeUndefined()
  })
})

describe('sizes at the edges', () => {
  it('gives an empty reply nothing to hold', () => {
    expect(holdTargets(render(message('assistant', '')))).toEqual([])
    expect(holdTargets(render(message('assistant', '   \n\n  ')))).toEqual([])
  })

  it('carries a very long reply whole into Select text', async () => {
    const long = Array.from({ length: 4000 }, (_, index) => `Line ${index} of a very long reply.`).join('\n\n')
    const root = render(message('assistant', long))
    await holdStill(holdTarget(root))
    await choose(root, 'Select text')
    // Plain lines read the same with or without the pass: nothing is cut.
    expect(words(selectBody(root)!)).toBe(markdownPlainText(long))
    expect(words(selectBody(root)!)).toBe(long)
  })

  // A message that is only markup draws as nothing; its plain text is empty, so it offers no menu.
  it.each([['empty bold marks', '****'], ['an empty fence', '```\n```']])('gives %s alone nothing to hold', (_label, text) => {
    expect(holdTargets(render(message('assistant', text)))).toEqual([])
    expect(holdTargets(render(message('user', text)))).toEqual([])
  })
})

describe('the menu is reachable and does not outlive its screen', () => {
  const ACTION = { nativeEvent: { actionName: 'longpress' } }

  it.each([
    ['a reply run', message('assistant', REPLY)],
    ['a sent prompt', message('user', 'run the gate')]
  ])('offers %s a TalkBack action that opens the same menu', async (_label, row) => {
    const root = render(row)
    const target = holdTarget(root)
    expect(target.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Message options' }])
    await act(async () => {
      target.props.onAccessibilityAction(ACTION)
    })
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
  })

  it('ignores an accessibility action it does not offer', async () => {
    const root = render(message('assistant', REPLY))
    await act(async () => {
      holdTarget(root).props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })
    })
    expect(menu(root)).toBeUndefined()
  })

  it('does not merge a reply run into one screen-reader node, so its own controls stay reachable', () => {
    const fenced = 'Run:\n\n```sh\nnpm test\n```\n\nThen push.'
    const root = render(message('assistant', fenced))
    expect(holdTarget(root).props.accessible).toBe(false)
    const copyCode = root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Copy code'
    )
    expect(copyCode).toHaveLength(1)
    expect(copyCode[0]!.props.accessible).not.toBe(false)
  })

  it('puts the menu down when the screen loses focus', async () => {
    const root = render(message('assistant', REPLY))
    await holdStill(holdTarget(root))
    expect(menu(root)).toBeDefined()
    await act(async () => {
      focusReports.report?.(false)
    })
    expect(menu(root)).toBeUndefined()
  })

  it('puts the Select text sheet down when the screen loses focus', async () => {
    const root = render(message('assistant', REPLY))
    await holdStill(holdTarget(root))
    await choose(root, 'Select text')
    expect(selectBody(root)).toBeDefined()
    await act(async () => {
      focusReports.report?.(false)
    })
    expect(selectBody(root)).toBeUndefined()
  })

  it('keeps the menu when the screen gains focus', async () => {
    const root = render(message('assistant', REPLY))
    await holdStill(holdTarget(root))
    await act(async () => {
      focusReports.report?.(true)
    })
    expect(menu(root)).toBeDefined()
  })

  it('keeps a card from an unmeasured hold near the right edge inside the window', async () => {
    const root = render(message('assistant', REPLY))
    await holdStill(holdTarget(root), 380, 300)
    const card = flat(menu(root)!.props.style)
    // 390 wide window, 16 dp edge, 180 dp minimum card.
    expect(card.left).toBe(390 - 16 - 180)
  })
})
