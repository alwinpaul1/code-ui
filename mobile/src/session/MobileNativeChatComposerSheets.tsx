import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import { MobileAgentModeSheet } from './MobileAgentModeSheet'
import type {
  TerminalAgentMode,
  TerminalHudContextWindow,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'

/** The composer's mode picker and context window sheets. The add-to-chat
 *  sheet belongs to the + (MobileNativeChatAttachButton), which keeps its
 *  open flag out of the composer's state. */
export function MobileNativeChatComposerSheets({
  showModeSheet,
  onCloseModeSheet,
  permissionMode,
  onSelectPermissionMode,
  agentMode = null,
  onSelectAgentMode,
  showContextSheet,
  onCloseContextSheet,
  contextWindow
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
    </>
  )
}
