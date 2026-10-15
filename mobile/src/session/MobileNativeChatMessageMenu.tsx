import { useEffect, useState } from 'react'
import { Animated, Keyboard, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Undo2 } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import {
  CHAT_MESSAGE_MENU_LABELS,
  chatMessageMenuHeight,
  chatMessageMenuPlacement,
  MESSAGE_MENU_ALPHA_SPRING,
  MESSAGE_MENU_CLOSED_SCALE,
  MESSAGE_MENU_ELEVATION,
  MESSAGE_MENU_GLYPH,
  MESSAGE_MENU_GLYPH_GAP,
  MESSAGE_MENU_MIN_WIDTH,
  MESSAGE_MENU_PAD_Y,
  MESSAGE_MENU_RADIUS,
  MESSAGE_MENU_ROW_HEIGHT,
  MESSAGE_MENU_ROW_INSET,
  MESSAGE_MENU_ROW_MAX_WIDTH,
  MESSAGE_MENU_ROW_MIN_WIDTH,
  MESSAGE_MENU_ROW_PAD_X,
  MESSAGE_MENU_SCALE_SPRING,
  SELECT_TEXT_SHEET_TITLE,
  type ChatMessageMenuAnchor,
  type ChatMessageMenuEntry
} from './mobile-native-chat-message-menu'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'

type GlyphProps = { size: number; color: string; testID?: string }

/** The app's `copy` glyph (its icon font, U+E056): two 11 dp rounded squares, the back one
 *  showing only where it clears the front, drawn on a 20 dp grid with a 1.1 dp line. */
function CopyGlyph({ size, color, testID }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" testID={testID} color={color}>
      <Rect x={2.5} y={2.5} width={10.5} height={10.5} rx={1} stroke={color} strokeWidth={1.1} />
      <Path d="M12.5 6.5H15.5A1 1 0 0 1 16.5 7.5V15.5A1 1 0 0 1 15.5 16.5H7.5A1 1 0 0 1 6.5 15.5V12.5" stroke={color} strokeWidth={1.1} />
    </Svg>
  )
}

/** The app's `select` glyph (U+E0D5): a page with two lines of text, open at two corners where
 *  a selection handle sits. */
function SelectGlyph({ size, color, testID }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" testID={testID} color={color}>
      <Path d="M3.5 3V15.5A1 1 0 0 0 4.5 16.5H12.5M16.5 17V4.5A1 1 0 0 0 15.5 3.5H7.5M6.5 8.5H13.5M6.5 11.5H10.5" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
      <Circle cx={3.5} cy={3.5} r={1.3} stroke={color} strokeWidth={0.6} />
      <Circle cx={16.5} cy={16.5} r={1.3} stroke={color} strokeWidth={0.6} />
    </Svg>
  )
}

function UndoGlyph({ size, color, testID }: GlyphProps) {
  return <Undo2 size={size} color={color} strokeWidth={1.75} testID={testID} />
}

/** Read when a row is drawn, not when this module loads. */
function glyphFor(entry: ChatMessageMenuEntry): { Glyph: (props: GlyphProps) => React.JSX.Element; id: string } {
  switch (entry) {
    case 'undo-send':
      return { Glyph: UndoGlyph, id: 'undo' }
    case 'copy':
      return { Glyph: CopyGlyph, id: 'copy' }
    case 'select-text':
      return { Glyph: SelectGlyph, id: 'select' }
    default: {
      const unhandled: never = entry
      return unhandled
    }
  }
}

/** The keyboard's height while it is up: Compose's popup window is the visible display frame,
 *  so the menu keeps its margin from the keyboard, not from the screen's foot. */
function keyboardHeight(): number {
  const metrics = typeof Keyboard?.metrics === 'function' ? Keyboard.metrics() : undefined
  return metrics?.height ?? 0
}

/**
 * The menu a hold on a sent prompt opens, as the Claude app draws it for a Code session
 * (1.261013.20 gy30.e in Material 3's DropdownMenu, qs30.a -> oxb.a -> ccr.d): a card dropped
 * from the bubble's bottom-end corner with no gap, its right edge on the bubble's, or with its
 * bottom on that corner where there is no room under it; on a layer that dims nothing. It grows
 * from 80 % and fades in from the anchored corner, and shrinks and fades back out when it is put
 * down. A tap anywhere off the card, or Back, puts the message down; a row puts it down first and
 * then acts (gy1 cases 4 and 5).
 *
 * The card stays mounted while it leaves; `onAfterClose` says it has gone.
 */
