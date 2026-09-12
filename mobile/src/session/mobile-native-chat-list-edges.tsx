import { ActivityIndicator, Pressable, View } from 'react-native'
import { ArrowDown } from 'lucide-react-native'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { Txt } from '../ui/Txt'
import type { AgentType } from '../../../src/shared/agent-status-types'

export function MobileNativeChatListEmpty({
  emptyState,
  agent,
  styles
}: {
  emptyState: { title: string; subtitle: string } | null
  agent: AgentType | null | undefined
  styles: { center: object }
}): React.JSX.Element | null {
  if (!emptyState) {
    return null
  }
  return (
    <View style={styles.center}>
      {agent ? <MobileAgentIcon agentId={agent} size={40} /> : null}
      <Txt variant="heading" weight="semibold" align="center">
        {emptyState.title}
      </Txt>
      <Txt variant="body" tone="muted" align="center">
        {emptyState.subtitle}
      </Txt>
    </View>
  )
}

export function MobileNativeChatLoadEarlier({
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  styles,
  colors
}: {
  hasMore: boolean
  loadingEarlier: boolean
  onLoadEarlier?: () => void
  styles: { loadEarlier: object }
  colors: { textMuted: string }
}): React.JSX.Element | null {
  if (!hasMore) {
    return null
  }
  // The Claude app shows only a spinner at the top while older messages load
  // (2026-09-13); the list asks for them itself as the reader nears the top,
  // so the row is a tappable spinner, never a "Load earlier" label.
  return (
    <Pressable
      style={styles.loadEarlier}
      onPress={onLoadEarlier}
      disabled={loadingEarlier}
      accessibilityLabel={loadingEarlier ? 'Loading earlier messages' : 'Load earlier messages'}
    >
      <ActivityIndicator size="small" color={colors.textMuted} animating={loadingEarlier} />
    </Pressable>
  )
}

export function MobileNativeChatJumpToLatest({
  visible,
  onPress,
  styles,
  colors
}: {
  visible: boolean
  onPress: () => void
  styles: { fab: object }
  colors: { text: string }
}): React.JSX.Element | null {
  if (!visible) {
    return null
  }
  return (
    <Pressable accessibilityLabel="Scroll to latest" style={styles.fab} onPress={onPress}>
      <ArrowDown size={18} color={colors.text} strokeWidth={2.2} />
    </Pressable>
  )
}
