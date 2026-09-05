import { useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { ChevronDown, ChevronsRight, Keyboard as KeyboardIcon, Monitor, Plus, Smartphone } from 'lucide-react-native'
import { triggerMediumImpact } from '../platform/haptics'
import { createTerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import { isTerminalPhoneDisplayMode } from './mobile-session-route-helpers'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { MobileSessionController } from './use-mobile-session-controller'

/** The terminal dock's accessory row: keyboard dismiss, phone/desktop mode,
 *  live/buffered toggle, paste, built-in keys, custom shortcuts, add. */
export function MobileSessionAccessoryStrip({ controller }: { controller: MobileSessionController }) {
  const { colors, fonts, radius, space, type } = useTheme()
  const {
    activeHandle,
    customKeys,
    setShowCustomKeyModal,
    setDeleteKeyTarget,
    visibleBuiltInAccessoryKeys,
    terminalModes,
    canPaste,
    canSend,
    canCompose,
    liveInputEnabled,
    toggleDisplayMode,
    handleAccessoryKey,
    dismissSoftwareKeyboard,
    toggleLiveInput,
    stopAccessoryRepeat,
    startAccessoryRepeat,
    didAccessoryRepeatFire,
    handlePaste,
    keyboardLift
  } = controller
  // Whether the key being released already auto-repeated during its hold.
  // onPressOut runs before onPress, so release records it here for the tap path.
  const heldKeyFiredRef = useRef(false)

  const keyStyle = ({
    pressed,
    disabled,
    active,
    outlined
  }: {
    pressed: boolean
    disabled: boolean
    active?: boolean
    outlined?: boolean
  }) => ({
    minWidth: 36,
    height: 30,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: active ? colors.text : pressed ? colors.borderStrong : colors.bgRaised,
    borderWidth: outlined ? 1 : 0,
    borderColor: colors.border,
    opacity: disabled ? 0.35 : 1
  })
  const keyText = (disabled: boolean) => ({
    fontFamily: fonts.mono,
    fontSize: type.caption.size,
    color: disabled ? colors.textMuted : colors.textSecondary
  })
  const phoneMode = isTerminalPhoneDisplayMode(activeHandle, terminalModes)

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* Why: fixed keyboard escape hatch; outside ScrollView + shortcut path so it can't scroll away or be hidden (#5106). */}
      {keyboardLift > 0 && (
        <Pressable
          style={({ pressed }) => [
            keyStyle({ pressed, disabled: false }),
            { marginLeft: space.sm, marginVertical: space.xs }
          ]}
          onPress={dismissSoftwareKeyboard}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          accessibilityHint="Hides the software keyboard and keeps the current terminal session open."
        >
          <View style={{ alignItems: 'center', height: 18, width: 18, position: 'relative' }}>
            <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
            <ChevronDown
              size={10}
              color={colors.textSecondary}
              strokeWidth={2.5}
              style={{ position: 'absolute', bottom: -2 }}
            />
          </View>
        </Pressable>
      )}
      {/* Why: default tap handling makes the first accessory-key tap dismiss the keyboard and get swallowed (#5106). */}
      <ScrollView
        style={{ flex: 1, minWidth: 0 }}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
          gap: space.xs + 2,
          alignItems: 'center'
        }}
        keyboardShouldPersistTaps="always"
      >
        <Pressable
          style={({ pressed }) => keyStyle({ pressed, disabled: !canSend })}
          disabled={!canSend}
          onPress={() => {
            if (activeHandle) {
              void toggleDisplayMode(activeHandle)
            }
          }}
          accessibilityLabel={phoneMode ? 'Switch to desktop mode' : 'Switch to phone mode'}
        >
          {phoneMode ? (
            <Monitor size={14} color={canSend ? colors.textSecondary : colors.textMuted} />
          ) : (
            <Smartphone size={14} color={canSend ? colors.textSecondary : colors.textMuted} />
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) =>
            keyStyle({ pressed, disabled: !canCompose, active: liveInputEnabled })
          }
          // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
          disabled={!canCompose}
          onPress={toggleLiveInput}
          accessibilityLabel={
            liveInputEnabled ? 'Switch to buffered command input' : 'Switch to live terminal input'
          }
        >
          <ChevronsRight
            size={14}
            color={
              liveInputEnabled
                ? colors.textInverse
                : canCompose
                  ? colors.textSecondary
                  : colors.textMuted
            }
          />
        </Pressable>
        {canPaste && (
          <Pressable
            style={({ pressed }) => keyStyle({ pressed, disabled: !canSend })}
            disabled={!canSend}
            onPress={() => void handlePaste()}
            accessibilityLabel="Paste from clipboard"
          >
            <Txt style={keyText(!canSend)}>Paste</Txt>
          </Pressable>
        )}
        {visibleBuiltInAccessoryKeys.map((key) => (
          <Pressable
            key={key.id}
            style={({ pressed }) => keyStyle({ pressed, disabled: !canSend })}
            disabled={!canSend}
            // Why (#12251): repeatable keys no longer send on press-in. A swipe
            // that starts on an arrow key presses in, then the strip's
            // ScrollView steals the touch (press-out, no press), so nothing is
            // sent. A tap sends once on release; a hold starts repeating after
            // the repeat delay and the release then sends nothing extra.
            onPressIn={() => {
              if (!key.repeatable) {
                return
              }
              heldKeyFiredRef.current = false
              startAccessoryRepeat(createTerminalLiveAccessoryInput(key))
            }}
            onPressOut={() => {
              if (!key.repeatable) {
                return
              }
              heldKeyFiredRef.current = didAccessoryRepeatFire()
              stopAccessoryRepeat()
            }}
            onPress={() => {
              if (key.repeatable && heldKeyFiredRef.current) {
                heldKeyFiredRef.current = false
                return
              }
              void handleAccessoryKey(createTerminalLiveAccessoryInput(key))
            }}
            accessibilityLabel={key.accessibilityLabel ?? `Send ${key.label}`}
          >
            <Txt style={keyText(!canSend)}>{key.label}</Txt>
          </Pressable>
        ))}
        {customKeys.map((key) => (
          <Pressable
            key={key.id}
            style={({ pressed }) => keyStyle({ pressed, disabled: !canSend, outlined: true })}
            disabled={!canSend}
            onPress={() => void handleAccessoryKey({ bytes: key.bytes })}
            onLongPress={() => {
              triggerMediumImpact()
              setDeleteKeyTarget(key)
            }}
            delayLongPress={400}
            accessibilityLabel={`Send ${key.label}`}
          >
            <Txt style={keyText(!canSend)}>{key.label}</Txt>
          </Pressable>
        ))}
        <Pressable
          style={({ pressed }) => keyStyle({ pressed, disabled: false })}
          onPress={() => setShowCustomKeyModal(true)}
          accessibilityLabel="Add custom shortcut"
        >
          <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
        </Pressable>
      </ScrollView>
    </View>
  )
}