export function MobileNativeChatMessageMenu({
  anchor,
  visible,
  entries,
  onChoose,
  onClose,
  onAfterClose
}: {
  /** The held message, in window coordinates. */
  anchor: ChatMessageMenuAnchor | null
  /** False puts the card down: it leaves, then `onAfterClose` is called. */
  visible: boolean
  entries: readonly ChatMessageMenuEntry[]
  onChoose: (entry: ChatMessageMenuEntry) => void
  onClose: () => void
  onAfterClose?: () => void
}) {
  const { colors } = useTheme()
  const screen = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion() === true
  const [width, setWidth] = useState<number | null>(null)
  const [scale] = useState(() => new Animated.Value(reduceMotion ? 1 : MESSAGE_MENU_CLOSED_SCALE))
  const [alpha] = useState(() => new Animated.Value(reduceMotion ? 1 : 0))
  const shown = anchor !== null && entries.length > 0
  useEffect(() => {
    if (!shown) {
      return undefined
    }
    if (reduceMotion) {
      scale.setValue(visible ? 1 : MESSAGE_MENU_CLOSED_SCALE)
      alpha.setValue(visible ? 1 : 0)
      if (!visible) {
        onAfterClose?.()
      }
      return undefined
    }
    const motion = Animated.parallel([
      Animated.spring(scale, {
        ...MESSAGE_MENU_SCALE_SPRING,
        toValue: visible ? 1 : MESSAGE_MENU_CLOSED_SCALE,
        useNativeDriver: true
      }),
      Animated.spring(alpha, { ...MESSAGE_MENU_ALPHA_SPRING, toValue: visible ? 1 : 0, useNativeDriver: true })
    ])
    motion.start(({ finished }) => {
      if (finished && !visible) {
        onAfterClose?.()
      }
    })
    return () => motion.stop()
    // onAfterClose is the caller's latest; a new one does not restart the motion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shown, reduceMotion, scale, alpha])
  if (!shown) {
    return null
  }
  const placement = chatMessageMenuPlacement({
    anchor,
    card: { width: width ?? MESSAGE_MENU_MIN_WIDTH, height: chatMessageMenuHeight(entries.length) },
    window: screen,
    insets: {
      top: insets.top,
      bottom: Math.max(insets.bottom, keyboardHeight()),
      left: insets.left,
      right: insets.right
    }
  })
  const { x: originX, y: originY } = placement.transformOrigin
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* No colour: the app's layer clears the window's dim (ebd.java case 17, clearFlags(2)). */}
      <Pressable
        testID="message-menu-backdrop"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close menu"
      />
      <Animated.View
        testID="message-menu"
        accessibilityRole="menu"
        pointerEvents={visible ? 'auto' : 'none'}
        onLayout={(event) => {
          const measured = event.nativeEvent.layout.width
          if (measured > 0 && measured !== width) {
            setWidth(measured)
          }
        }}
        style={[
          styles.card,
          {
            top: placement.top,
            left: placement.left,
            right: placement.right,
            // Material's surfaceContainer, which the app sets to its card fill (e54.x: ym7.p,
            // #FFFFFF light, #20201F dark), the same value as the ask card's fill.
            backgroundColor: colors.askCardFill,
            shadowColor: colors.jumpButtonShadow,
            opacity: alpha,
            transformOrigin: `${originX * 100}% ${originY * 100}% 0`,
            transform: [{ scale }]
          }
        ]}
      >
        {entries.map((entry) => {
          const { Glyph, id } = glyphFor(entry)
          return (
            <Pressable
              key={entry}
              accessibilityRole="menuitem"
              onPress={() => {
                onClose()
                onChoose(entry)
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.askBadge }]}
            >
              {/* onSurfaceVariant (s79 token 18 = ym7.Q, #7B7974 / #97958D) for the glyph,
                  onSurface (token 17 = ym7.O, #131313 / #F9F9F7) for the label: jql.b. */}
              <Glyph size={MESSAGE_MENU_GLYPH} color={colors.composerPlaceholder} testID={`message-menu-glyph-${id}`} />
              <Txt variant="body" numberOfLines={1} style={{ color: colors.jumpButtonGlyph }}>
                {CHAT_MESSAGE_MENU_LABELS[entry]}
              </Txt>
            </Pressable>
          )
        })}
      </Animated.View>
    </Modal>
  )
}

/**
 * The sheet Select text opens (com.anthropic.claude 1.261013.20: CodeRemoteBottomSheetDestination
 * .SelectText, drawn by bottomsheet/b.java `v`: one Text in a SelectionContainer, full width,
 * inside the sheet's content padding, under the sheet's own frame: a cross at the start and the
 * title "Select text" centred). It holds the message's words as drawn, without Markdown marks
 * (the Claude app shows the source; Code UI's choice, 2026-10-15), in the body face and primary
 * ink. A hold on the words starts Android's own selection with its handles and toolbar; there is
 * no Copy button of the sheet's own. Not draggable by its content: a drag meant to extend a
 * selection must not move the sheet. The cross, the scrim and Back close it.
 */
export function MobileNativeChatSelectTextSheet({
  visible,
  text,
  onClose,
  onAfterClose
}: {
  visible: boolean
  text: string
  onClose: () => void
  /** The sheet has left the screen; the caller may let go of the text. */
  onAfterClose?: () => void
}) {
  const { colors } = useTheme()
  const styles = useChatMessageStyles()
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={onAfterClose}
      dragContentToDismiss={false}
      dismissKeyboardOnOpen
      header={<MobileSheetTitleBar title={SELECT_TEXT_SHEET_TITLE} onClose={onClose} />}
    >
      <Txt
        selectable
        testID="select-text-body"
        style={[
          {
            fontFamily: styles.userText.fontFamily,
            fontSize: styles.userText.fontSize,
            lineHeight: styles.userText.lineHeight
          },
          { color: colors.askText }
        ]}
      >
        {text}
      </Txt>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    paddingVertical: MESSAGE_MENU_PAD_Y,
    borderRadius: MESSAGE_MENU_RADIUS,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: MESSAGE_MENU_ELEVATION
  },
  row: {
    height: MESSAGE_MENU_ROW_HEIGHT,
    minWidth: MESSAGE_MENU_ROW_MIN_WIDTH,
    maxWidth: MESSAGE_MENU_ROW_MAX_WIDTH,
    marginHorizontal: MESSAGE_MENU_ROW_INSET,
    paddingHorizontal: MESSAGE_MENU_ROW_PAD_X,
    borderRadius: MESSAGE_MENU_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    gap: MESSAGE_MENU_GLYPH_GAP
  }
})
