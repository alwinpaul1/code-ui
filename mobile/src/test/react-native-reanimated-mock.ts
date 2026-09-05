// Test double for react-native-reanimated. Animated components render as plain
// host tags and every animation helper resolves to its target value, so
// component tests can assert on structure without a worklet runtime. It never
// imports 'react-native' itself: tests mock that module to a handful of tags.
import { createElement, forwardRef, type ComponentType } from 'react'

function hostTag(tag: string) {
  return forwardRef<unknown, { children?: unknown }>((props, ref) =>
    createElement(tag, { ...props, ref })
  )
}

const Animated = {
  View: hostTag('View'),
  Text: hostTag('Text'),
  ScrollView: hostTag('ScrollView'),
  createAnimatedComponent: <P,>(component: ComponentType<P> | string) => component
}

export default Animated
export const useSharedValue = <T,>(initial: T) => ({ value: initial })
export const useAnimatedStyle = <T,>(factory: () => T) => factory()
export const useAnimatedScrollHandler = () => () => undefined
export const useAnimatedReaction = () => undefined
export const useDerivedValue = <T,>(factory: () => T) => ({ value: factory() })
export const withSpring = <T,>(value: T) => value
export const withTiming = <T,>(value: T) => value
export const withRepeat = <T,>(value: T) => value
export const withDelay = <T,>(_delay: number, value: T) => value
export const withSequence = <T,>(...values: T[]) => values[values.length - 1]
export const cancelAnimation = () => undefined
export const runOnJS =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A) =>
    fn(...args)
export const runOnUI =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A) =>
    fn(...args)
export const interpolate = (value: number) => value
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' }
export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => t,
  quad: (t: number) => t,
  cubic: (t: number) => t,
  out: (fn: (t: number) => number) => fn,
  in: (fn: (t: number) => number) => fn,
  inOut: (fn: (t: number) => number) => fn,
  bezier: () => (t: number) => t
}
