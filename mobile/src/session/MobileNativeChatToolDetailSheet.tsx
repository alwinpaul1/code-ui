import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { DraggableDetailSheet } from '../components/DraggableDetailSheet'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { useTheme } from '../theme/theme-context'
import type { TypeVariant } from '../theme/tokens'
import { Txt } from '../ui/Txt'
import { highlightMobileCode } from './mobile-file-syntax'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import {
  prettifyToolDetailOutput,
  toolDetailOutputIsJson,
  toolDetailStatus,
  toolDetailTitle,
  type ToolDetailStatus
} from './mobile-native-chat-tool-detail'
import {
  capToolDetailOutput,
  toolDetailSections,
  type ToolDetailSection
} from './mobile-native-chat-tool-detail-sections'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'

const STATUS_TONE: Record<ToolDetailStatus, 'secondary' | 'danger' | 'muted'> = {
  Completed: 'secondary',
  Failed: 'danger',
  Running: 'muted'
}

/** Diff rows the Changes section draws, the same bound as the output's lines. */
const CHANGES_ROW_LIMIT = 400

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth
  }
})

/** The Claude-app tool-call detail sheet: the tool's name, a
 *  Completed/Failed/Running status, then one labelled box per thing the call
 *  carries (2026-10-10 screenshots: Description, Command, Output), with a
 *  Prettify toggle on an Output that parses as JSON. */
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
 *  drawer shell pulls in reanimated and the sheet's pans, which the content
 *  itself never touches (the body's only gestures are its texts' own). */
export function ToolDetailHeader({ pair }: { pair: NativeChatToolPair }) {
  const status = toolDetailStatus(pair)
  // The Claude app's layout: the tool's name bold at the title size, centred
  // on one line, the status centred under it, the close cross on the left.
  // Equal room on both sides keeps the title centred on the sheet and clear of
  // the cross.
  return (
    <View style={{ gap: 4, paddingHorizontal: 32 }}>
      <Txt
        variant="title"
        weight="bold"
        align="center"
        numberOfLines={1}
        accessibilityRole="header"
        testID="tool-detail-title"
      >
        {toolDetailTitle(pair)}
      </Txt>
      <Txt variant="label" tone={STATUS_TONE[status]} align="center" testID="tool-detail-status">
        {status}
      </Txt>
    </View>
  )
}

export function ToolDetailBody({ pair }: { pair: NativeChatToolPair }) {
  const files = useMemo(() => {
    const found = pair.call ? editFilesForToolCall(pair.call, pair.result ?? null) : null
    return found && found.length > 0 ? found : null
  }, [pair])
  const sections = toolDetailSections(pair, { hasChanges: files !== null })
  const output = pair.result?.output ?? ''
  return (
    <View style={{ gap: 20 }}>
      {sections.map((section, index) => (
        <Section key={`${section.label}:${index}`} label={section.label}>
          {section.kind === 'changes' ? (
            files?.map((file, fileIndex) => (
              <MobileNativeChatDiffCard key={`${file.path}:${fileIndex}`} file={file} rowLimit={CHANGES_ROW_LIMIT} />
            ))
          ) : (
            <Box>
              <SectionValue section={section} />
            </Box>
          )}
        </Section>
      ))}
      {output.trim().length > 0 ? (
        <OutputSection output={output} isError={pair.result?.isError === true} />
      ) : null}
    </View>
  )
}

/** A small muted label over its box. TalkBack can step from label to label
 *  as headings. */
function Section({ label, accessory, children }: { label: string; accessory?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }} testID="tool-detail-section">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="label" weight="medium" tone="muted" accessibilityRole="header" testID="tool-detail-section-label">
          {label}
        </Txt>
        {accessory}
      </View>
      {children}
    </View>
  )
}

/** The inset the Claude app draws each value in: darker than the sheet in
 *  both schemes (bgSunken under bgPanel), a small radius. */
function Box({ children }: { children: ReactNode }) {
  const { colors, radius, space } = useTheme()
  return (
    <View
      testID="tool-detail-box"
      style={{ backgroundColor: colors.bgSunken, borderRadius: radius.xs, padding: space.lg }}
    >
      {children}
    </View>
  )
}

/** Code never wraps: one line of command stays one line, and a long line of
 *  output scrolls sideways instead of folding into the next. */
function Unwrapped({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {children}
    </ScrollView>
  )
}

function SectionValue({ section }: { section: Exclude<ToolDetailSection, { kind: 'changes' }> }) {
  const { syntax } = useTheme()
  switch (section.kind) {
    case 'prose':
      return <SelectableSheetText variant="body">{section.value}</SelectableSheetText>
    case 'markdown':
      return <MobileMarkdown content={section.value} />
    case 'code':
      return (
        <Unwrapped>
          <SelectableSheetText variant="mono">
            {section.language ? (
              <MobileSyntaxSegments segments={highlightMobileCode(section.value, section.language).segments} palette={syntax} />
            ) : (
              section.value
            )}
          </SelectableSheetText>
        </Unwrapped>
      )
    default: {
      const unhandled: never = section
      return unhandled
    }
  }
}

function OutputSection({ output, isError }: { output: string; isError: boolean }) {
  const { colors } = useTheme()
  const isJson = toolDetailOutputIsJson(output)
  const [pretty, setPretty] = useState(false)
  // Capped after prettifying, so both views stop at the same place.
  const { text, hiddenLines } = capToolDetailOutput(pretty && isJson ? prettifyToolDetailOutput(output) : output)
  const pill = isJson ? (
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
  ) : null
  return (
    <Section label="Output" accessory={pill}>
      <Box>
        <Unwrapped>
          <SelectableSheetText variant="mono" tone={isError ? 'danger' : 'primary'} testID="tool-detail-output">
            {text}
          </SelectableSheetText>
        </Unwrapped>
      </Box>
      {hiddenLines > 0 ? (
        <Txt variant="caption" tone="muted" testID="tool-detail-output-more">
          {`${hiddenLines} more line${hiddenLines === 1 ? '' : 's'}`}
        </Txt>
      ) : null}
    </Section>
  )
}

/**
 * Selectable text that lets go when the sheet's pan takes the touch.
 *
 * Why the gesture: the sheet scrolls and drags under gesture-handler, and once
 * a pan activates, its root stops passing the touch to the Android views below
 * without sending them a cancel. A selectable TextView arms its long-press on
 * touch-down, never hears the finger move or lift, and selects the word under
 * it mid-scroll (Copy / Translate / Select all, reported 2026-09-26). With a
 * Native gesture of its own, the pan's activation cancels that gesture, and
 * gesture-handler hands the TextView an ACTION_CANCEL, which drops the
 * pending long-press. A long-press that does not move still selects.
 */
function SelectableSheetText({
  variant,
  tone = 'primary',
  testID,
  children
}: {
  variant: TypeVariant
  tone?: 'danger' | 'primary'
  testID?: string
  children: ReactNode
}) {
  const gesture = useMemo(() => Gesture.Native(), [])
  // The detector sets user-select: none on web unless told otherwise.
  return (
    <GestureDetector gesture={gesture} userSelect="text">
      <Txt variant={variant} tone={tone} testID={testID} selectable>
        {children}
      </Txt>
    </GestureDetector>
  )
}
