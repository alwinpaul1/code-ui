import { useLocalSearchParams } from 'expo-router'
import { MobileMcpServersPanel } from '../../../../src/project-config/mcp-servers/MobileMcpServersPanel'
import { firstParam } from '../../../../src/source-control/mobile-source-control-screen-state'

export default function MobileMcpServersScreen() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
  }>()
  return (
    <MobileMcpServersPanel
      hostId={firstParam(params.hostId)}
      worktreeId={firstParam(params.worktreeId)}
      name={firstParam(params.name)}
    />
  )
}
