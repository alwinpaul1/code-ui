import { useEffect, useRef } from 'react'
import { Activity, CircleCheck, MessageCircleQuestionMark } from 'lucide-react-native'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import type { AgentDotState } from '../worktree/agent-row-display'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'

// Per-agent state indicator, 1:1 with desktop AgentStateDot (Orca 1.4.200,
// out/renderer/assets/AgentStateDot-*.js): yellow spinner for 'working', the
// yellow Activity heartbeat for 'monitoring', an emerald check for 'done', the
// orange question bubble for 'waiting' (the desktop's "agent question" icon),
// red dot for blocked/failed (a fault, including a turn something other than the
// user cut short), a muted dot for a user's Stop ('interrupted'), an amber dot for
// 'unconfirmed' (an end the host could not prove), neutral dot for idle. Distinct
// from the worktree-level AgentSpinner, which collapses the agent vocabulary into
// the 5-state rollup the sidebar dot uses. The fault and idle colours are the
// desktop's Tailwind values, identical in both themes there and here, except on
// a light surface (ON_LIGHT below); the two states Orca #23467 added read the
// live theme's muted and warning tones, so each scheme draws its own.
const DOT_COLORS: Record<Extract<AgentDotState, 'blocked' | 'failed' | 'idle'>, string> = {
  blocked: '#ef4444',
  failed: '#ef4444',
  idle: 'rgba(115,115,115,0.4)'
}
const WORKING_COLOR = '#eab308'
const DONE_COLOR = '#10b981'
const QUESTION_COLOR = '#f97316'
// On a light surface the desktop's working, done and question tones fall to
// 1.55–2.7:1. The tab pill has three: selected in dark mode (the theme's text
// colour, #ECE9E2) and unselected in light mode (bgPanel #FBFAF6, bgRaised
// #EAE7DE while pressed). These are the same hues two Tailwind steps darker,
// red one step (red-600), and they read 3.9:1 or better on all three
// (tab-pill-surface.ts says which pill takes them;
// AgentStateDot.verdict-tones.test.tsx measures each).
// Reviewed 2026-09-11; interrupted and unconfirmed added 2026-10-04, then the
// red the same day: the desktop's red-500 was 3.04:1 on the pressed pill.
const ON_LIGHT = {
  working: '#a16207',
  done: '#047857',
  question: '#c2410c',
  interrupted: '#57534e',
  unconfirmed: '#b45309',
  fault: '#dc2626'
}
// On a dark surface (the selected tab pill in light mode is the theme's text
// colour, #1E1C19) the desktop tones and the light theme's amber read 4.5:1 or
// better, but its muted tone (#67625A) drew a Stop's dot at 2.81:1. This is the
// dark theme's muted tone, made for that near-black (5.8:1). 2026-10-04. The
// dark scheme's unselected pill (#211F1C, #2B2925 pressed) is a dark surface
// too, and its own muted tone is this one.
const ON_DARK = {
  interrupted: '#9A968D'
}

export function AgentStateDot({
  state,
  size = 10,
  onLightSurface = false,
  onDarkSurface = false
}: {
  state: AgentDotState
  size?: number
  /** Drawn on a light background (a tab pill: selected in dark mode, unselected in light mode):
   *  darker tones. */
  onLightSurface?: boolean
  /** Drawn on a dark background (a tab pill: selected in light mode, unselected in dark mode): a
   *  lighter muted tone. */
  onDarkSurface?: boolean
}) {
  const spinValue = useRef(new Animated.Value(0)).current
  const { colors } = useTheme()
  const working = onLightSurface ? ON_LIGHT.working : WORKING_COLOR
  const done = onLightSurface ? ON_LIGHT.done : DONE_COLOR
  const question = onLightSurface ? ON_LIGHT.question : QUESTION_COLOR
  const box = { width: size, height: size }
  const icon = size
  const dot = { width: size * 0.6, height: size * 0.6, borderRadius: size * 0.3 }
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    // Unknown (null) holds too; see AgentSpinner. The arc still draws.
    if (state === 'working' && reducedMotion === false) {
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
  }, [reducedMotion, state, spinValue])

  if (state === 'working') {
    const rotate = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Working">
        <Animated.View
          style={[styles.spinner, dot, { borderColor: working, borderTopColor: 'transparent', transform: [{ rotate }] }]}
        />
      </View>
    )
  }

  if (state === 'monitoring') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Monitoring background tasks">
        <Activity size={icon} color={working} />
      </View>
    )
  }

  if (state === 'done') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Done">
        <CircleCheck size={icon} color={done} />
      </View>
    )
  }

  if (state === 'waiting') {
    return (
      <View style={[styles.wrapper, box]} accessibilityLabel="Waiting for input">
        <MessageCircleQuestionMark size={icon} color={question} />
      </View>
    )
  }

  const backgroundColor =
    state === 'interrupted'
      ? onLightSurface
        ? ON_LIGHT.interrupted
        : onDarkSurface
          ? ON_DARK.interrupted
          : colors.textMuted
      : state === 'unconfirmed'
        ? onLightSurface
          ? ON_LIGHT.unconfirmed
          : colors.warning
        : (state === 'failed' || state === 'blocked') && onLightSurface
          ? ON_LIGHT.fault
          : DOT_COLORS[state]
  return (
    <View style={[styles.wrapper, box]}>
      <View style={[dot, { backgroundColor }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  spinner: {
    borderWidth: 1.5
  }
})
