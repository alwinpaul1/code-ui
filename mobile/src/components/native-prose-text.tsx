import type { ReactNode } from 'react'
import type { NativeProseTextProps } from './native-prose-text-props'

/**
 * iOS and the web (Metro picks native-prose-text.android.tsx on Android): there is no native prose
 * view, so every prose run stays a React Native Text.
 */
export const NATIVE_PROSE_AVAILABLE = false

export function NativeProseText(_props: NativeProseTextProps): ReactNode {
  return null
}
