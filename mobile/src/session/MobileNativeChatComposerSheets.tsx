import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import { MobileAgentModeSheet } from './MobileAgentModeSheet'
import type {
  TerminalAgentMode,
  TerminalHudContextWindow,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'

/** The composer's three bottom sheets: mode picker, context window, add-to-chat. */
export function MobileNativeChatComposerSheets({
  showModeSheet,
  onCloseModeSheet,
  permissionMode,
  onSelectPermissionMode,
  agentMode = null,
  onSelectAgentMode,
  showContextSheet,
  onCloseContextSheet,
  contextWindow,
  showAttachSheet,
  onCloseAttachSheet,
  onCaptureImage,
  onAttachImage,
  onAttachFile,
  onOpenPermission
}: {
  showModeSheet: boolean
  onCloseModeSheet: () => void
  permissionMode: TerminalPermissionMode | null
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  agentMode?: TerminalAgentMode | null
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
  showContextSheet: boolean
  onCloseContextSheet: () => void
  contextWindow: TerminalHudContextWindow | null
  showAttachSheet: boolean
  onCloseAttachSheet: () => void
  onCaptureImage?: () => void
  onAttachImage?: () => void
  onAttachFile?: () => void
  /** Opens the permission-mode sheet from the attach sheet's permission row. */
  onOpenPermission?: () => void
}) {
  return (
    <>
      {agentMode ? (
        <MobileAgentModeSheet
          visible={showModeSheet}
          current={agentMode}
          onSelect={(mode) => {
            onCloseModeSheet()
            onSelectAgentMode?.(mode)
          }}
          onClose={onCloseModeSheet}
        />
      ) : (
        <MobilePermissionModeSheet
          visible={showModeSheet}
          current={permissionMode}
          onSelect={(mode) => {
            onCloseModeSheet()
            onSelectPermissionMode?.(mode)
          }}
          onClose={onCloseModeSheet}
        />
      )}
      <MobileContextWindowSheet
        visible={showContextSheet}
        context={contextWindow}
        onClose={onCloseContextSheet}
      />
      {onAttachImage && onAttachFile ? (
        <MobileNativeChatAttachSheet
          visible={showAttachSheet}
          onClose={onCloseAttachSheet}
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
