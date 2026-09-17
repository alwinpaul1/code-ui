import { useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { TerminalAccessoryKey } from '../terminal/terminal-accessory-keys'
import { createTerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import type { TerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import { useTheme } from '../theme/theme-context'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Txt } from '../ui/Txt'

const NO_CUSTOM_KEYS: { id: string; label: string; bytes: string }[] = []

/** A key's drawn size. 30 tall keeps the strip one compact row above the
 *  composer; the hitSlop below grows the TARGET to 44 without growing the
 *  row (7 dp above and below, 3 dp each side, which is half the 6 dp gap
 *  between keys, so no two targets overlap). */
const KEY_HEIGHT = 30
const KEY_MIN_WIDTH = 38
const KEY_HIT_SLOP = tapTargetHitSlop({ height: KEY_HEIGHT, minWidth: KEY_MIN_WIDTH })

export type MobileNativeChatKeyStripProps = {
  keys: readonly TerminalAccessoryKey[]
  /** Custom user shortcuts from Terminal settings, sent as raw bytes. */
  customKeys?: readonly { id: string; label: string; bytes: string }[]
  enabled: boolean
  onKey: (input: TerminalLiveAccessoryInput | { bytes: string }) => void
  /** Hold-to-repeat plumbing shared with the terminal dock (#12251 semantics). */
  onRepeatStart: (input: TerminalLiveAccessoryInput) => void
  onRepeatStop: () => void
  didRepeatFire: () => boolean
}

/**
 * The terminal's accessory keys (Esc, Tab, Shift+Tab, arrows, Ctrl+C, …) inside
 * Chat UI. Agents still draw TUI menus that only respond to keystrokes, so the
 * chat view must be able to send them without flipping back to the terminal.
 * Same bytes, same send path, same swipe-safe hold behaviour as the dock.
 */
export function MobileNativeChatKeyStrip({
  keys,
  customKeys = NO_CUSTOM_KEYS,
  enabled,
  onKey,
  onRepeatStart,
  onRepeatStop,
  didRepeatFire
}: MobileNativeChatKeyStripProps) {
  const { colors, fonts, radius, space, type } = useTheme()
  const heldKeyFiredRef = useRef(false)
  if (keys.length === 0 && customKeys.length === 0) {
    return null
  }
  const keyStyle = (pressed: boolean, outlined = false) => ({
    height: KEY_HEIGHT,
    minWidth: KEY_MIN_WIDTH,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: pressed ? colors.borderStrong : colors.bgRaised,
    borderWidth: outlined ? 1 : 0,
    borderColor: colors.border,
    opacity: enabled ? 1 : 0.4
  })
  const labelStyle = {
    fontFamily: fonts.mono,
    fontSize: type.caption.size,
    color: enabled ? colors.textSecondary : colors.textMuted
  }
  return (
    <View testID="native-chat-key-strip">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Why: the composer keyboard must stay up while tapping keys.
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{
          paddingHorizontal: space.md,
          paddingBottom: space.xs,
          gap: space.xs + 2,
          alignItems: 'center'
        }}
      >
        {keys.map((key) => (
          <Pressable
            key={key.id}
            disabled={!enabled}
            hitSlop={KEY_HIT_SLOP}
            style={({ pressed }) => keyStyle(pressed)}
            accessibilityRole="button"
            accessibilityLabel={key.accessibilityLabel ?? `Send ${key.label}`}
            onPressIn={() => {
              if (!key.repeatable) {
                return
              }
              heldKeyFiredRef.current = false
              onRepeatStart(createTerminalLiveAccessoryInput(key))
            }}
            onPressOut={() => {
              if (!key.repeatable) {
                return
              }
              heldKeyFiredRef.current = didRepeatFire()
              onRepeatStop()
            }}
            onPress={() => {
              if (key.repeatable && heldKeyFiredRef.current) {
                heldKeyFiredRef.current = false
                return
              }
              onKey(createTerminalLiveAccessoryInput(key))
            }}
          >
            <Txt style={labelStyle}>{key.label}</Txt>
          </Pressable>
        ))}
        {customKeys.map((key) => (
          <Pressable
            key={key.id}
            disabled={!enabled}
            hitSlop={KEY_HIT_SLOP}
            style={({ pressed }) => keyStyle(pressed, true)}
            accessibilityRole="button"
            accessibilityLabel={`Send ${key.label}`}
            onPress={() => onKey({ bytes: key.bytes })}
          >
            <Txt style={labelStyle}>{key.label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
