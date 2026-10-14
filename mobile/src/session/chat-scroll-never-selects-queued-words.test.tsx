import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { ChatTextHoldSelectsContext, ChatTextSelectableContext } from '../components/chat-text-selectable-context'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'

// The user, 2026-10-15, on 0.9.147: "when scrolling the hold to copy triggers sometime".
//
// The queue box is drawn in the chat list's header, so the finger that scrolls the transcript
// lands on it like on any reply. A queued message nobody can edit by tap is selectable, and it was
// selectable through every scroll: the only text in the list the scroll's guard against a stray
// hold (the 2026-09-12 rule, chat-text-selectable-context.ts) never reached. A finger that caught
// a fling on it, or rested on it before the list moved, started a selection there. These tests
// read whether a queued message's words would take a hold, as the chat draws them while it
// scrolls and while it is still.

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light',
  processColor: () => -1
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('../components/markdown-selection-copy', () => import('../components/markdown-selection-copy.android'))
vi.mock('./image-preview-store', () => ({ openImagePreview: vi.fn() }))
vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil' }))

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function show(
  messages: string[],
  flags: { selectable: boolean; holds: boolean },
  options: { scheme?: 'light' | 'dark'; onEdit?: () => Promise<void> } = {}
): void {
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: options.scheme ?? 'light' },
        createElement(
          ChatTextSelectableContext.Provider,
          { value: flags.selectable },
          createElement(
            ChatTextHoldSelectsContext.Provider,
            { value: flags.holds },
            createElement(MobileNativeChatQueue, { messages, agent: 'claude', onEdit: options.onEdit })
          )
        )
      )
    )
  })
}

/** Would a hold on these words start a selection: a selectable Text that no native root above it
 *  has told to refuse holds (SelectionCopyRootView.applyHoldSelects). */
function takesHold(text: ReactTestInstance): boolean {
  if (text.props.selectable !== true) {
    return false
  }
  for (let node: ReactTestInstance | null = text.parent; node; node = node.parent) {
    if (node.type === (NATIVE_ROOT as never) && node.props.holdSelects === false) {
      return false
    }
  }
  return true
}

function wordsOf(words: string): ReactTestInstance {
  return renderer!.root.find((node) => node.type === ('Text' as never) && node.props.children === words)
}

const SCROLLING_WITH_A_SELECTION_HELD = { selectable: true, holds: false }
const SCROLLING = { selectable: false, holds: false }
const STILL = { selectable: true, holds: true }

describe('a scroll never starts a selection in a queued message', () => {
  it.each(['light', 'dark'] as const)('keeps a hold off a queued message while the list scrolls (%s)', (scheme) => {
    show(['run the tests again', 'then push'], SCROLLING, { scheme })
    expect(takesHold(wordsOf('run the tests again'))).toBe(false)
    expect(takesHold(wordsOf('then push'))).toBe(false)
  })

  it('keeps a hold off a queued message while the list scrolls with words held in a reply', () => {
    show(['run the tests again'], SCROLLING_WITH_A_SELECTION_HELD)
    expect(takesHold(wordsOf('run the tests again'))).toBe(false)
  })

  it('keeps the words selectable through the scroll, so a selection already in them stays', () => {
    show(['run the tests again'], SCROLLING_WITH_A_SELECTION_HELD)
    expect(wordsOf('run the tests again').props.selectable).toBe(true)
  })

  it.each(['light', 'dark'] as const)('lets a hold select a queued message once the list is still (%s)', (scheme) => {
    show(['run the tests again'], STILL, { scheme })
    expect(takesHold(wordsOf('run the tests again'))).toBe(true)
  })

  it('never makes a message a tap edits selectable, scrolling or not', () => {
    show(['run the tests again'], STILL, { onEdit: () => Promise.resolve() })
    expect(takesHold(wordsOf('run the tests again'))).toBe(false)
  })

  it('draws no queue for an empty one', () => {
    show([], SCROLLING)
    expect(renderer!.root.findAll((node) => node.type === ('Text' as never))).toHaveLength(0)
  })
})
