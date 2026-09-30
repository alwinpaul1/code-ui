import { useState } from 'react'
import { Keyboard, Pressable, type ViewStyle } from 'react-native'
import { Plus } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'
import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'

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
  agentMode = null,
  onOpenPermission
}: {
  iconButtonStyle: ViewStyle
  disabled: boolean
  onCaptureImage?: () => void
  onAttachImage: () => void
  onAttachFile?: () => void
  permissionMode: TerminalPermissionMode | null
  /** Codex's Plan/Default mode, set only on a Codex tab; the attach sheet's
   *  row then names it instead of a permission mode Codex does not have. */
  agentMode?: TerminalAgentMode | null
  /** Opens the permission-mode sheet (the agent-mode sheet on Codex) from the
   *  attach sheet's permission row. */
  onOpenPermission?: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  const [sheetOpen, setSheetOpen] = useState(false)
  // With a file option the + opens a small chooser (Claude's "Add to Chat"
  // sheet); without one it keeps opening Photos directly.
  const opensSheet = Boolean(onAttachFile || onCaptureImage)

  // On touch-down, and the keyboard first. The sheet's Modal window takes
  // focus when it shows, and until now that alone sent the keyboard away:
  // on the device (S23 Ultra, keyboard up, 2026-09-27) the keyboard started
  // to leave 128 ms after the finger lifted, and the sheet, already open and
  // at rest under it, was uncovered row by row until 286 ms. Asked here, the
  // keyboard is on its way out while the window is still being built, and
  // the ~80 ms the finger rests on the + is no longer spent waiting for it
  // to lift. The + sits in the dock, outside the chat list, so no scroll can
  // claim a touch after it has opened the sheet. onPress stays for a screen
  // reader's click, which comes with no press-in; the release after a
  // press-in finds the sheet open and changes nothing.
  const openSheet = (): void => {
    Keyboard.dismiss()
    setSheetOpen(true)
  }
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
        onPressIn={opensSheet ? openSheet : undefined}
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
          agentMode={agentMode}
          onOpenPermission={onOpenPermission}
        />
      ) : null}
    </>
  )
}
