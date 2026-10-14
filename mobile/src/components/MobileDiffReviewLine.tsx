import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'
import {
  MOBILE_DIFF_CODE_START_PADDING,
  MOBILE_DIFF_MARKER_WIDTH,
  MOBILE_DIFF_TYPE,
  mobileDiffPaletteForScheme
} from '../source-control/mobile-diff-claude-palette'
import { mobileDiffLineNumber } from '../source-control/mobile-diff-format'
import { typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'
import { MobileDiffCommentCard } from './MobileDiffCommentCard'
import { MobileDiffGapRow } from './MobileDiffGapRow'
import { MobileDiffNoteRow } from './MobileDiffNoteRow'
import { MobileSyntaxSegments } from './MobileSyntaxSegments'

type Props = {
  line: MobileHighlightedDiffLine<MobileDiffLine>
  comments: readonly DiffComment[]
  staleCommentIds: ReadonlySet<string>
  active: boolean
  /** Width of the gutter cell, the same for every row of one file (`mobileDiffGutterWidth`). */
  gutterWidth: number
  onAddNote: (lineNumber: number) => void
  onEditNote: (comment: DiffComment) => void
  onDeleteNote: (comment: DiffComment) => void
}

/** The gutter's text: a "+" or "-" and the number, as the Claude app draws it (`jlc.c`). */
function gutterLabel(line: MobileDiffLine): string {
  const number = mobileDiffLineNumber(line)
  if (line.kind === 'add') {
    return `+${number}`
  }
  return line.kind === 'delete' ? `-${number}` : number
}

function canCommentOnLine(line: MobileDiffLine): boolean {
  return line.kind !== 'delete' && line.newLineNumber !== undefined
}

/** What a screen reader says of the row: the gutter, then the code (`diff_line_description`). */
function describeLine(line: MobileDiffLine): string {
  const label = gutterLabel(line)
  return line.text.trim().length === 0 ? label : `${label}, ${line.text}`
}

export function MobileDiffReviewLine({
  line,
  comments,
  staleCommentIds,
  active,
  gutterWidth,
  onAddNote,
  onEditNote,
  onDeleteNote
}: Props) {
  const { syntax, scheme } = useTheme()
  const styles = useThemedStyles(diffReviewLineStyles)
  const canComment = canCommentOnLine(line)
  const commented = comments.length > 0

  // A run of unchanged lines the mobile cap folded away: the lines are not here to bring back,
  // so the fold row is plain text. Anything else that is not a line of the file stays a note.
  if (line.note?.kind === 'collapsed') {
    return (
      <MobileDiffGapRow
        hiddenLines={line.note.hiddenLines}
        action={null}
        gutterWidth={gutterWidth}
        accessibilityLabel={line.text}
      />
    )
  }
  if (line.note) {
    return <MobileDiffNoteRow line={line} />
  }

  const palette = mobileDiffPaletteForScheme(scheme)
  const marker =
    line.kind === 'add' ? palette.addMarker : line.kind === 'delete' ? palette.delMarker : null
  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          line.kind === 'add' && styles.addedRow,
          line.kind === 'delete' && styles.deletedRow,
          // The highlight wins over the tint, as `jlc.c` picks `mng.f` first.
          commented && styles.commentedRow,
          active && styles.activeRow,
          pressed && canComment && styles.rowPressed
        ]}
        disabled={!canComment}
        onPress={() => {
          if (canComment && line.newLineNumber !== undefined) {
            onAddNote(line.newLineNumber)
          }
        }}
        accessibilityRole={canComment ? 'button' : 'text'}
        accessibilityLabel={describeLine(line)}
        accessibilityHint={canComment ? 'Comment on this line' : undefined}
        accessibilityValue={
          line.kind === 'add'
            ? { text: 'Added' }
            : line.kind === 'delete'
              ? { text: 'Removed' }
              : undefined
        }
      >
        {marker ? <View style={[styles.marker, { backgroundColor: marker }]} /> : null}
        <View style={[styles.gutterCell, { width: gutterWidth }]}>
          <Text
            style={[
              styles.gutterText,
              commented && line.kind === 'context' && styles.gutterTextMuted
            ]}
            numberOfLines={1}
          >
            {gutterLabel(line)}
          </Text>
        </View>
        <View style={styles.code}>
          <Text style={styles.codeText}>
            <MobileSyntaxSegments segments={line.segments} palette={syntax} />
          </Text>
        </View>
      </Pressable>
      {comments.map((comment) => (
        <MobileDiffCommentCard
          key={comment.id}
          comment={comment}
          stale={staleCommentIds.has(comment.id)}
          onEdit={onEditNote}
          onDelete={onDeleteNote}
        />
      ))}
    </>
  )
}

// Row height comes from the 19.5 line height alone (no vertical padding or minHeight), as in the
// Claude app, where the gutter text's 1.5 em at 13 sp sets it.
function diffReviewLineStyles({ colors, scheme }: Theme) {
  const palette = mobileDiffPaletteForScheme(scheme)
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch'
    },
    addedRow: {
      backgroundColor: palette.addBg
    },
    deletedRow: {
      backgroundColor: palette.delBg
    },
    commentedRow: {
      backgroundColor: palette.commentedBg
    },
    activeRow: {
      borderLeftWidth: 2,
      borderLeftColor: colors.accent
    },
    rowPressed: {
      opacity: 0.8
    },
    marker: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: MOBILE_DIFF_MARKER_WIDTH
    },
    gutterCell: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.composerBorder
    },
    gutterText: {
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: MOBILE_DIFF_TYPE.gutterSize,
      lineHeight: MOBILE_DIFF_TYPE.lineHeight,
      textAlign: 'left'
    },
    gutterTextMuted: {
      color: colors.composerPlaceholder
    },
    code: {
      flex: 1,
      minWidth: 0,
      paddingLeft: MOBILE_DIFF_CODE_START_PADDING
    },
    codeText: {
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: MOBILE_DIFF_TYPE.codeSize,
      lineHeight: MOBILE_DIFF_TYPE.lineHeight
    }
  })
}
