import { useEffect, useState } from 'react'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import { MobileAutoModeOptInSheet } from './MobileAutoModeOptInSheet'
import { loadAutoModeOptedIn, saveAutoModeOptedIn } from '../storage/auto-mode-opt-in'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import { MobileAgentModeSheet } from './MobileAgentModeSheet'
import type {
  TerminalAgentMode,
  TerminalHudContextWindow,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'

/** The composer's mode picker, Auto's opt-in, and context window sheets. The add-to-chat
 *  sheet belongs to the + (MobileNativeChatAttachButton), which keeps its
 *  open flag out of the composer's state. */
export function MobileNativeChatComposerSheets({
  showModeSheet,
  onCloseModeSheet,
  permissionMode,
  runningModel = null,
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
  /** The model the agent says is running, which can rule Auto out. */
  runningModel?: string | null
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  agentMode?: TerminalAgentMode | null
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
  showContextSheet: boolean
  onCloseContextSheet: () => void
  contextWindow: TerminalHudContextWindow | null
}) {
  // Read once; until it answers the phone has not been told yes, so the
  // question is asked (the Claude app's opt-in, MobileAutoModeOptInSheet.tsx).
  const [optedIn, setOptedIn] = useState(false)
  const [askAutoOptIn, setAskAutoOptIn] = useState(false)
  useEffect(() => {
    let live = true
    void loadAutoModeOptedIn().then((value) => {
      if (live && value) {
        setOptedIn(true)
      }
    })
    return () => {
      live = false
    }
  }, [])
  const pickPermissionMode = (mode: TerminalPermissionMode): void => {
    onCloseModeSheet()
    // Asked only on the way INTO Auto: a session already in it was put there
    // on the desktop, and re-picking it changes nothing.
    if (mode === 'auto' && permissionMode !== 'auto' && !optedIn) {
      setAskAutoOptIn(true)
      return
    }
    onSelectPermissionMode?.(mode)
  }
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
          runningModel={runningModel}
          onSelect={pickPermissionMode}
          onClose={onCloseModeSheet}
        />
      )}
      <MobileAutoModeOptInSheet
        visible={askAutoOptIn}
        onEnable={() => {
          setAskAutoOptIn(false)
          setOptedIn(true)
          void saveAutoModeOptedIn()
          onSelectPermissionMode?.('auto')
        }}
        onClose={() => setAskAutoOptIn(false)}
      />
      <MobileContextWindowSheet
        visible={showContextSheet}
        context={contextWindow}
        onClose={onCloseContextSheet}
      />
    </>
  )
}
