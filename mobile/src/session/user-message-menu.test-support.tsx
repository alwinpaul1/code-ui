import { createElement, useEffect, useRef, type ReactNode } from 'react'
import { act, type ReactTestInstance } from 'react-test-renderer'

// What a test needs to drive a hold on a sent prompt through its menu
// (MobileNativeChatMessage's Bubble). A hold used to copy at once; it opens the
// Claude app's menu now (mobile-native-chat-user-message-menu.ts), and Copy
// message is a row in it. Tests that mock `react-native` down to a few tags
// also mock '../components/BottomDrawer' with `BottomDrawerDouble`, since the
// real drawer is a Modal with gestures.

type DoubleProps = {
  visible: boolean
  header?: ReactNode
  children?: ReactNode
  onAfterClose?: () => void
}

/** A drawer that shows its header and children while `visible`, and says "after
 *  close" when it goes from shown to hidden, as the real one does when its exit ends. */
export function BottomDrawerDouble(props: DoubleProps): ReactNode {
  const was = useRef(props.visible)
  useEffect(() => {
    if (was.current && !props.visible) {
      props.onAfterClose?.()
    }
    was.current = props.visible
  }, [props.visible, props.onAfterClose])
  return props.visible
    ? createElement('BottomDrawer', props as never, props.header, props.children)
    : null
}

const wordsOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(wordsOf).join('')

/** The bubble that takes the hold. */
export function sentPromptBubble(root: ReactTestInstance): ReactTestInstance {
  return root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sent prompt'
  )
}

/** The menu's row with these words on it. */
export function menuRow(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === undefined &&
      wordsOf(node) === label
  )
}

/** Hold the sent prompt, then press a row of the menu it opens. */
export async function holdThenChoose(root: ReactTestInstance, label: string): Promise<void> {
  await act(async () => {
    sentPromptBubble(root).props.onLongPress()
  })
  await act(async () => {
    menuRow(root, label).props.onPress()
  })
}
