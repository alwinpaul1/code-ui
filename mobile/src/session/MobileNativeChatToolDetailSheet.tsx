import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { toolFilePath } from '../../../src/shared/native-chat-tool-summary'
import { DraggableDetailSheet } from '../components/DraggableDetailSheet'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { highlightMobileCode } from './mobile-file-syntax'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import {
  prettifyToolDetailOutput,
  toolDetailOutputIsJson,
  toolDetailStatus,
  toolDetailTitle,
  type ToolDetailInputRow,
  type ToolDetailStatus
} from './mobile-native-chat-tool-detail'
import {
  capToolDetailOutput,
  toolDetailIsGeneric,
  toolDetailSections,
  type ToolDetailSection
} from './mobile-native-chat-tool-detail-sections'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'
import { readViewOf } from './mobile-native-chat-read-view'
import { MobileNativeChatReadViewer } from './MobileNativeChatReadViewer'
import { SelectableSheetText } from './SelectableSheetText'
import { AGENT_LAUNCH_OPENING, agentTitle, readLaunch } from './mobile-background-task-transcript'
import { useAgentToolCallsSlot } from './native-chat-agent-tool-calls-slot'
import { toolCallKind } from './mobile-native-chat-tool-kind'
import { capturedShellOutput } from './mobile-background-shell-output'
import { BackgroundShellOutputBody } from './MobileBackgroundShellOutputSheet'
import { useNativeChatTranscript } from './native-chat-transcript-context'

