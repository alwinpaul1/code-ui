import { useLocalSearchParams } from 'expo-router'
import { MobilePermissionRulesPanel } from '../../../../src/project-config/permission-rules/MobilePermissionRulesPanel'
import { firstParam } from '../../../../src/source-control/mobile-source-control-screen-state'

export default function MobilePermissionRulesScreen() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
  }>()
  return (
    <MobilePermissionRulesPanel
      hostId={firstParam(params.hostId)}
      worktreeId={firstParam(params.worktreeId)}
      name={firstParam(params.name)}
    />
  )
}
