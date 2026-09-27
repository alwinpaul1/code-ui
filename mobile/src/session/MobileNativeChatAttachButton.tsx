import { useState } from 'react'
import { Pressable, type ViewStyle } from 'react-native'
import { Plus } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

/** The composer's + and the Add context sheet it opens.
 *
 *  The open flag lives here, not in the composer, so opening and closing the
 *  sheet re-renders this button and the sheet only. It used to re-run the
 *  whole composer first (text field, chips, pills, ring, the other sheets),
 *  in front of the commit that mounts the sheet's window and in front of the
 *  Photos tap's picker launch. The sheet is a native Modal, so where it sits
 *  in the tree does not move it on screen. */
export function MobileNativeChatAttachButton({
  iconButtonStyle,
  disabled,
  onCaptureImage,
  onAttachImage,
  onAttachFile,
  permissionMode,
  onOpenPermission
}: {
  iconButtonStyle: ViewStyle
  disabled: boolean
  onCaptureImage?: () => void
  onAttachImage: () => void
  onAttachFile?: () => void
  permissionMode: TerminalPermissionMode | null
  /** Opens the permission-mode sheet from the attach sheet's permission row. */
  onOpenPermission?: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  const [sheetOpen, setSheetOpen] = useState(false)
  // With a file option the + opens a small chooser (Claude's "Add to Chat"
  // sheet); without one it keeps opening Photos directly.
  const opensSheet = Boolean(onAttachFile || onCaptureImage)
  const openSheet = (): void => setSheetOpen(true)
  const closeSheet = (): void => setSheetOpen(false)

  return (
    <>
      <Pressable
        focusable={false}
        accessibilityLabel={onAttachFile ? 'Add to chat' : 'Attach image'}
        style={({ pressed }) => [
          iconButtonStyle,
          { backgroundColor: pressed ? colors.bgRaised : 'transparent' }
        ]}
        onPress={opensSheet ? openSheet : onAttachImage}
        disabled={disabled}
      >
        <Plus size={20} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
      {onAttachFile ? (
        <MobileNativeChatAttachSheet
          visible={sheetOpen}
          onClose={closeSheet}
          onCaptureImage={onCaptureImage}
          onAttachImage={onAttachImage}
          onAttachFile={onAttachFile}
          permissionMode={permissionMode}
          onOpenPermission={onOpenPermission}
        />
      ) : null}
    </>
  )
}
