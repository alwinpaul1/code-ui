// Why: react-native-safe-area-context's entry requires real 'react-native',
// whose Flow-typed internals Node cannot parse. Tool rows reach it through the
// detail sheet (DraggableDetailSheet). Insets are zero and SafeAreaView is a
// host tag; a test that needs real insets can still vi.mock it (local wins).
import { createElement, type ReactNode } from 'react'

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 }

export const useSafeAreaInsets = () => ZERO
export const SafeAreaView = (props: Record<string, unknown> & { children?: ReactNode }) =>
  createElement('SafeAreaView', props)
