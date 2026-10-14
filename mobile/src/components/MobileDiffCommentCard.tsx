import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Pencil, Trash2 } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { tapTargetHitSlop } from '../ui/tap-target'
import { spacing } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'

type Props = {
  comment: DiffComment
  /** The file changed since the comment was written. */
  stale: boolean
  onEdit: (comment: DiffComment) => void
  onDelete: (comment: DiffComment) => void
}

/**
 * A saved comment under its line, as the Claude app draws one (`px20.c` in com.anthropic.claude
 * 1.261009.20): a card in the surface colour, 24 dp corners and a 0.5 dp hairline, 8 dp around it
 * and 8 dp inside; "Line N" in muted 13 sp with Edit and Delete beside it; the words below, which
 * open the editor too. The labels are `diff_comment_line_caption`, `diff_comment_edit_button`,
 * `generic_button_delete`, `diff_comment_open_action` and `diff_remove_comment`.
 */
export function MobileDiffCommentCard({ comment, stale, onEdit, onDelete }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(commentCardStyles)
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.captionRow}>
          <Text style={styles.caption}>{`Line ${comment.lineNumber}`}</Text>
          {stale ? <Text style={styles.stale}>Stale</Text> : null}
        </View>
        <Pressable
          hitSlop={tapTargetHitSlop(styles.button)}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => onEdit(comment)}
          accessibilityRole="button"
          accessibilityLabel="Edit comment"
        >
          <Pencil size={14} color={colors.composerIcon} strokeWidth={2} />
          <Text style={styles.buttonText}>Edit</Text>
        </Pressable>
        <Pressable
          hitSlop={tapTargetHitSlop(styles.button)}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => onDelete(comment)}
          accessibilityRole="button"
          accessibilityLabel="Delete comment"
        >
          <Trash2 size={14} color={colors.composerIcon} strokeWidth={2} />
          <Text style={styles.buttonText}>Delete</Text>
        </Pressable>
      </View>
      {comment.body.length > 0 ? (
        <Pressable
          onPress={() => onEdit(comment)}
          accessibilityRole="button"
          accessibilityLabel={comment.body}
          accessibilityHint="Edit comment"
        >
          <Text style={styles.body}>{comment.body}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function commentCardStyles({ colors, radius }: Theme) {
  return StyleSheet.create({
    card: {
      marginHorizontal: spacing.sm,
      marginVertical: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.composerBorder,
      backgroundColor: colors.attachmentCardFill
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingLeft: 5
    },
    captionRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    caption: {
      color: colors.composerPlaceholder,
      fontSize: 13,
      lineHeight: 18
    },
    stale: {
      color: colors.warning,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600'
    },
    button: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill
    },
    buttonPressed: {
      backgroundColor: colors.composerControlPressed
    },
    buttonText: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500'
    },
    body: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 24,
      paddingHorizontal: 5,
      paddingTop: 3
    }
  })
}
