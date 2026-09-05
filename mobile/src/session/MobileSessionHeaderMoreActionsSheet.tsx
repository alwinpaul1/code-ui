import { ListChecks, Coffee } from 'lucide-react-native'
import { useState } from 'react'
import { MobileAgentSessionHistoryIcon } from '../agent-history/MobileAgentSessionHistoryIcon'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { colors } from '../theme/mobile-theme'
import type { RpcClient } from '../transport/rpc-client'
import { MobileComputerAwakeSheet } from './MobileComputerAwakeSheet'
import { COMPUTER_AWAKE_UNSUPPORTED_HINT, computerAwakeModeLabel } from './mobile-computer-awake'
import { useMobileComputerAwake } from './use-mobile-computer-awake'

type Props = {
  visible: boolean
  client: RpcClient | null
  showAgentSessionHistory: boolean
  showChecks: boolean
  onOpenAgentSessionHistory: () => void
  onOpenChecks: () => void
  onClose: () => void
}

export function MobileSessionHeaderMoreActionsSheet({
  visible,
  client,
  showAgentSessionHistory,
  showChecks,
  onOpenAgentSessionHistory,
  onOpenChecks,
  onClose
}: Props) {
  const [showComputerAwake, setShowComputerAwake] = useState(false)
  const computerAwake = useMobileComputerAwake({
    client,
    enabled: visible || showComputerAwake
  })
  return (
    <>
      <ActionSheetModal
        visible={visible}
        actions={[
          ...(showAgentSessionHistory
            ? [
                {
                  label: 'Agent History',
                  hint: 'Browse and resume agent sessions',
                  renderIcon: () => (
                    <MobileAgentSessionHistoryIcon
                      size={16}
                      color={colors.textSecondary}
                      strokeWidth={2.1}
                    />
                  ),
                  onPress: onOpenAgentSessionHistory
                }
              ]
            : []),
          ...(showChecks
            ? [
                {
                  label: 'Checks',
                  hint: 'Open pull request checks',
                  icon: ListChecks,
                  onPress: onOpenChecks
                }
              ]
            : []),
          {
            label: 'Keep computer awake',
            hint:
              computerAwake.supported === false
                ? COMPUTER_AWAKE_UNSUPPORTED_HINT
                : computerAwakeModeLabel(computerAwake.mode),
            icon: Coffee,
            disabled: computerAwake.supported === false,
            // Why: the picker is a second drawer; open it only once this one has
            // fully closed so the two never fight over the same native window.
            closeBeforePress: true,
            onPress: () => setShowComputerAwake(true)
          }
        ]}
        onClose={onClose}
      />
      <MobileComputerAwakeSheet
        visible={showComputerAwake}
        mode={computerAwake.mode}
        saving={computerAwake.saving}
        error={computerAwake.error}
        onSelect={(mode) => {
          void computerAwake.setMode(mode)
        }}
        onClose={() => setShowComputerAwake(false)}
      />
    </>
  )
}
