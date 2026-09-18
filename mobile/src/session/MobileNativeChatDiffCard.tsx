// The mobile half of Orca #18765 (172aa1ac3), which shipped desktop-only: one
// file an agent edited, rendered as interleaved unified rows under the file's
// own name, instead of every removed line followed by every added line with
// nothing saying which file changed or where.
//
// The gutter stays blank when the provider gave no resolved ranges: a
// snippet-relative number reads as a position in the file, and it would be
// wrong.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { FileMinus2, FilePen, FilePlus2 } from 'lucide-react-native'
import {
  unifiedLineNumber,
  type NativeChatEditFile,
  type NativeChatEditLine
} from '../../../src/shared/native-chat-edit-model'
import { useTheme } from '../theme/theme-context'
import { editCardHunks, hunkRevertPrecheck } from './mobile-diff-hunk-revert'
import {
  hunkRevertMarkKey,
  isHunkMarkedReverted,
  markHunkReverted
} from './mobile-diff-hunk-revert-marks'
import type { HunkRevertOutcome } from './mobile-diff-hunk-revert-request'
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

/** What one hunk's action is showing. `offered` may carry the one line the
 *  last attempt left behind; `reverted` is final and never offers again. */
type HunkActionState =
  | { phase: 'offered'; note?: { text: string; tone: 'note' | 'error' } }
  | { phase: 'busy' }
  | { phase: 'reverted' }

const OFFERED: HunkActionState = { phase: 'offered' }
const REVERTED: HunkActionState = { phase: 'reverted' }

/** "Revert this hunk" under a hunk, or "Reverted" once it has been, plus the
 *  one line a refusal or a rejected write leaves behind. */
function HunkActionRow({
  state,
  onPress,
  styles
}: {
  state: HunkActionState
  onPress: () => void
  styles: DiffCardStyles
}): React.JSX.Element {
  const busy = state.phase === 'busy'
  return (
    <View style={styles.hunkAction} testID="diff-card-hunk-action">
      {state.phase === 'reverted' ? (
        <Text style={styles.hunkActionDone}>Reverted</Text>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.hunkActionButton, pressed && { opacity: 0.6 }]}
          onPress={onPress}
          disabled={busy}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Revert this hunk"
          accessibilityState={{ disabled: busy, busy }}
        >
          <Text style={styles.hunkActionLabel}>{busy ? 'Reverting…' : 'Revert this hunk'}</Text>
        </Pressable>
      )}
      {state.phase === 'offered' && state.note ? (
        <Text
          style={state.note.tone === 'error' ? styles.hunkActionError : styles.hunkActionNote}
          accessibilityLiveRegion="polite"
        >
          {state.note.text}
        </Text>
      ) : null}
    </View>
  )
}

/** One edited file: the verb, the file's own name, the change counts, and the
 *  interleaved rows. Disclosure belongs to the tool line above it, so the card
 *  has no second caret of its own — one tap on a phone, not two. */
function DiffCard({
  file,
  rowLimit = MAX_DIFF_CARD_ROWS,
  verb,
  onRevertHunk,
  revertScope = ''
}: Props): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useDiffCardStyles()
  const rows = file.lines.slice(0, rowLimit)
  const clipped = file.truncated || rows.length < file.lines.length
  // Per-hunk action state, keyed by what the hunk is rather than by its index,
  // so a re-render with a re-derived `file` keeps it. A hunk already put back
  // is read from the shared marks, which outlive this mount.
  const [actionStates, setActionStates] = useState<ReadonlyMap<string, HunkActionState>>(
    () => new Map()
  )
  const mountedRef = useRef(true)
  // The hunks with a write in flight. A ref, not state: two taps in one tick
  // would both read the render's map before either could set it busy.
  const inFlightRef = useRef(new Set<string>())
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // Which drawn row each offered action hangs under: the hunk's last row, and
  // only when the whole hunk is drawn — a revert of rows the reader cannot see
  // is not a revert they asked for.
  const actionsByRow = useMemo(() => {
    const byRow = new Map<number, { hunkIndex: number; key: string }>()
    if (!onRevertHunk) {
      return byRow
    }
    const hunks = editCardHunks(file)
    for (const hunk of hunks) {
      if (hunk.endIndex < rows.length && hunkRevertPrecheck(file, hunk.index, hunks).ok) {
        byRow.set(hunk.endIndex, {
          hunkIndex: hunk.index,
          key: hunkRevertMarkKey(revertScope, file, hunk)
        })
      }
    }
    return byRow
  }, [file, onRevertHunk, revertScope, rows.length])

  const setHunkState = (key: string, state: HunkActionState): void => {
    if (!mountedRef.current) {
      return
    }
    setActionStates((current) => new Map(current).set(key, state))
  }

  const revert = async (hunkIndex: number, key: string): Promise<void> => {
    if (!onRevertHunk || inFlightRef.current.has(key)) {
      return
    }
    inFlightRef.current.add(key)
    setHunkState(key, { phase: 'busy' })
    let outcome: HunkRevertOutcome
    try {
      outcome = await onRevertHunk(file, hunkIndex, revertScope)
    } catch (error) {
      outcome = {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      inFlightRef.current.delete(key)
    }
    switch (outcome.status) {
      case 'reverted':
        markHunkReverted(key)
        setHunkState(key, REVERTED)
        return
      case 'refused':
        setHunkState(key, { phase: 'offered', note: { text: outcome.message, tone: 'note' } })
        return
      case 'failed':
        setHunkState(key, { phase: 'offered', note: { text: outcome.message, tone: 'error' } })
        return
      default: {
        const never: never = outcome
        throw new Error(`unhandled revert outcome ${String(never)}`)
      }
    }
  }
  const widest = file.lineNumbersKnown
    ? rows.reduce((max, line) => Math.max(max, unifiedLineNumber(line) ?? 0), 0)
    : 0
  const gutterWidth = file.lineNumbersKnown ? Math.max(3, String(widest).length + 1) : 0
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <VerbIcon kind={file.changeKind} color={colors.textMuted} />
        <Text testID="diff-card-verb" style={styles.verb}>
          {verb ?? VERB_LABEL[file.changeKind]}
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
          {rows.map((line, index) => {
            const action = actionsByRow.get(index)
            const row = (
              <DiffCardRow
                key={`${line.kind}:${line.oldLineNumber}:${line.newLineNumber}:${index}`}
                line={line}
                gutterWidth={gutterWidth}
                styles={styles}
              />
            )
            if (!action) {
              return row
            }
            const state =
              actionStates.get(action.key) ??
              (isHunkMarkedReverted(action.key) ? REVERTED : OFFERED)
            return (
              <View key={`hunk:${action.key}`}>
                {row}
                <HunkActionRow
                  state={state}
                  onPress={() => void revert(action.hunkIndex, action.key)}
                  styles={styles}
                />
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

type Props = {
  file: NativeChatEditFile
  /** Rows this card will draw before it reports itself clipped. */
  rowLimit?: number
  /** Replaces the past-tense verb. The permission card shows an edit that has
   *  not happened yet, and "Edited file" over it would claim that it had. */
  verb?: string
  /** Puts one hunk of a LANDED edit back in the file. Absent on a card that
   *  shows a proposal (the permission card), where there is nothing to undo. */
  onRevertHunk?: (
    file: NativeChatEditFile,
    hunkIndex: number,
    cardScope: string
  ) => Promise<HunkRevertOutcome>
  /** Which card this is, beyond its content: the message it came from and its
   *  place in it. A later message re-applying the same edit is another card. */
  revertScope?: string
}

export const MobileNativeChatDiffCard = memo(DiffCard)
