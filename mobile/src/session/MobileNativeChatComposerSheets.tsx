import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import { MobileAgentModeSheet } from './MobileAgentModeSheet'
import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'

/** The composer's mode picker sheet. The add-to-chat sheet belongs to the +
 *  (MobileNativeChatAttachButton), which keeps its open flag out of the
 *  composer's state. The context window sheet moved to the session header
 *  with the ring (MobileSessionHeader.tsx, parity gap G9). */
export function MobileNativeChatComposerSheets({
  showModeSheet,
  onCloseModeSheet,
  permissionMode,
  onSelectPermissionMode,
  agentMode = null,
  onSelectAgentMode
}: {
  showModeSheet: boolean
  onCloseModeSheet: () => void
  permissionMode: TerminalPermissionMode | null
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  agentMode?: TerminalAgentMode | null
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
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
    </>
  )
}
