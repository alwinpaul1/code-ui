import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import type { ConnectionLogEntry } from '../transport/types'
import {
  entryKey,
  formatClock,
  type LiveConnectionRow,
  type TimelineRow
} from './connection-diagnostics-timeline'

type Props = {
  /** Printed above the rows, so it is clear whose log this is. */
  title: string
  /** What the host's live client says now, pinned above the list so no tail of old failures
   *  can read as the current state. */
  live: LiveConnectionRow
  rows: readonly TimelineRow[]
}

const LEVEL_COLOR: Record<ConnectionLogEntry['level'], keyof ThemeColors> = {
  info: 'textSecondary',
  success: 'success',
  warn: 'warning',
  error: 'danger'
}

const LEVEL_GLYPH: Record<ConnectionLogEntry['level'], string> = {
  info: '•',
  success: '✓',
  warn: '!',
  error: '✕'
}

const TONE_COLOR: Record<LiveConnectionRow['tone'], keyof ThemeColors> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger'
}

/** The newest line on screen, inside a fold or not. A new event changes it even when it joins a
 *  fold or the log's window slides, which a row count does not see. */
function newestLineKey(rows: readonly TimelineRow[]): string | null {
  const last = rows[rows.length - 1]
  if (last === undefined) {
    return null
  }
  if (last.kind === 'entry') {
    return last.key
  }
  const newest = last.entries[last.entries.length - 1]
  return newest === undefined ? last.key : entryKey(newest)
}

/**
 * The Network diagnostics timeline, from the live theme. It replaces the pairing screens' log
 * here, which paints from the static dark palette and has no way to fold a run of rows.
 */
export function ConnectionDiagnosticsTimeline({ title, live, rows }: Props) {
  const styles = useThemedStyles(timelineStyles)
  const { colors } = useTheme()
  const scrollRef = useRef<ScrollView | null>(null)
  const scrolledFor = useRef<string | null>(null)
  // An opened fold is remembered by its lines, not its key: the key names the fold's first line,
  // which the log's sliding window drops, and a fold must not close under the user's finger.
  const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set())
  const newest = newestLineKey(rows)
  // One client's label on every row says nothing; labels earn their line once two are in view.
  const labelClients = new Set(rows.map((row) => row.client).filter((c) => c !== null)).size > 1

  const isOpen = (entries: readonly ConnectionLogEntry[]): boolean =>
    entries.some((entry) => openLines.has(entryKey(entry)))

  const toggleFold = useCallback((entries: readonly ConnectionLogEntry[]) => {
    setOpenLines((open) => {
      const keys = entries.map(entryKey)
      const next = new Set(open)
      if (keys.some((key) => next.has(key))) {
        keys.forEach((key) => next.delete(key))
      } else {
        keys.forEach((key) => next.add(key))
      }
      return next
    })
  }, [])

  // Follow new events to the bottom, but not an opened fold: that would scroll away from the
  // lines the user just asked to read.
  const followNewEvents = useCallback(() => {
    if (newest !== scrolledFor.current) {
      scrolledFor.current = newest
      scrollRef.current?.scrollToEnd({ animated: true })
    }
  }, [newest])

  const entryRow = (
    entry: ConnectionLogEntry,
    client: number | null,
    key: string,
    nested: boolean
  ) => (
    <View key={key} style={[styles.row, nested && styles.nestedRow]}>
      <Text style={styles.timestamp}>{formatClock(entry.ts)}</Text>
      <Text style={[styles.glyph, { color: colors[LEVEL_COLOR[entry.level]] }]}>
        {LEVEL_GLYPH[entry.level]}
      </Text>
      <View style={styles.rowText}>
        <Text style={[styles.message, { color: colors[LEVEL_COLOR[entry.level]] }]}>
          {entry.message}
        </Text>
        {entry.detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {entry.detail}
          </Text>
        ) : null}
        {client !== null && labelClients && !nested ? (
          <Text style={styles.client}>{`client ${client}`}</Text>
        ) : null}
      </View>
    </View>
  )

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.liveRow} testID="connection-live-row">
        <View style={[styles.liveDot, { backgroundColor: colors[TONE_COLOR[live.tone]] }]} />
        <Text style={styles.liveText}>{live.text}</Text>
      </View>
      <View style={styles.separator} />
      {rows.length === 0 ? (
        <Text style={styles.emptyText}>
          No connection events yet. Events appear as the app dials this host.
        </Text>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={followNewEvents}
        >
          {rows.map((row) => {
            if (row.kind === 'entry') {
              return entryRow(row.entry, row.client, row.key, false)
            }
            const open = isOpen(row.entries)
            return (
              <View key={row.key}>
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => toggleFold(row.entries)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                >
                  <Text style={styles.timestamp}>{formatClock(row.ts)}</Text>
                  <Text style={[styles.glyph, { color: colors.warning }]}>{LEVEL_GLYPH.warn}</Text>
                  <View style={styles.rowText}>
                    <Text style={[styles.message, { color: colors.warning }]}>{row.text}</Text>
                    {row.client !== null && labelClients ? (
                      <Text style={styles.client}>{`client ${row.client}`}</Text>
                    ) : null}
                  </View>
                  {open ? (
                    <ChevronDown size={14} color={colors.textMuted} />
                  ) : (
                    <ChevronRight size={14} color={colors.textMuted} />
                  )}
                </Pressable>
                {open
                  ? row.entries.map((entry, index) =>
                      entryRow(entry, row.client, `${row.key}/${index}`, true)
                    )
                  : null}
              </View>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

function timelineStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      width: '100%',
      flex: 1,
      backgroundColor: colors.bgPanel,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md
    },
    title: {
      fontSize: typography.metaSize,
      fontFamily: typography.monoFamily,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing.xs
    },
    liveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    liveText: {
      flex: 1,
      fontSize: typography.metaSize,
      fontWeight: '600',
      color: colors.text
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.xs
    },
    scroll: {
      flex: 1
    },
    scrollContent: {
      gap: 6
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm
    },
    nestedRow: {
      paddingLeft: spacing.md
    },
    rowPressed: {
      backgroundColor: colors.bgRaised
    },
    timestamp: {
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      color: colors.textMuted,
      width: 60,
      paddingTop: 1
    },
    glyph: {
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      width: 12,
      textAlign: 'center',
      paddingTop: 1
    },
    rowText: {
      flex: 1
    },
    message: {
      fontFamily: typography.monoFamily,
      fontSize: typography.metaSize,
      lineHeight: 16
    },
    detail: {
      fontFamily: typography.monoFamily,
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 14,
      marginTop: 1
    },
    client: {
      fontFamily: typography.monoFamily,
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 14
    },
    emptyText: {
      fontSize: typography.metaSize,
      color: colors.textMuted,
      lineHeight: 18,
      paddingVertical: spacing.xs
    }
  })
}
