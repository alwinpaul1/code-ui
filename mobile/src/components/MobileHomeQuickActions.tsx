import { useRef, useState } from 'react'
import { Plus, QrCode } from 'lucide-react-native'
import { View } from 'react-native'
import type { HostProfile } from '../transport/types'
import { hostEndpointLabel } from '../transport/host-endpoint-label'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { SectionLabel } from '../ui/SectionLabel'
import { PickerModal } from './PickerModal'

type Props = {
  connectedHosts: HostProfile[]
  onPairDesktop: () => void
  onCreateWorkspace: (hostId: string) => void
}

function hostPickerOptions(hosts: HostProfile[]) {
  const entries = hosts.map((host) => ({
    host,
    endpointLabel: hostEndpointLabel(host.endpoint)
  }))
  const endpointCounts = new Map<string, number>()
  for (const entry of entries) {
    const endpointKey = JSON.stringify([entry.host.name, entry.endpointLabel])
    endpointCounts.set(endpointKey, (endpointCounts.get(endpointKey) ?? 0) + 1)
  }
  return entries.map((entry) => {
    const endpointKey = JSON.stringify([entry.host.name, entry.endpointLabel])
    const endpointCollides = (endpointCounts.get(endpointKey) ?? 0) > 1
    const subtitle = endpointCollides
      ? `${entry.endpointLabel} · ${entry.host.id}`
      : entry.endpointLabel
    return { value: entry.host.id, label: entry.host.name, subtitle }
  })
}

export function MobileHomeQuickActions(props: Props) {
  const { space } = useTheme()
  const [hostPickerForHostSet, setHostPickerForHostSet] = useState<string | null>(null)
  const pendingHostIdRef = useRef<string | null>(null)
  const canCreateWorkspace = props.connectedHosts.length > 0
  const hostSetKey = JSON.stringify(props.connectedHosts.map((host) => host.id))
  const hostPickerVisible = hostPickerForHostSet === hostSetKey
  if (hostPickerForHostSet !== null && !hostPickerVisible) {
    setHostPickerForHostSet(null)
  }

  function handleCreateWorkspace() {
    if (props.connectedHosts.length === 1) {
      props.onCreateWorkspace(props.connectedHosts[0].id)
      return
    }
    if (props.connectedHosts.length > 1) {
      setHostPickerForHostSet(hostSetKey)
    }
  }

  function handleHostSelect(hostId: string) {
    pendingHostIdRef.current = hostId
    setHostPickerForHostSet(null)
  }

  function handleHostPickerClosed() {
    setHostPickerForHostSet(null)
    const hostId = pendingHostIdRef.current
    pendingHostIdRef.current = null
    if (hostId && props.connectedHosts.some((host) => host.id === hostId)) {
      props.onCreateWorkspace(hostId)
    }
  }

  return (
    <>
      <SectionLabel>Quick actions</SectionLabel>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="New workspace"
          icon={Plus}
          variant="primary"
          disabled={!canCreateWorkspace}
          onPress={handleCreateWorkspace}
          style={{ flex: 1 }}
        />
        <Button
          label="Pair desktop"
          icon={QrCode}
          variant="secondary"
          onPress={props.onPairDesktop}
          style={{ flex: 1 }}
        />
      </View>
      <PickerModal
        visible={hostPickerVisible}
        title="Create workspace on"
        options={hostPickerOptions(props.connectedHosts)}
        selected=""
        onSelect={handleHostSelect}
        onClose={() => setHostPickerForHostSet(null)}
        onAfterClose={handleHostPickerClosed}
      />
    </>
  )
}
