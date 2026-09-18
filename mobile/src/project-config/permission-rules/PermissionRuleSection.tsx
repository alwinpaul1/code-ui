import { Pressable, View } from 'react-native'
import { Plus, Trash2 } from 'lucide-react-native'
import { useTheme, useThemedStyles, type Theme } from '../../theme/theme-context'
import { Txt } from '../../ui/Txt'
import type { PermissionRuleCategory } from './permission-rules-parse'

const CATEGORY_LABEL: Record<PermissionRuleCategory, string> = {
  allow: 'Allow',
  deny: 'Deny',
  ask: 'Ask'
}

/** One of the three rule-category lists (allow/deny/ask): its rows and an
 *  "Add rule" row. Split out of MobilePermissionRulesPanel.tsx so the same
 *  block is not written three times and the panel file stays under the
 *  repo's line cap. */
export function PermissionRuleSection({
  category,
  rules,
  readOnly = false,
  onAdd,
  onRemove
}: {
  category: PermissionRuleCategory
  rules: string[]
  /** A viewer only: no remove on a row and no "Add rule" row. */
  readOnly?: boolean
  onAdd: () => void
  onRemove: (rule: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(sectionStyles)
  return (
    <View style={styles.section}>
      <Txt variant="label" weight="semibold" tone="secondary" style={styles.title}>
        {CATEGORY_LABEL[category]}
      </Txt>
      {rules.length === 0 ? (
        <Txt variant="caption" tone="muted">
          No rules.
        </Txt>
      ) : (
        rules.map((rule) => (
          <View key={rule} style={styles.row}>
            <Txt variant="mono" style={{ flex: 1 }} numberOfLines={2}>
              {rule}
            </Txt>
            {readOnly ? null : (
              <Pressable accessibilityLabel={`Remove ${rule}`} onPress={() => onRemove(rule)} hitSlop={8}>
                <Trash2 size={15} color={colors.danger} />
              </Pressable>
            )}
          </View>
        ))
      )}
      {readOnly ? null : (
        <Pressable style={styles.addRow} onPress={onAdd}>
          <Plus size={14} color={colors.accentText} />
          <Txt variant="caption" tone="accent">
            Add rule
          </Txt>
        </Pressable>
      )}
    </View>
  )
}

function sectionStyles({ colors, radius, space }: Theme) {
  return {
    section: {
      marginBottom: space.lg,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    title: { marginBottom: space.xs },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: space.sm,
      paddingVertical: space.xs
    },
    addRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: space.xs,
      marginTop: space.xs,
      paddingVertical: space.xs
    }
  }
}
