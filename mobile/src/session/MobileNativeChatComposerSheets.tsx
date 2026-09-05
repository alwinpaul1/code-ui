import { Image as ImageIcon, Paperclip } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import type { TerminalHudContextWindow, TerminalPermissionMode } from './mobile-terminal-hud-parse'

/** The composer's three bottom sheets: mode picker, context window, add-to-chat. */
export function MobileNativeChatComposerSheets({
  showModeSheet,
  onCloseModeSheet,
  permissionMode,
  onSelectPermissionMode,
  showContextSheet,
  onCloseContextSheet,
  contextWindow,
  showAttachSheet,
  onCloseAttachSheet,
  onAttachImage,
  onAttachFile
}: {
  showModeSheet: boolean
  onCloseModeSheet: () => void
  permissionMode: TerminalPermissionMode | null
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  showContextSheet: boolean
  onCloseContextSheet: () => void
  contextWindow: TerminalHudContextWindow | null
  showAttachSheet: boolean
  onCloseAttachSheet: () => void
  onAttachImage?: () => void
  onAttachFile?: () => void
}) {
  return (
    <>
      <MobilePermissionModeSheet
        visible={showModeSheet}
        current={permissionMode}
        onSelect={(mode) => {
          onCloseModeSheet()
          onSelectPermissionMode?.(mode)
        }}
        onClose={onCloseModeSheet}
      />
      <MobileContextWindowSheet
        visible={showContextSheet}
        context={contextWindow}
        onClose={onCloseContextSheet}
      />
      {onAttachImage && onAttachFile ? (
        <ActionSheetModal
          visible={showAttachSheet}
          title="Add to chat"
          actions={[
            {
              label: 'Photos',
              hint: 'Pick from your photo library',
              icon: ImageIcon,
              onPress: onAttachImage
            },
            {
              label: 'Files',
              hint: 'PDF, documents, code, anything on this phone',
              icon: Paperclip,
              onPress: onAttachFile
            }
          ]}
          onClose={onCloseAttachSheet}
        />
      ) : null}
    </>
  )
}
