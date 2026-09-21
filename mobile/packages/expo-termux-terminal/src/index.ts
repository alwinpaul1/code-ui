import { requireNativeView } from 'expo'
import type { ComponentType, Ref } from 'react'
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'

/** The desktop's palette for a tab, the shape the libghostty view took. */
/** Colours are `#rrggbb` only; the native side drops anything else (see termux-terminal-theme.ts). */
export type TermuxTerminalTheme = {
  background?: string
  foreground?: string
  cursorColor?: string
  palette?: (string | null)[]
}

export type TermuxTerminalModesEvent = {
  altScreen: boolean
  mouseTrackingMode: 'none' | 'vt200' | 'drag' | 'any'
  sgrMouseMode: boolean
  bracketedPasteMode: boolean
}

/**
 * Termux's terminal as a native view. Bytes in through `writeText`; keystrokes, wheel reports
 * and the emulator's query answers out through `onInput`. The view sizes itself from its pixels
 * and font and reports the grid on `onResize`; the app fits the desktop PTY to that.
 */
export type TermuxTerminalNativeProps = {
  ref?: Ref<TermuxTerminalNativeHandle>
  style?: StyleProp<ViewStyle>
  /** In dp; the native side multiplies by density. */
  fontSize?: number
  theme?: TermuxTerminalTheme
  onInput?: (event: NativeSyntheticEvent<{ text: string; data: string }>) => void
  onResize?: (event: NativeSyntheticEvent<{ cols: number; rows: number }>) => void
  onModes?: (event: NativeSyntheticEvent<TermuxTerminalModesEvent>) => void
  onSelection?: (event: NativeSyntheticEvent<{ active: boolean }>) => void
  onCopy?: (event: NativeSyntheticEvent<{ text: string }>) => void
  onFontSize?: (event: NativeSyntheticEvent<{ fontSize: number }>) => void
  onTap?: (event: NativeSyntheticEvent<{ line: string; col: number; row: number }>) => void
  onMetrics?: (
    event: NativeSyntheticEvent<{ cursorY: number; contentBottomRow: number; rows: number; altScreen: boolean }>
  ) => void
}

/** The view's commands, called on the ref the native view manager hands back. */
export type TermuxTerminalNativeHandle = {
  /** Resolves after the bytes are parsed and anything they made the emulator answer has left. */
  writeText: (text: string) => Promise<void>
  cancelSelect: () => Promise<void>
}

export const TermuxTerminalNativeView: ComponentType<TermuxTerminalNativeProps> =
  requireNativeView('TermuxTerminal')
