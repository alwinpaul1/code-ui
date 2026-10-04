import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Navigator } from 'expo-router'
import { useTheme } from '../theme/theme-context'
import { HOST_STACK_SCREENS, type HostStackAnimation } from './host-stack-screens'
import { hostStackTransitionBetween, type HostStackTransition } from './host-stack-transition'

/**
 * Web sibling: the page's host stack, with the push and pop slide the native stack has.
 *
 * expo-router's `Stack` renders native-stack's web view on the page, which flips each screen's
 * `display` and ignores `animation`. This is the same expo-router `StackRouter` under the public
 * `Navigator`, with a view that keeps a popped screen mounted until it has slid out.
 */
export function HostStack({ animation }: { animation: HostStackAnimation }) {
  return (
    <Navigator>
      {HOST_STACK_SCREENS.map(({ name, title }) => (
        <Navigator.Screen key={name} name={name} options={{ title }} />
      ))}
      <HostStackView animation={animation} />
    </Navigator>
  )
}

const SLIDE_MS = 300
// Bounds the wait for a suspended screen, so a route that renders nothing still arrives.
const CONTENT_WAIT_CAP_MS = 1000
// Close to iOS's push curve, so the page and the native stack read as one motion.
const SLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

type NavigatorContext = ReturnType<typeof Navigator.useContext>
type Descriptors = NavigatorContext['descriptors']
type Routes = NavigatorContext['state']['routes']
type Transition = HostStackTransition<Routes[number], Descriptors>

type Shown = Readonly<{
  /** The navigator's own routes array, whose identity changes exactly when the state does. */
  routes: Routes
  descriptors: Descriptors
  transition: Transition | null
}>

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function HostStackView({ animation }: { animation: HostStackAnimation }) {
  const { state, descriptors } = Navigator.useContext()
  const { routes } = state
  const [shown, setShown] = useState<Shown>({ routes, descriptors, transition: null })

  // Derived during render, so the first painted frame of a pop still holds the leaving screen.
  if (shown.routes !== routes) {
    const moved = shown.routes.at(-1)?.key !== routes.at(-1)?.key
    const slides = moved && animation !== 'none' && !prefersReducedMotion()
    setShown({
      routes,
      descriptors,
      transition: !moved
        ? shown.transition
        : slides
          ? hostStackTransitionBetween(shown, routes)
          : null
    })
  }

  const settle = useCallback(() => setShown((current) => ({ ...current, transition: null })), [])
  const { transition } = shown
  const topKey = routes.at(-1)?.key
  // One flat keyed list, so the leaving screen keeps its mount when it moves to the last slot.
  const slots = transition?.kind === 'pop' ? [...routes, transition.leaving] : routes

  return (
    // No NavigationContent: it must render in the navigator's own pass, and a settle re-renders
    // only this view. expo-router's NavigatorSlot renders descriptors bare for the same reason.
    // Untappable mid-slide, as natively: a second tap on the list would push a second screen.
    <View style={styles.stack} pointerEvents={transition ? 'none' : 'auto'}>
      {slots.map((route) => {
        const leaving = transition?.kind === 'pop' && route.key === transition.leaving.key
        const entering = transition?.kind === 'push' && route.key === transition.enteringKey
        const under = transition?.kind === 'push' && route.key === transition.underKey
        const descriptor = leaving ? transition.descriptors[route.key] : descriptors[route.key]
        return (
          <StackScreen
            key={route.key}
            visible={route.key === topKey || leaving || under}
            motion={leaving ? 'exit' : entering ? 'enter' : null}
            onSettled={settle}
          >
            {descriptor?.render()}
          </StackScreen>
        )
      })}
    </View>
  )
}

function StackScreen({
  visible,
  motion,
  onSettled,
  children
}: {
  visible: boolean
  motion: 'enter' | 'exit' | null
  onSettled: () => void
  children: ReactNode
}) {
  // The screen's own surface follows the app's theme, so a slide never shows the other mode.
  const { colors } = useTheme()
  const ref = useRef<View>(null)
  // Where an interrupted slide stopped, so a pop during a push leaves from there and not from 0.
  const stoppedAt = useRef<string | null>(null)

  // Before paint, so neither screen is ever painted at rest before its slide starts.
  useLayoutEffect(() => {
    // Consumed by every run, so a slot that settles at rest carries no stale offset.
    const from = stoppedAt.current
    stoppedAt.current = null
    const node: unknown = ref.current
    if (motion === null || !(node instanceof HTMLElement)) {
      return
    }
    const frames =
      motion === 'enter'
        ? [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]
        : [{ transform: from ?? 'translateX(0)' }, { transform: 'translateX(100%)' }]
    // Web Animations run on the compositor, so a heavy screen mounting does not stall the slide.
    const slide = node.animate(frames, { duration: SLIDE_MS, easing: SLIDE_EASING, fill: 'both' })
    slide.onfinish = onSettled
    const stop = () => {
      stoppedAt.current = getComputedStyle(node).transform
      slide.cancel()
    }
    if (motion === 'exit' || node.childElementCount > 0) {
      return stop
    }
    // A route whose chunk is still loading suspends to an empty screen: hold it off-screen until
    // its content commits, so the slide carries the screen and not a blank panel.
    slide.pause()
    const start = () => {
      observer.disconnect()
      clearTimeout(cap)
      slide.play()
    }
    const observer = new MutationObserver(start)
    observer.observe(node, { childList: true, subtree: true })
    const cap = setTimeout(start, CONTENT_WAIT_CAP_MS)
    return () => {
      observer.disconnect()
      clearTimeout(cap)
      stop()
    }
  }, [motion, onSettled])

  return (
    <View
      ref={ref}
      style={[styles.screen, { backgroundColor: colors.bg }, visible ? null : styles.hidden]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
    overflow: 'hidden'
  },
  screen: {
    // Expo 57 / RN 0.86 no longer ships `StyleSheet.absoluteFillObject`.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },
  hidden: {
    display: 'none'
  }
})
