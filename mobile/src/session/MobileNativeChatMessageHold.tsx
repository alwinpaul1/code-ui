import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useChatMessageHold, type ChatHoldPoint } from './chat-message-hold'
import {
  chatMessageMenuEntries,
  type ChatMessageMenuAnchor,
  type ChatMessageMenuEntry
} from './mobile-native-chat-message-menu'
import { MobileNativeChatMessageMenu, MobileNativeChatSelectTextSheet } from './MobileNativeChatMessageMenu'

/** What a hold opens a menu with: the held view, the point the finger was on. */
export type HoldHandler = (target: View | null, at: ChatHoldPoint) => void

/**
 * A view that opens its message's menu on a hold (chat-message-hold.ts): the Claude app's
 * long-press on a prose row, gated so a scroll never opens it. Its own native view, so the menu
 * can be hung from the box it measures.
 */
export function HoldTarget({
  onHold,
  style,
  children,
  ...rest
}: {
  onHold?: HoldHandler
  style?: StyleProp<ViewStyle>
  children: ReactNode
} & Pick<
  ComponentProps<typeof Pressable>,
  'onPress' | 'accessibilityRole' | 'accessibilityLabel' | 'accessibilityHint' | 'testID'
>) {
  const ref = useRef<View>(null)
  const hold = useChatMessageHold(onHold ? (at) => onHold(ref.current, at) : undefined)
  return (
    <Pressable ref={ref} style={style} collapsable={false} {...rest} {...hold}>
      {children}
    </Pressable>
  )
}

/** A run of a reply's words: a hold opens its menu when it has words to offer, else a plain view. */
export function ProseHold({ onHold, children }: { onHold?: HoldHandler; children: ReactNode }) {
  return onHold ? <HoldTarget onHold={onHold}>{children}</HoldTarget> : <>{children}</>
}

/** The menu a hold opened, and what its rows act on. */
type HeldMessage = {
  anchor: ChatMessageMenuAnchor
  alignEnd: boolean
  entries: ChatMessageMenuEntry[]
  text: string
  /** The bubble's Copy tints the bubble; a reply's run says only a refusal. */
  tintsBubble: boolean
}

/** The held view's box, or the point the finger was on where the view cannot be measured. */
function measureHeld(
  target: View | null,
  at: ChatHoldPoint,
  then: (anchor: ChatMessageMenuAnchor) => void
): void {
  const point = { x: at.x, y: at.y, width: 0, height: 0 }
  if (target === null || typeof target.measureInWindow !== 'function') {
    then(point)
    return
  }
  target.measureInWindow((x, y, width, height) => {
    then(width > 0 || height > 0 ? { x, y, width, height } : point)
  })
}

/**
 * A message row's hold: which text a hold offers, the menu it opens and the Select text sheet.
 * Copy and Select text give the words as they arrived, Markdown source and all, as the Claude
 * app's give `Prose.text` (mobile-native-chat-message-menu.ts). Nothing is mounted until a hold
 * asks for it (a list of rows carries no menu or sheet per row), and the words are kept until
 * their sheet has left the screen.
 *
 * The list recycles a row's instance for other messages, and what was opened belongs to the one
 * it was opened on: it is dropped the moment another message is bound here, so it neither follows
 * to the next row nor opens by itself when a message comes back.
 */
export function useMobileNativeChatMessageHold({
  messageId,
  onUndoSend,
  copyBubble,
  copyRun
}: {
  messageId: string
  /** Present while the message waits behind a running turn. */
  onUndoSend?: () => void
  /** The bubble's copy, which tints it; and a reply's run's, which says only a refusal. */
  copyBubble: (text: string) => void
  copyRun: (text: string) => void
}): {
  /** The hold for `text`: the user's own (hung from its end, `alignEnd`) or a reply's run.
   *  Undefined when the message offers nothing, so a hold does nothing. */
  holdOn: (text: string, alignEnd: boolean) => HoldHandler | undefined
  overlays: ReactNode
} {
  const [held, setHeld] = useState<HeldMessage | null>(null)
  const [selecting, setSelecting] = useState<{ text: string; open: boolean } | null>(null)
  // Select text's words, waiting for the menu's layer to be gone: two native modals shown and
  // dismissed in one commit can race (react-native #10331), so the sheet opens a commit later.
  const [selectNext, setSelectNext] = useState<string | null>(null)
  const [openedOn, setOpenedOn] = useState(messageId)
  if (openedOn !== messageId) {
    setOpenedOn(messageId)
    setHeld(null)
    setSelecting(null)
    setSelectNext(null)
  }
  useEffect(() => {
    if (selectNext !== null && held === null) {
      setSelecting({ text: selectNext, open: true })
      setSelectNext(null)
    }
  }, [selectNext, held])
  const holdOn = (text: string, alignEnd: boolean): HoldHandler | undefined => {
    const entries = chatMessageMenuEntries({ hasText: text !== '', waiting: alignEnd && onUndoSend !== undefined })
    if (entries.length === 0) {
      return undefined
    }
    return (target, at) =>
      measureHeld(target, at, (anchor) => setHeld({ anchor, alignEnd, entries, text, tintsBubble: alignEnd }))
  }
  const choose = (entry: ChatMessageMenuEntry): void => {
    if (!held) {
      return
    }
    switch (entry) {
      case 'undo-send':
        onUndoSend?.()
        return
      case 'copy':
        if (held.tintsBubble) {
          copyBubble(held.text)
        } else {
          copyRun(held.text)
        }
        return
      case 'select-text':
        setSelectNext(held.text)
        return
      default: {
        const unhandled: never = entry
        return unhandled
      }
    }
  }
  const overlays = (
    <>
      {held ? (
        <MobileNativeChatMessageMenu
          anchor={held.anchor}
          alignEnd={held.alignEnd}
          entries={held.entries}
          onChoose={choose}
          onClose={() => setHeld(null)}
        />
      ) : null}
      {selecting ? (
        <MobileNativeChatSelectTextSheet
          visible={selecting.open}
          text={selecting.text}
          onClose={() => setSelecting((current) => (current ? { ...current, open: false } : null))}
          onAfterClose={() => setSelecting(null)}
        />
      ) : null}
    </>
  )
  return { holdOn, overlays }
}
