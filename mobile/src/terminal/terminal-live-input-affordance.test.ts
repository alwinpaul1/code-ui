import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readMobileSessionRouteSource } from '../session/mobile-session-route-source-family.test-support'

const commandDockSource = readMobileSessionRouteSource('../session/MobileSessionCommandDock.tsx')
const terminalRuntimeSource = readMobileSessionRouteSource(
  '../session/use-mobile-session-terminal-runtime.ts'
)
const nativeChatSource = readMobileSessionRouteSource(
  '../session/use-mobile-session-native-chat-dictation.ts'
)
const liveInputPlaceholderSource = readFileSync(
  new URL('../session/mobile-terminal-live-input-placeholder.ts', import.meta.url),
  'utf8'
)
const liveInputFocusSource = readFileSync(
  new URL('./use-terminal-live-input-focus.ts', import.meta.url),
  'utf8'
)
const sendCompletionGenerationSource = readFileSync(
  new URL('../session/use-mobile-send-completion-generation.ts', import.meta.url),
  'utf8'
)

function liveInputBarBlock(): string {
  const start = commandDockSource.indexOf('{liveInputEnabled ? (')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = commandDockSource.indexOf(') : (', start)
  expect(end).toBeGreaterThan(start)
  return commandDockSource.slice(start, end)
}

describe('terminal live input affordance', () => {
  it('renders the live capture as the visible input field', () => {
    const block = liveInputBarBlock()

    // The field itself is the bar: typed text is visible locally while it streams.
    expect(block).toContain('ref={liveInputRef}')
    expect(block).toContain('value={liveInputCapture}')
    expect(block).not.toContain('opacity: 0, width: 1, height: 1')
    expect(block).toContain('fontFamily: fonts.mono')
    expect(block).toContain('accessibilityLabel="Live terminal input"')
    expect(block).toContain(
      'accessibilityHint="Typed text is sent directly to the active terminal"'
    )
    expect(block).toContain('opacity: canSend ? 1 : 0.45')
    expect(block).toContain('showSoftInputOnFocus')
    expect(block).toContain('getMobileTerminalLiveInputPlaceholder({ dictation, isAttaching })')
    // No keyboard icon or "Live" indicator; focus only tints the border.
    expect(block).not.toContain('KeyboardIcon')
    expect(block).toContain('borderColor: liveFocused ? colors.accent : colors.border')
    expect(block).toContain('onFocus={() => setLiveFocused(true)}')
    expect(block).toContain('onBlur={() => setLiveFocused(false)}')
    expect(terminalRuntimeSource).toContain('useTerminalLiveInputFocus({')
    expect(nativeChatSource).toContain('useMobileSendCompletionGeneration({')
    expect(nativeChatSource).toContain('onBlur: resetLiveInputFocus')
    expect(sendCompletionGenerationSource).toContain('return () => {')
    expect(sendCompletionGenerationSource).toContain('onBlur()')
    expect(liveInputFocusSource).toContain('focusTerminalLiveInputTarget(inputRef.current')
    expect(liveInputFocusSource).toContain('lifecycleIdentity,')
    expect(liveInputFocusSource).toContain('resetLiveInputFocus')
    expect(liveInputFocusSource).toContain('keyboardHeight: context.keyboardHeight')
    expect(liveInputFocusSource).toContain(
      'scheduleTerminalLiveInputFocus(timerRef, focusLiveInput)'
    )
  })

  it('uses the placeholder as the status line while dictation or attach is busy', () => {
    // Regression: the bar used to show 'Tap to show keyboard' even while focused.
    expect(liveInputPlaceholderSource).not.toContain('Tap to show keyboard')
    expect(liveInputPlaceholderSource).toContain("return 'Tap to type'")
    expect(liveInputPlaceholderSource).toContain("return 'Listening'")
    expect(liveInputPlaceholderSource).toContain("return 'Uploading image'")
  })
})
