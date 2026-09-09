export type TerminalKeyboardPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos'
export type TerminalKeyboardType = 'default' | 'visible-password'

// Why (live input): a terminal needs every keystroke to reach the PTY the moment
// it is pressed. Android's system keyboard (notably Samsung) puts typed text in
// a composing/preedit region and only commits it on space/punctuation. On
// Android, React Native's text events carry no `isComposing` (the pinned
// react-native patch adds it on iOS only: Fabric's Android text-change event is
// built in Kotlin, and the patch never reaches the prebuilt AAR), so the
// live-input mirror cannot tell preedit from committed text and nothing streams
// reliably until the user hits space. `visible-password` sets
// TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, which disables the IME's composing and
// suggestion bar, so each key commits immediately — the standard way Android
// terminals/code editors capture keystrokes. iOS has no such preedit trap for
// ASCII and keeps `default` so its IMEs stay selectable.
export function getTerminalLiveInputKeyboardType(
  platform: TerminalKeyboardPlatform
): TerminalKeyboardType {
  return platform === 'android' ? 'visible-password' : 'default'
}

// Why: the buffered command box sends on Enter, so composing/suggestions there
// are harmless and full IME support (non-Latin scripts) is worth keeping.
export function getTerminalCommandKeyboardType(
  _platform: TerminalKeyboardPlatform,
  _autocompleteEnabled: boolean
): TerminalKeyboardType {
  return 'default'
}
