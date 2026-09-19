import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { useChatScrollView } from './use-mobile-chat-scroll-view'

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView'
}))

vi.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector'
}))

function Host() {
  const ChatScrollView = useChatScrollView({} as never)
  return createElement(ChatScrollView, { testID: 'list' })
}

describe('holding a word to copy it', () => {
  it('does not let Android scroll the inverted list to the selection', () => {
    // Why: reported 2026-09-19 — a long press to copy scrolled the chat away
    // instead of showing the selection. Android's text selection asks the
    // nearest ScrollView to bring the focused text on screen, and the request
    // is computed without the `scaleY: -1` an inverted FlashList paints with,
    // so the list scrolls the wrong way and the selection is gone. RN's
    // Android ScrollView gates both requests (requestChildFocus and
    // requestChildRectangleOnScreen) behind this one prop.
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Host))
    })
    const scrollView = renderer!.root.findByType('ScrollView' as never)
    expect(scrollView.props.scrollsChildToFocus).toBe(false)
    // FlashList's own props still pass through.
    expect(scrollView.props.testID).toBe('list')
  })
})