const STATUS_TONE: Record<ToolDetailStatus, 'secondary' | 'danger' | 'muted'> = {
  Completed: 'secondary',
  Failed: 'danger',
  'In progress': 'muted'
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
  agentId = null,
  onClose
}: {
  /** The call+result pair to show, or null when no sheet should be open. */
  pair: NativeChatToolPair | null
  /** The agent an Agent call launched, where the opener knows it for certain
   *  (a run sheet row): the sheet then lists that agent's own calls. */
  agentId?: string | null
  onClose: () => void
}) {
  // Why: the caller nulls `pair` the instant it asks to close — simplest
  // contract for it — but `DraggableDetailSheet` keeps this mounted through
  // its own exit animation. Without a cache the content would blank out a
  // beat before the sheet has actually left the screen.
  const [shown, setShown] = useState({ pair, agentId })
  useEffect(() => {
    if (pair !== null) {
      setShown({ pair, agentId })
    }
  }, [pair, agentId])

  return (
    <DraggableDetailSheet
      visible={pair !== null}
      onClose={onClose}
      header={shown.pair ? <ToolDetailHeader pair={shown.pair} /> : null}
    >
      {shown.pair ? <ToolDetailBody pair={shown.pair} agentId={shown.agentId} /> : null}
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

export function ToolDetailBody({ pair, agentId = null }: { pair: NativeChatToolPair; agentId?: string | null }) {
  const files = useMemo(() => {
    const found = pair.call ? editFilesForToolCall(pair.call, pair.result ?? null) : null
    return found && found.length > 0 ? found : null
  }, [pair])
  // Memoised on the pair: a running tool re-renders the sheet as it streams.
  const sections = useMemo(() => toolDetailSections(pair, { hasChanges: files !== null }), [pair, files])
  const generic = useMemo(() => toolDetailIsGeneric(pair, files !== null), [pair, files])
  const isAgent = pair.call !== undefined && toolCallKind(pair.call.name) === 'agent'
  const renderAgentToolCalls = useAgentToolCallsSlot()
  // A background launch's acknowledgement is metadata Claude Code tells the
  // agent never to quote: the Claude app's Agent sheet has no result for it.
  const output = isAgent && AGENT_LAUNCH_OPENING.test(pair.result?.output ?? '') ? '' : (pair.result?.output ?? '')
  // A Claude Read's result is the file's numbered lines: drawn as the Claude
  // app's Read viewer, with Load full file, instead of the raw Output box.
  const readView = useMemo(
    () => (pair.call ? readViewOf(pair.call, output, pair.result?.isError === true) : null),
    [pair.call, output, pair.result?.isError]
  )
  // A Bash call that left a shell running: the agent's later reads of that
  // shell's output, as the Claude app's "Show output" (parity G27).
  const transcript = useNativeChatTranscript()
  const shellOutput = useMemo(() => {
    const shell = pair.call && pair.result ? readLaunch({ name: pair.call.name, input: pair.call.input, startedAt: null }, pair.result.output) : null
    return transcript && shell?.kind === 'shell' ? capturedShellOutput(transcript, shell.id) : null
  }, [pair, transcript])
  return (
    <View style={{ gap: 20 }}>
      {sections.map((section, index) => (
        <Section key={`${section.label}:${index}`} label={section.label}>
          {section.kind === 'changes' ? (
            files?.map((file, fileIndex) => (
              <MobileNativeChatDiffCard key={`${file.path}:${fileIndex}`} file={file} rowLimit={CHANGES_ROW_LIMIT} />
            ))
          ) : section.kind === 'inputs' ? (
            <InputRows rows={section.rows} />
          ) : (
            <Box>
              <SectionValue section={section} />
            </Box>
          )}
        </Section>
      ))}
      {isAgent && agentId && renderAgentToolCalls
        ? renderAgentToolCalls({
            agentId,
            title: agentTitle(pair.call?.input),
            toolUseId: pair.call?.callId ?? null,
            inSection: (label, body) => <Section label={label}>{body}</Section>
          })
        : null}
      {readView ? (
        <MobileNativeChatReadViewer
          view={readView}
          path={pair.call ? toolFilePath(pair.call.input) : null}
          inSection={(accessory, body) => (
            <Section label="Output" accessory={accessory}>
              {body}
            </Section>
          )}
        />
      ) : output.trim().length > 0 ? (
        generic ? (
          <ResultSection output={output} isError={pair.result?.isError === true} />
        ) : (
          <OutputSection output={output} isError={pair.result?.isError === true} />
        )
      ) : null}
      {shellOutput ? (
        <Section label="Shell output">
          <BackgroundShellOutputBody capture={shellOutput} />
        </Section>
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

function SectionValue({ section }: { section: Exclude<ToolDetailSection, { kind: 'changes' | 'inputs' }> }) {
  const { syntax } = useTheme()
  const code = section.kind === 'code' ? section : null
  const segments = useMemo(
    () => (code?.language ? highlightMobileCode(code.value, code.language).segments : null),
    [code?.value, code?.language]
  )
  switch (section.kind) {
    case 'prose':
      return <SelectableSheetText variant="body">{section.value}</SelectableSheetText>
    case 'markdown':
      return <MobileMarkdown content={section.value} />
    case 'code':
      return (
        <Unwrapped>
          <SelectableSheetText variant="mono">
            {segments ? (
              <MobileSyntaxSegments segments={segments} palette={syntax} />
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

/** The Claude app's list of a tool's inputs (`xv1`:377-410): each name a 13 sp
 *  line in the secondary text colour, 2 dp above its value at 15 sp in the
 *  primary one, 8 dp under each pair. No box, no code face: a value is prose,
 *  except a Markdown input, which is drawn rendered (the user, 2026-09-28). */
function InputRows({ rows }: { rows: ToolDetailInputRow[] }) {
  return (
    <View>
      {rows.map((row, index) => (
        <View key={`${row.name}:${index}`} style={{ gap: 2, paddingBottom: 8 }} testID="tool-detail-input-row">
          <Txt variant="label" tone="secondary" style={{ lineHeight: 19.5 }} testID="tool-detail-input-name">
            {row.name}
          </Txt>
          {row.isMarkdown ? (
            <MobileMarkdown content={row.value} />
          ) : (
            <SelectableSheetText variant="body" testID="tool-detail-input-value">
              {row.value}
            </SelectableSheetText>
          )}
        </View>
      ))}
    </View>
  )
}

/** The answer under a tool the Claude app has no layout for (`y030.p`:2647):
 *  "Result" in the muted label face and the text rendered as Markdown, or, when
 *  the call failed, "Error" in the danger colour over the text in it. No box
 *  and no Prettify: that pill belongs to a Bash call's output. */
function ResultSection({ output, isError }: { output: string; isError: boolean }) {
  const { text, hiddenLines } = capToolDetailOutput(output)
  return (
    <View style={{ gap: 4 }} testID="tool-detail-section">
      <Txt
        variant="label"
        weight="medium"
        tone={isError ? 'danger' : 'muted'}
        accessibilityRole="header"
        testID="tool-detail-section-label"
      >
        {isError ? 'Error' : 'Result'}
      </Txt>
      {isError ? (
        <SelectableSheetText variant="body" tone="danger" testID="tool-detail-output">
          {text}
        </SelectableSheetText>
      ) : (
        <MobileMarkdown content={text} />
      )}
      {hiddenLines > 0 ? (
        <Txt variant="caption" tone="muted" testID="tool-detail-output-more">
          {`${hiddenLines} more line${hiddenLines === 1 ? '' : 's'}`}
        </Txt>
      ) : null}
    </View>
  )
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
