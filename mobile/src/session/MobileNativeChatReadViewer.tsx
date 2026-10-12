import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { isMarkdownPath } from '../files/file-tree'
import { DESKTOP_TEXT_READ_CAP } from '../files/mobile-file-preview-response'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  readViewCaption,
  readViewOfFile,
  readViewText,
  type ReadView,
  type ReadViewLine
} from './mobile-native-chat-read-view'
import { createStaleAfterReconnectLedger, shouldRefetchAfterReconnect } from '../transport/stale-after-reconnect'
import { useNativeChatFileReader } from './native-chat-file-read-context'
import { SelectableSheetText } from './SelectableSheetText'

/** Lines per Text pair: a few thousand lines in one Text is one huge layout. */
const CHUNK_LINES = 200

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth
  }
})

type Loaded = ReadView & { total: number; hostCut: boolean }

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; file: Loaded }
  /** `final`: the host answered and asking again will not change it. */
  | { kind: 'failed'; message: string; final: boolean }

/**
 * The Read call's file, as the Claude app's Read sheet draws it: a gutter of
 * line numbers beside the lines, "Showing N lines (truncated)" under a part,
 * "Load full file" to fetch the rest, and "Render" for a Markdown file.
 *
 * The numbers and the lines are two Texts per chunk, in the same face and line
 * height, so they stay level; the lines never wrap and scroll sideways.
 */
export function MobileNativeChatReadViewer({
  view,
  path,
  inSection
}: {
  view: ReadView
  /** The file the call read; null leaves nothing to load. */
  path: string | null
  /** Puts the viewer in the sheet's own labelled section, with the Render
   *  toggle at the label's right. */
  inSection: (accessory: ReactNode, body: ReactNode) => ReactNode
}) {
  const { colors, radius, space } = useTheme()
  const reader = useNativeChatFileReader()
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const [rendered, setRendered] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  const [ledger] = useState(createStaleAfterReconnectLedger)
  const markdown = path !== null && isMarkdownPath(path)
  const shown = load.kind === 'loaded' ? load.file : view
  const startLoad = () => {
    if (!reader || path === null) {
      return
    }
    if (!reader.connected) {
      setLoad({ kind: 'failed', message: 'Not connected to session', final: false })
      return
    }
    setLoad({ kind: 'loading' })
    void reader.read(path).then((outcome) => {
      if (!alive.current) {
        return
      }
      if (outcome.kind === 'read') {
        const file = readViewOfFile(outcome.content, outcome.truncated)
        setLoad({ kind: 'loaded', file: { ...file, hostCut: outcome.truncated } })
      } else {
        setLoad({ kind: 'failed', message: `Couldn't load file: ${outcome.reason}`, final: outcome.kind === 'refused' })
      }
    })
  }
  // A load that failed on the way (or was asked for while disconnected) is
  // asked again by itself once per NEW connection, never in a loop
  // (CLAUDE.md, "Nothing stays stale once the relay connects").
  const retryable = load.kind === 'failed' && !load.final
  const connectedAt = reader?.connectedAt ?? null
  useEffect(() => {
    if (shouldRefetchAfterReconnect(ledger, 'load', retryable ? 'error' : 'ready', connectedAt) && retryable && reader?.connected) {
      startLoad()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- startLoad reads the current reader; only a new connection or a new failure may trigger it.
  }, [retryable, connectedAt, reader?.connected])
  const canLoad =
    reader !== null &&
    path !== null &&
    view.truncated &&
    (load.kind === 'idle' || (load.kind === 'failed' && !load.final))
  const caption =
    load.kind === 'loaded'
      ? load.file.hostCut
        ? `Loaded first ${DESKTOP_TEXT_READ_CAP}; file is larger`
        : load.file.truncated
          ? readViewCaption(load.file.lines.length, load.file.total)
          : null
      : view.truncated
        ? readViewCaption(view.lines.length, null)
        : null
  const accessory = markdown ? (
    <Pressable
      onPress={() => setRendered((value) => !value)}
      accessibilityRole="button"
      accessibilityState={{ selected: rendered }}
      testID="read-viewer-render"
      style={[styles.pill, { borderColor: colors.border, backgroundColor: colors.bgSunken }]}
    >
      <Txt variant="caption" tone={rendered ? 'accent' : 'secondary'}>
        {rendered ? 'Raw' : 'Render'}
      </Txt>
    </Pressable>
  ) : null
  const body = (
    <View style={{ gap: space.sm }} testID="read-viewer">
      <View style={{ backgroundColor: colors.bgSunken, borderRadius: radius.xs, padding: space.lg }}>
        {rendered ? <MobileMarkdown content={readViewText(shown.lines)} /> : <NumberedLines lines={shown.lines} />}
      </View>
      {caption ? (
        <Txt variant="caption" tone="muted" testID="read-viewer-caption">
          {caption}
        </Txt>
      ) : null}
      {load.kind === 'failed' ? (
        <Txt variant="caption" tone="danger" testID="read-viewer-load-error">
          {load.message}
        </Txt>
      ) : null}
      {load.kind === 'loading' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Txt variant="caption" tone="muted">
            Loading file…
          </Txt>
        </View>
      ) : null}
      {canLoad ? (
        <Pressable
          onPress={startLoad}
          accessibilityRole="button"
          testID="read-viewer-load"
          hitSlop={8}
          style={({ pressed }) => [
            styles.pill,
            { alignSelf: 'flex-start', borderColor: colors.border, opacity: pressed ? 0.6 : 1 }
          ]}
        >
          <Txt variant="caption" tone="secondary">
            Load full file
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
  return inSection(accessory, body)
}

function NumberedLines({ lines }: { lines: readonly ReadViewLine[] }) {
  const { space } = useTheme()
  const chunks = useMemo(() => {
    const out: ReadViewLine[][] = []
    for (let index = 0; index < lines.length; index += CHUNK_LINES) {
      out.push(lines.slice(index, index + CHUNK_LINES))
    }
    return out
  }, [lines])
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {chunks.map((chunk) => (
          <View key={chunk[0]!.number} style={{ flexDirection: 'row', gap: space.md }}>
            <Txt variant="mono" tone="muted" align="right" testID="read-viewer-gutter">
              {chunk.map((line) => line.number).join('\n')}
            </Txt>
            <SelectableSheetText variant="mono" testID="read-viewer-lines">
              {chunk.map((line) => line.text).join('\n')}
            </SelectableSheetText>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}
