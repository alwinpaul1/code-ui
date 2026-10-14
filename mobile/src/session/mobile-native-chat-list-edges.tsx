import { useEffect, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, View } from 'react-native'
import { ArrowDown } from 'lucide-react-native'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { Txt } from '../ui/Txt'
import type { AgentType } from '../../../src/shared/agent-status-types'
import type { MobileNativeChatEmptyStateCopy } from './mobile-native-chat-empty-state'

export function MobileNativeChatListEmpty({
  emptyState,
  agent,
  styles
}: {
  emptyState: MobileNativeChatEmptyStateCopy | null
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
      {emptyState.detail ? (
        <Txt variant="caption" tone="muted" align="center">
          {emptyState.detail}
        </Txt>
      ) : null}
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

/** Claude's enter/exit for this button (mm7.java:20-22, used by gc20.c): scale
 *  from 0.01 and fade in, scale to 0 and fade out, on spring(damping ratio 1,
 *  stiffness 400) (tyl.java:6). A Compose damping ratio of 1 at mass 1 is a
 *  damping of 2 * sqrt(400) = 40. */
const JUMP_SPRING = { stiffness: 400, damping: 40, mass: 1, useNativeDriver: true } as const

export function MobileNativeChatJumpToLatest({
  visible,
  onPress,
  styles,
  colors
}: {
  visible: boolean
  onPress: () => void
  styles: { fab: object }
  colors: { jumpButtonGlyph: string }
}): React.JSX.Element | null {
  // Mounted through the exit: the button leaves only once its scale-out settles.
  const [mounted, setMounted] = useState(visible)
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0))
  useEffect(() => {
    if (!visible && !mounted) {
      return undefined
    }
    if (visible) {
      setMounted(true)
    }
    const spring = Animated.spring(progress, { ...JUMP_SPRING, toValue: visible ? 1 : 0 })
    spring.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false)
      }
    })
    return () => spring.stop()
    // `mounted` is read only to skip a spring for a button that was never shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress])
  if (!mounted) {
    return null
  }
  return (
    <Animated.View
      style={[
        styles.fab,
        { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }) }] }
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Pressable
        accessibilityLabel="Scroll to latest"
        // The visible circle is 40 dp; Claude gives it a 48 dp target.
        hitSlop={4}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        onPress={onPress}
      >
        <ArrowDown size={16} color={colors.jumpButtonGlyph} strokeWidth={2.2} />
      </Pressable>
    </Animated.View>
  )
}
