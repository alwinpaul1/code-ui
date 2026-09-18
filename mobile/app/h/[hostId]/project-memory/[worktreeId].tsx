import { useLocalSearchParams } from 'expo-router'
import { MobileProjectMemoryPanel } from '../../../../src/project-config/project-memory/MobileProjectMemoryPanel'
import { firstParam } from '../../../../src/source-control/mobile-source-control-screen-state'

export default function MobileProjectMemoryScreen() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
  }>()
  return (
    <MobileProjectMemoryPanel
      hostId={firstParam(params.hostId)}
      worktreeId={firstParam(params.worktreeId)}
      name={firstParam(params.name)}
    />
  )
}
