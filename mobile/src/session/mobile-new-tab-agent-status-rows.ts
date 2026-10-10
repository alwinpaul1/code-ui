import { Bot } from 'lucide-react-native'
import type { MobileNewTabAgentLoadState } from './mobile-session-route-types'

export type MobileNewTabAgentStatusRow = {
  label: string
  hint?: string
  icon: typeof Bot
  disabled: true
  onPress: () => void
}

const noop = (): void => {}

/** The one disabled row the create-tab drawer (and the send-notes list) shows when the host lists no
 *  agent to pick, by why: none enabled, the read failed, or another Orca server owns the workspace
 *  (Orca #27196), which no retry here fixes. `unavailableHint` is the failed read's next step. */
export function mobileNewTabAgentStatusRows(
  state: MobileNewTabAgentLoadState,
  unavailableHint: string
): MobileNewTabAgentStatusRow[] {
  switch (state) {
    case 'loaded':
      return [{ label: 'No Enabled Agents', icon: Bot, disabled: true, onPress: noop }]
    case 'error':
      return [
        { label: 'Agent Presets Unavailable', hint: unavailableHint, icon: Bot, disabled: true, onPress: noop }
      ]
    case 'other-runtime':
      return [
        {
          label: 'Agents on Another Server',
          hint: 'Pair that server directly',
          icon: Bot,
          disabled: true,
          onPress: noop
        }
      ]
    case 'idle':
    case 'loading':
      return []
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}
