// The mobile half of Orca #18765 (172aa1ac3), which shipped desktop-only: one
// file an agent edited, rendered as interleaved unified rows under the file's
// own name, instead of every removed line followed by every added line with
// nothing saying which file changed or where.
//
// The gutter stays blank when the provider gave no resolved ranges: a
// snippet-relative number reads as a position in the file, and it would be
// wrong.

import { memo } from 'react'
import { Text, View } from 'react-native'
import { FileMinus2, FilePen, FilePlus2 } from 'lucide-react-native'
import {
  unifiedLineNumber,
  type NativeChatEditFile,
  type NativeChatEditLine
} from '../../../src/shared/native-chat-edit-model'
import { useTheme } from '../theme/theme-context'
import { useDiffCardStyles, type DiffCardStyles } from './mobile-native-chat-diff-card-styles'

/** A phone renders every row it is given, so the card takes its own ceiling
 *  rather than the model's 2,000. */
export const MAX_DIFF_CARD_ROWS = 200

const VERB_LABEL: Record<NativeChatEditFile['changeKind'], string> = {
  added: 'Added file',
  deleted: 'Deleted file',
  renamed: 'Renamed file',
  edited: 'Edited file'
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path
}

function VerbIcon({
  kind,
  color
}: {
  kind: NativeChatEditFile['changeKind']
  color: string
}): React.JSX.Element {
  if (kind === 'added') {
    return <FilePlus2 size={13} color={color} strokeWidth={2} />
  }
  if (kind === 'deleted') {
    return <FileMinus2 size={13} color={color} strokeWidth={2} />
  }
  return <FilePen size={13} color={color} strokeWidth={2} />
}

function DiffCardRow({
  line,
  gutterWidth,
  styles
}: {
  line: NativeChatEditLine
  gutterWidth: number
  styles: DiffCardStyles
}): React.JSX.Element {
  if (line.kind === 'gap') {
    return (
      <Text style={styles.gap} accessibilityLabel="Lines not shown">
        ⋯
      </Text>
    )
  }
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
  return (
    <View
      style={[
        styles.row,
        line.kind === 'add' && styles.rowAdd,
        line.kind === 'del' && styles.rowDel
      ]}
    >
      {gutterWidth > 0 ? (
        <Text
          testID="diff-card-gutter"
          style={[styles.gutter, { width: gutterWidth * 8 }]}
          numberOfLines={1}
        >
          {unifiedLineNumber(line) ?? ''}
        </Text>
      ) : null}
      <Text
        testID="diff-card-marker"
        style={[
          styles.marker,
          line.kind === 'add' && styles.markerAdd,
          line.kind === 'del' && styles.markerDel
        ]}
      >
        {marker}
      </Text>
      <Text testID="diff-card-text" style={styles.text}>
        {line.text}
      </Text>
    </View>
  )
}

/** One edited file: the verb, the file's own name, the change counts, and the
 *  interleaved rows. Disclosure belongs to the tool line above it, so the card
 *  has no second caret of its own — one tap on a phone, not two. */
function DiffCard({ file, rowLimit = MAX_DIFF_CARD_ROWS }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useDiffCardStyles()
  const rows = file.lines.slice(0, rowLimit)
  const clipped = file.truncated || rows.length < file.lines.length
  const widest = file.lineNumbersKnown
    ? rows.reduce((max, line) => Math.max(max, unifiedLineNumber(line) ?? 0), 0)
    : 0
  const gutterWidth = file.lineNumbersKnown ? Math.max(3, String(widest).length + 1) : 0
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <VerbIcon kind={file.changeKind} color={colors.textMuted} />
        <Text testID="diff-card-verb" style={styles.verb}>
          {VERB_LABEL[file.changeKind]}
        </Text>
        {file.oldPath ? (
          <>
            <Text style={styles.oldPath} numberOfLines={1}>
              {baseName(file.oldPath)}
            </Text>
            <Text style={styles.arrow}>→</Text>
          </>
        ) : null}
        <Text testID="diff-card-path" style={styles.path} numberOfLines={1}>
          {baseName(file.path)}
        </Text>
        <Text testID="diff-card-added" style={styles.added}>
          {`+${file.added}`}
        </Text>
        <Text testID="diff-card-removed" style={styles.removed}>
          {`−${file.removed}`}
        </Text>
        {clipped ? (
          // Beside the counts, not under the rows: a card clipped down to no
          // rows at all would otherwise say nothing about what it dropped.
          <Text style={styles.truncated}>Diff truncated</Text>
        ) : null}
      </View>
      {rows.length > 0 ? (
        <View style={styles.body}>
          {rows.map((line, index) => (
            <DiffCardRow
              key={`${line.kind}:${line.oldLineNumber}:${line.newLineNumber}:${index}`}
              line={line}
              gutterWidth={gutterWidth}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

type Props = {
  file: NativeChatEditFile
  /** Rows this card will draw before it reports itself clipped. */
  rowLimit?: number
}

export const MobileNativeChatDiffCard = memo(DiffCard)
