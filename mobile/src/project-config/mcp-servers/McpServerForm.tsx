import { Pressable, TextInput, View } from 'react-native'
import { useTheme, useThemedStyles, type Theme } from '../../theme/theme-context'
import { Txt } from '../../ui/Txt'
import { Button } from '../../ui/Button'
import type { McpServerFormState } from './mcp-server-form-fields'

const ENV_PLACEHOLDER = 'Env, one KEY=VALUE per line'

export function McpServerForm({
  form,
  onChange,
  onCancel,
  onSubmit
}: {
  form: McpServerFormState
  onChange: (next: McpServerFormState) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(formStyles)
  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        value={form.name}
        onChangeText={(name) => onChange({ ...form, name })}
        placeholder="Server name"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
      />
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggle, !form.isRemote && styles.toggleActive]}
          onPress={() => onChange({ ...form, isRemote: false })}
        >
          <Txt variant="caption">Command</Txt>
        </Pressable>
        <Pressable
          style={[styles.toggle, form.isRemote && styles.toggleActive]}
          onPress={() => onChange({ ...form, isRemote: true })}
        >
          <Txt variant="caption">Remote URL</Txt>
        </Pressable>
      </View>
      {form.isRemote ? (
        <TextInput
          style={styles.input}
          value={form.url}
          onChangeText={(url) => onChange({ ...form, url })}
          placeholder="https://example.com/mcp"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={form.command}
            onChangeText={(command) => onChange({ ...form, command })}
            placeholder="Command (e.g. npx)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={form.argsText}
            onChangeText={(argsText) => onChange({ ...form, argsText })}
            placeholder="Args, space-separated"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            value={form.envText}
            onChangeText={(envText) => onChange({ ...form, envText })}
            placeholder={ENV_PLACEHOLDER}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            multiline
          />
        </>
      )}
      <View style={styles.formActions}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Add to list" onPress={onSubmit} style={{ flex: 1 }} />
      </View>
    </View>
  )
}

function formStyles({ colors, radius, space }: Theme) {
  return {
    form: { padding: space.md, gap: space.sm },
    input: {
      backgroundColor: colors.bgPanel,
      color: colors.text,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: space.sm,
      paddingVertical: space.sm
    },
    multiline: { minHeight: 72, textAlignVertical: 'top' as const },
    toggleRow: { flexDirection: 'row' as const, gap: space.xs },
    toggle: {
      flex: 1,
      alignItems: 'center' as const,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    toggleActive: { backgroundColor: colors.bgRaised },
    formActions: { flexDirection: 'row' as const, gap: space.sm }
  }
}
