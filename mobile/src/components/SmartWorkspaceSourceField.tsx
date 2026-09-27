import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { openExternalLink } from '../platform/external-link'
import {
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  X
} from 'lucide-react-native'
import type { SmartNameSelection } from '../tasks/mobile-composer-source-types'
import type { MobileComposerSource } from '../tasks/use-mobile-composer-source'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'
import { TaskProviderLogo } from './TaskProviderLogo'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

type Props = {
  composer: MobileComposerSource
  label: string
  disabled?: boolean
  // Why: only the active form view may focus this field. While the source drawer
  // is open/closing this stays non-focusable so the drawer's dismiss (which
  // restores native focus back here) can't re-fire onFocus and reopen the drawer.
  interactive: boolean
  onBeforeOpen?: () => void
  onOpenDrawer: () => void
}

function SelectionIcon({ kind, color }: { kind: SmartNameSelection['kind']; color: string }) {
  if (kind === 'github-pr') {
    return <GitPullRequest size={15} color={color} />
  }
  if (kind === 'gitlab-mr') {
    return <GitMerge size={15} color={color} />
  }
  if (kind === 'github-issue' || kind === 'gitlab-issue') {
    return <CircleDot size={15} color={color} />
  }
  if (kind === 'branch') {
    return <GitBranch size={15} color={color} />
  }
  return <TaskProviderLogo provider="linear" size={15} color={color} />
}

export function SmartWorkspaceSourceField({
  composer,
  label,
  disabled,
  interactive,
  onBeforeOpen,
  onOpenDrawer
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(sourceFieldStyles)
  const selection = composer.smartNameSelection

  function openDrawer(): void {
    if (disabled) {
      return
    }
    onBeforeOpen?.()
    onOpenDrawer()
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} <Text style={styles.labelHint}>[Optional]</Text>
      </Text>
      {selection ? (
        <View style={styles.pill}>
          <SelectionIcon kind={selection.kind} color={colors.textSecondary} />
          <Text style={styles.pillLabel} numberOfLines={1}>
            {selection.label}
          </Text>
          {selection.url ? (
            <Pressable
              hitSlop={6}
              // The seam, not react-native's `Linking`: this field is in the tasks page closure, and
              // inside the shell's WebView `openURL` resolves without opening anything. (Code UI
              // calls the seam here directly; upstream threads it through an `onOpenExternalUrl`
              // prop chain this fork never took.)
              onPress={() => {
                if (selection.url) {
                  openExternalLink(selection.url)
                }
              }}
            >
              <ExternalLink size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable hitSlop={6} onPress={composer.handleClearSmartNameSelection}>
            <X size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        // Why: real TextInput (not a Pressable fake) so the typed value is the
        // same composer.name the source drawer docks — focus handoff keeps the
        // string continuous even though native focus moves to the docked field.
        <TextInput
          style={[styles.input, disabled && styles.disabled]}
          value={composer.name}
          onChangeText={composer.setName}
          onFocus={openDrawer}
          editable={!disabled && interactive}
          placeholder="Type a name or search a source"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          // Why: form field is a portal into the picker; return should not
          // submit the create form while the drawer is about to open.
          blurOnSubmit={false}
          showSoftInputOnFocus={false}
        />
      )}
    </View>
  )
}

function sourceFieldStyles({ colors }: Theme) {
  return StyleSheet.create({
    field: {
      marginBottom: spacing.md
    },
    label: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      marginBottom: spacing.xs
    },
    labelHint: {
      fontWeight: '400',
      color: colors.textMuted
    },
    input: {
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: TEXT_INPUT_FONT_SIZE,
      color: colors.text
    },
    disabled: {
      opacity: 0.55
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border
    },
    pillLabel: {
      flex: 1,
      fontSize: typography.bodySize,
      color: colors.text
    }
  })
}
