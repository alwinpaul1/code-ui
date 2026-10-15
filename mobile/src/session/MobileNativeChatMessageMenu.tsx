import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Copy, TextCursor, Undo2, type LucideIcon } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import {
  CHAT_MESSAGE_MENU_LABELS,
  chatMessageMenuPlacement,
  MESSAGE_MENU_MIN_WIDTH,
  MESSAGE_MENU_PAD_Y,
  MESSAGE_MENU_RADIUS,
  MESSAGE_MENU_ROW_HEIGHT,
  SELECT_TEXT_SHEET_TITLE,
  type ChatMessageMenuAnchor,
  type ChatMessageMenuEntry
} from './mobile-native-chat-message-menu'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'

/** Read when a row is drawn, not when this module loads. */
function iconFor(entry: ChatMessageMenuEntry): LucideIcon {
  switch (entry) {
    case 'undo-send':
      return Undo2
    case 'copy':
      return Copy
    case 'select-text':
      // The app's glyph is its own text-select icon (a95.e.e3); this lucide has no TextSelect.
      return TextCursor
    default: {
      const unhandled: never = entry
      return unhandled
    }
  }
}

/**
 * The menu a hold on a message opens, as the Claude app draws it for a Code session (fmg.java):
 * a card hung from the held message, under it or over it where there is no room, lined up with
 * its start (Claude's words) or its end (the user's), on a full-screen layer that dims nothing.
 * A tap anywhere off the card, or Back, puts the message down; a row puts it down first and then
 * acts (i35.java:611-627, `deselect` before the action).
 */
export function MobileNativeChatMessageMenu({
  anchor,
  alignEnd,
  entries,
  onChoose,
  onClose
}: {
  /** The held message, in window coordinates; the menu shows while this is set. */
  anchor: ChatMessageMenuAnchor | null
  alignEnd: boolean
  entries: readonly ChatMessageMenuEntry[]
  onChoose: (entry: ChatMessageMenuEntry) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const screen = useWindowDimensions()
  const insets = useSafeAreaInsets()
  if (!anchor || entries.length === 0) {
    return null
  }
  const placement = chatMessageMenuPlacement({ anchor, alignEnd, rows: entries.length, window: screen, insets })
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* No colour: the app's layer clears the window's dim (ebd.java case 17, clearFlags(2)). */}
      <Pressable
        testID="message-menu-backdrop"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close menu"
      />
      <View
        testID="message-menu"
        accessibilityRole="menu"
        style={[
          styles.card,
          {
            top: placement.top,
            left: placement.left,
            right: placement.right,
            // The app's card (fmg.java `a`, through q130.t): fill `ad5.E()`, 1 dp border `ad5.A()`,
            // shadow `an7.c`; label and glyph `ad5.u0()`. The same values as the ask card's
            // `ad5` roles and the jump button's shadow, so those tokens serve (#FFFFFF / #20201F,
            // ink or white at 10%, black at 10%, #0B0B0B / #F0EFEC).
            backgroundColor: colors.askCardFill,
            borderColor: colors.askDivider,
            shadowColor: colors.jumpButtonShadow
          }
        ]}
      >
        {entries.map((entry) => {
          const Icon = iconFor(entry)
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
              <Icon size={20} color={colors.askText} strokeWidth={1.75} />
              <Txt variant="body" style={{ color: colors.askText }}>
                {CHAT_MESSAGE_MENU_LABELS[entry]}
              </Txt>
            </Pressable>
          )
        })}
      </View>
    </Modal>
  )
}

/**
 * The sheet Select text opens (com.anthropic.claude 1.261009.20: CodeRemoteBottomSheetDestination
 * .SelectText, drawn by bottomsheet/b.java:2349-2362): titled "Select text", holding one Text in a
 * SelectionContainer, the message's words as drawn, without Markdown marks (the Claude app shows the source; Code UI's choice, 2026-10-15), in the body face and primary ink. A hold
 * on the words starts Android's own selection with its handles and toolbar; there is no Copy
 * button of the sheet's own. Not draggable by its content: a drag meant to extend a selection
 * must not move the sheet. The cross, the scrim and Back close it.
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
    minWidth: MESSAGE_MENU_MIN_WIDTH,
    paddingVertical: MESSAGE_MENU_PAD_Y,
    borderRadius: MESSAGE_MENU_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4
  },
  row: {
    height: MESSAGE_MENU_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16
  }
})
