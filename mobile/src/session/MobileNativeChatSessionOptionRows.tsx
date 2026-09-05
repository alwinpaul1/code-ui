// The pill and choice-row primitives the session-option card is built from, kept
// beside it so the card file stays about layout and apply wiring.

import { Pressable, View } from 'react-native'
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'

/** Muted one-liner above a group — dispatch state, or why a row is locked. */
export function SessionOptionCaption({ children }: { children: string }): React.JSX.Element {
  const { space } = useTheme()
  return (
    <Txt
      variant="caption"
      tone="muted"
      style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}
    >
      {children}
    </Txt>
  )
}

export function Pill({
  label,
  accessibleName,
  disabled,
  onPress
}: {
  label: string
  accessibleName: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      accessibilityLabel={accessibleName}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        // Why: the action row also carries the mode pill, the context ring, the
        // mic and send. A long label ("Opus Extra high") must ellipsize rather
        // than push those off the right edge.
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 190,
        height: 30,
        paddingHorizontal: space.sm + 2,
        borderRadius: radius.pill,
        backgroundColor: pressed && !disabled ? colors.bgSunken : colors.bgRaised,
        opacity: disabled ? 0.6 : 1
      })}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      <Txt
        variant="caption"
        weight="semibold"
        tone={disabled ? 'muted' : 'secondary'}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ flexShrink: 1 }}
      >
        {label}
      </Txt>
      <ChevronDown size={12} color={disabled ? colors.textMuted : colors.textSecondary} />
    </Pressable>
  )
}

function RowBase({
  selected,
  disabled,
  grouped,
  divided,
  accessibilityRole,
  onPress,
  children
}: {
  selected?: boolean
  disabled: boolean
  grouped: boolean
  divided: boolean
  accessibilityRole: 'radio' | 'button'
  onPress: () => void
  children: React.ReactNode
}) {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.sm + 2,
        padding: space.md,
        minHeight: 46,
        alignItems: 'center',
        borderRadius: grouped ? 0 : radius.md,
        backgroundColor: pressed ? colors.bgSunken : grouped ? 'transparent' : colors.bgRaised,
        borderWidth: grouped ? 0 : 1,
        borderColor: selected ? colors.accent : colors.border,
        borderBottomWidth: divided ? 1 : grouped ? 0 : 1,
        borderBottomColor: divided ? colors.border : selected ? colors.accent : colors.border,
        marginBottom: grouped ? 0 : space.xs,
        opacity: disabled ? 0.5 : 1
      })}
      onPress={onPress}
      disabled={disabled}
    >
      {children}
    </Pressable>
  )
}

function Radio({ selected }: { selected: boolean }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.textMuted,
        backgroundColor: selected ? colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {selected ? <Check size={12} color={colors.onAccent} strokeWidth={3} /> : null}
    </View>
  )
}

function ChoiceRow({
  label,
  description,
  selected,
  disabled,
  grouped,
  divided,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  disabled: boolean
  grouped: boolean
  divided: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <RowBase
      selected={selected}
      disabled={disabled}
      grouped={grouped}
      divided={divided}
      accessibilityRole="radio"
      onPress={onPress}
    >
      <Radio selected={selected} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" weight="medium">
          {label}
        </Txt>
        {description ? (
          <Txt variant="caption" tone="secondary" numberOfLines={2}>
            {description}
          </Txt>
        ) : null}
      </View>
    </RowBase>
  )
}

function ActionRow({
  label,
  disabled,
  grouped,
  onPress
}: {
  label: string
  disabled: boolean
  grouped: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <RowBase
      disabled={disabled}
      grouped={grouped}
      divided={false}
      accessibilityRole="button"
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Txt variant="body" weight="medium">
          {label}
        </Txt>
      </View>
    </RowBase>
  )
}

export function SessionOptionSummaryRow({
  label,
  value,
  disabled,
  divided,
  onPress
}: {
  label: string
  value: string
  disabled: boolean
  divided: boolean
  onPress: () => void
}): React.JSX.Element {
  const { colors, space } = useTheme()
  return (
    <Pressable
      accessibilityLabel={`${label}, ${value}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: divided ? 1 : 0,
        borderBottomColor: colors.border,
        backgroundColor: pressed && !disabled ? colors.bgSunken : 'transparent',
        opacity: disabled ? 0.5 : 1
      })}
      onPress={onPress}
      disabled={disabled}
    >
      <Txt variant="body" weight="medium" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="body" tone="secondary" numberOfLines={1} style={{ maxWidth: 160 }}>
        {value}
      </Txt>
      <ChevronRight size={16} color={colors.textMuted} strokeWidth={2.2} />
    </Pressable>
  )
}

export function DescriptorRows({
  descriptor,
  disabled,
  grouped = false,
  onSetOption,
  onInvokeAction
}: {
  descriptor: SessionOptionDescriptor
  disabled: boolean
  grouped?: boolean
  onSetOption: (value: SessionOptionValue) => void
  onInvokeAction: () => void
}): React.JSX.Element {
  const locked = disabled || !descriptor.settable
  // Why: flip-only without a baseline is an action — never claim On/Off.
  if (descriptor.action?.type === 'toggle-command') {
    return (
      <ActionRow
        label={`Toggle ${descriptor.label.toLowerCase()}`}
        disabled={locked}
        grouped={grouped}
        onPress={onInvokeAction}
      />
    )
  }
  // Why: agent-picker opens the TUI; it is not a set of radio choices.
  if (descriptor.action?.type === 'agent-picker') {
    return (
      <ActionRow
        label="Choose in agent picker…"
        disabled={locked}
        grouped={grouped}
        onPress={onInvokeAction}
      />
    )
  }
  // Unknown booleans leave both radios unselected instead of inventing truth.
  if (descriptor.kind.type === 'boolean') {
    const current = descriptor.kind.currentValue
    return (
      <>
        {current === undefined ? (
          <SessionOptionCaption>Current value unknown — pick On or Off</SessionOptionCaption>
        ) : null}
        <ChoiceRow
          label="On"
          selected={current === true}
          disabled={locked}
          grouped={grouped}
          divided={grouped}
          onPress={() => onSetOption(true)}
        />
        <ChoiceRow
          label="Off"
          selected={current === false}
          disabled={locked}
          grouped={grouped}
          divided={false}
          onPress={() => onSetOption(false)}
        />
      </>
    )
  }
  const { currentValue, choices } = descriptor.kind
  return (
    <>
      {choices.map((choice, index) => (
        <ChoiceRow
          key={choice.value}
          label={choice.label}
          description={choice.description}
          selected={choice.value === currentValue}
          disabled={locked}
          grouped={grouped}
          divided={grouped && index < choices.length - 1}
          onPress={() => onSetOption(choice.value)}
        />
      ))}
    </>
  )
}
