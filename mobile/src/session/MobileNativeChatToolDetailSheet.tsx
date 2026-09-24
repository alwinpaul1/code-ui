import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { DraggableDetailSheet } from '../components/DraggableDetailSheet'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  prettifyToolDetailOutput,
  toolDetailInputRows,
  toolDetailOutputIsJson,
  toolDetailStatus,
  toolDetailTitle,
  type ToolDetailInputRow,
  type ToolDetailStatus
} from './mobile-native-chat-tool-detail'

const STATUS_TONE: Record<ToolDetailStatus, 'secondary' | 'danger' | 'muted'> = {
  Completed: 'secondary',
  Failed: 'danger',
  Running: 'muted'
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth
  }
})

/** The Claude-app tool-call detail sheet (2026-09-24 evidence): title, a
 *  Completed/Failed/Running status, Inputs as name -> value rows, and an
 *  Output block with a Prettify toggle when it parses as JSON. */
export function MobileNativeChatToolDetailSheet({
  pair,
  onClose
}: {
  /** The call+result pair to show, or null when no sheet should be open. */
  pair: NativeChatToolPair | null
  onClose: () => void
}) {
  // Why: the caller nulls `pair` the instant it asks to close — simplest
  // contract for it — but `DraggableDetailSheet` keeps this mounted through
  // its own exit animation. Without a cache the content would blank out a
  // beat before the sheet has actually left the screen.
  const [shown, setShown] = useState(pair)
  useEffect(() => {
    if (pair !== null) {
      setShown(pair)
    }
  }, [pair])

  return (
    <DraggableDetailSheet
      visible={pair !== null}
      onClose={onClose}
      header={shown ? <ToolDetailHeader pair={shown} /> : null}
    >
      {shown ? <ToolDetailBody pair={shown} /> : null}
    </DraggableDetailSheet>
  )
}

/** Exported so a render test can mount the header/body directly, the way
 *  `MobileBackgroundTasksSheetBody` is tested apart from `BottomDrawer` — the
 *  drawer shell pulls in gesture-handler/reanimated, which the content itself
 *  never touches. */
export function ToolDetailHeader({ pair }: { pair: NativeChatToolPair }) {
  const status = toolDetailStatus(pair)
  return (
    <View style={{ gap: 4, paddingRight: 32 }}>
      <Txt variant="heading" weight="semibold" testID="tool-detail-title">
        {toolDetailTitle(pair)}
      </Txt>
      <Txt variant="label" tone={STATUS_TONE[status]} testID="tool-detail-status">
        {status}
      </Txt>
    </View>
  )
}

export function ToolDetailBody({ pair }: { pair: NativeChatToolPair }) {
  const rows = toolDetailInputRows(pair.call?.input)
  const output = pair.result?.output ?? null
  return (
    <View style={{ gap: 20 }}>
      {rows.length > 0 ? (
        <View style={{ gap: 12 }}>
          <Txt variant="label" weight="medium" tone="muted">
            Inputs
          </Txt>
          {rows.map((row) => (
            <InputRow key={row.name} row={row} />
          ))}
        </View>
      ) : null}
      {output !== null ? (
        <OutputSection output={output} isError={pair.result?.isError === true} />
      ) : null}
    </View>
  )
}

function InputRow({ row }: { row: ToolDetailInputRow }) {
  return (
    <View style={{ gap: 2 }} testID="tool-detail-input-row">
      <Txt variant="caption" tone="muted">
        {row.name}
      </Txt>
      <Txt variant={row.isObject ? 'mono' : 'body'}>{row.value}</Txt>
    </View>
  )
}

function OutputSection({ output, isError }: { output: string; isError: boolean }) {
  const { colors } = useTheme()
  const isJson = toolDetailOutputIsJson(output)
  const [pretty, setPretty] = useState(false)
  const text = pretty && isJson ? prettifyToolDetailOutput(output) : output
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="label" weight="medium" tone="muted">
          Output
        </Txt>
        {isJson ? (
          <Pressable
            onPress={() => setPretty((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ selected: pretty }}
            testID="tool-detail-prettify"
            style={[styles.pill, { borderColor: colors.border, backgroundColor: colors.bgSunken }]}
          >
            <Txt variant="caption" tone={pretty ? 'accent' : 'secondary'}>
              {pretty ? 'Raw' : 'Prettify'}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <Txt variant="mono" tone={isError ? 'danger' : 'primary'} testID="tool-detail-output" selectable>
        {text}
      </Txt>
    </View>
  )
}
