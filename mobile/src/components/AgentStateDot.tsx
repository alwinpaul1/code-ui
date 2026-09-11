import { useEffect, useRef } from 'react'
import { Activity, CircleCheck, MessageCircleQuestionMark } from 'lucide-react-native'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import type { AgentDotState } from '../worktree/agent-row-display'

// Per-agent state indicator, 1:1 with desktop AgentStateDot (Orca 1.4.200,
// out/renderer/assets/AgentStateDot-*.js): yellow spinner for 'working', the
// yellow Activity heartbeat for 'monitoring', an emerald check for 'done', the
// orange question bubble for 'waiting' (the desktop's "agent question" icon),
// red dot for blocked/interrupted, neutral dot for idle. Distinct from the
// worktree-level AgentSpinner, which collapses the agent vocabulary into the
// 5-state rollup the sidebar dot uses. Colours are the desktop's Tailwind
// values, identical in both themes there and here.
const DOT_COLORS: Record<Extract<AgentDotState, 'blocked' | 'interrupted' | 'idle'>, string> = {
  blocked: '#ef4444',
  interrupted: '#ef4444',
  idle: 'rgba(115,115,115,0.4)'
}
const WORKING_COLOR = '#eab308'
const DONE_COLOR = '#10b981'
const QUESTION_COLOR = '#f97316'

export function AgentStateDot({ state, size = 10 }: { state: AgentDotState; size?: number }) {
  const spinValue = useRef(new Animated.Value(0)).current
  const box = { width: size, height: size }
  const icon = size
  const dot = { width: size * 0.6, height: size * 0.6, borderRadius: size * 0.3 }

  useEffect(() => {
    if (state === 'working') {
      const animation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      )
      animation.start()
      return () => animation.stop()
    }
    spinValue.setValue(0)
    return undefined
  }, [state, spinValue])

  if (state === 'working') {
    const rotate = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Working">
        <Animated.View style={[styles.spinner, dot, { transform: [{ rotate }] }]} />
      </View>
    )
  }

  if (state === 'monitoring') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Monitoring background tasks">
        <Activity size={icon} color={WORKING_COLOR} />
      </View>
    )
  }

  if (state === 'done') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Done">
        <CircleCheck size={icon} color={DONE_COLOR} />
      </View>
    )
  }

  if (state === 'waiting') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Waiting for input">
        <MessageCircleQuestionMark size={icon} color={QUESTION_COLOR} />
      </View>
    )
  }

  return (
    <View style={[styles.wrapper, box]}>
      <View style={[dot, { backgroundColor: DOT_COLORS[state] }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  spinner: {
    borderWidth: 1.5,
    borderColor: WORKING_COLOR,
    borderTopColor: 'transparent'
  }
})
