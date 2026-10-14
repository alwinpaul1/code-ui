import { Copy, TextCursor, Undo2 } from 'lucide-react-native'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import {
  SELECT_TEXT_SHEET_TITLE,
  USER_MESSAGE_MENU_LABELS,
  type UserMessageMenuEntry
} from './mobile-native-chat-user-message-menu'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'

/**
 * What a hold on a sent message opens: the Claude app's message menu
 * (mobile-native-chat-user-message-menu.ts), as one of Code UI's sheets. Select
 * text opens its own sheet, so it waits for this one to leave (the dual-Modal
 * race, #10331); Copy and Undo send act at once.
 */
export function MobileNativeChatUserMessageMenu({
  visible,
  entries,
  onCopy,
  onSelectText,
  onUndoSend,
  onClose
}: {
  visible: boolean
  entries: readonly UserMessageMenuEntry[]
  onCopy: () => void
  onSelectText: () => void
  onUndoSend?: () => void
  onClose: () => void
}) {
  const actions: ActionSheetAction[] = []
  for (const entry of entries) {
    switch (entry) {
      case 'undo-send':
        if (onUndoSend) {
          actions.push({ label: USER_MESSAGE_MENU_LABELS[entry], icon: Undo2, onPress: onUndoSend })
        }
        break
      case 'copy':
        actions.push({ label: USER_MESSAGE_MENU_LABELS[entry], icon: Copy, onPress: onCopy })
        break
      case 'select-text':
        actions.push({
          label: USER_MESSAGE_MENU_LABELS[entry],
          icon: TextCursor,
          closeBeforePress: true,
          onPress: onSelectText
        })
        break
      default: {
        const unhandled: never = entry
        return unhandled
      }
    }
  }
  return <ActionSheetModal visible={visible} actions={actions} onClose={onClose} />
}

/**
 * The whole message in a sheet, selectable: a hold on the words here starts
 * Android's own selection with its handles, which a sent prompt's bubble in the
 * list cannot offer (a hold there opens the menu). Not draggable by its
 * content: a drag that is meant to extend a selection must not move the sheet.
 * The cross, the scrim and Back close it.
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
          // The reader's transcript face and size, in the sheet's own ink: the bubble's is for its fill.
          {
            fontFamily: styles.userText.fontFamily,
            fontSize: styles.userText.fontSize,
            lineHeight: styles.userText.lineHeight
          },
          { color: colors.text }
        ]}
      >
        {text}
      </Txt>
    </BottomDrawer>
  )
}
