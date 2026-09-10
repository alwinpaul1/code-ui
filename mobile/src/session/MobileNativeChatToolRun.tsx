import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  SquareChevronRight,
  SquareTerminal,
  Wrench
} from 'lucide-react-native'
import { diffFromText, diffFromToolCall } from '../../../src/shared/native-chat-diff'
import type { NativeChatDiffLine as DiffLine } from '../../../src/shared/native-chat-diff'
import {
  editFilesFromToolPair,
  isEditToolName
} from '../../../src/shared/native-chat-edit-normalize'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import { MobileNativeChatTaskList } from './MobileNativeChatTaskList'
import {
  mobileTaskListPreview,
  mobileTaskListRows,
  type MobileTaskListRow
} from './mobile-native-chat-task-list-rows'
import {
  ToolExecutionMeta,
  ToolRowName,
  ToolSearchResults
} from './MobileNativeChatToolAnnotations'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatToolPair as ToolPair } from '../../../src/shared/native-chat-tool-fold'
import {
  createToolInputDisplay,
  toolRunSummaryMembers,
  truncateToolDetail
} from '../../../src/shared/native-chat-tool-summary'
import {
  describeActiveToolCall,
  formatActiveToolLabel,
  formatToolCallCount,
  NATIVE_CHAT_TOOL_ACTIVITY_COPY
} from '../../../src/shared/native-chat-tool-activity'
import { isShellActivityToolCall } from '../../../src/shared/native-chat-tool-icon'
import type {
  NativeChatBlock,
  NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

const MAX_VISIBLE_TOOL_PAIRS = 6
const MAX_TOOL_RUN_DIFF_ROWS = 240

export function DiffView({ lines, styles }: { lines: DiffLine[]; styles: ChatMessageStyles }) {
  return (
    <View style={styles.diff}>
      {lines.map((line, i) => (
        <Text
          key={i}
          style={[
            styles.diffLine,
            line.kind === 'add' && styles.diffAdd,
            line.kind === 'del' && styles.diffDel,
            line.kind === 'meta' && styles.diffMeta
          ]}
        >
          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          {line.text}
        </Text>
      ))}
    </View>
  )
}

function ResultBody({
  output,
  isError,
  diff,
  styles
}: {
  output: string
  isError?: boolean
  diff: DiffLine[] | null
  styles: ChatMessageStyles
}) {
  if (diff) {
    return <DiffView lines={diff} styles={styles} />
  }
  return (
    <View style={[styles.toolResult, isError && styles.toolResultError]}>
      <Text style={styles.mono}>{truncateToolDetail(output)}</Text>
    </View>
  )
}

/** The files one edit call changed, or null when the model refuses to claim an
 *  edit — a failed call, one still running, or a turn that stopped before its
 *  call was answered. Those keep the generic tool view and its error body. */
function editFilesForPair(pair: ToolPair) {
  const { call, result } = pair
  if (!call) {
    return null
  }
  const files = editFilesFromToolPair({
    name: call.name,
    input: call.input,
    ...(call.state ? { state: call.state } : {}),
    ...(result
      ? {
          result: {
            output: result.output,
            isError: result.isError,
            editPatch: result.editPatch
          }
        }
      : {})
  })
  return files && files.length > 0 ? files : null
}

/** One request: a tool call and its result rendered together as a single
 *  expandable line. `defaultExpanded` lets the group toggle open every line. */
function ToolLine({
  pair,
  taskList,
  defaultExpanded,
  diffLineLimit,
  onOpenFile,
  styles
}: {
  pair: ToolPair
  /** Set when this pair is the agent revising its plan, in which case the
   *  checklist speaks for the call AND its result. */
  taskList: MobileTaskListRow | null
  defaultExpanded: boolean
  diffLineLimit: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { call, result } = pair
  const name = call ? call.name : 'Result'
  const inputDisplay = call ? createToolInputDisplay(call.input) : null
  // A plan's input has no path and no primary argument, so the generic label
  // falls through to a bounded JSON preview — `{"todos":[{"content":…` on the
  // one line the phone gives a collapsed row. Say how far along it is instead.
  const preview = taskList
    ? mobileTaskListPreview(taskList.list)
    : (inputDisplay?.label ?? result?.output.split('\n')[0]?.slice(0, 80) ?? '')
  // Why: collapsed tool rows are the common path; defer bounded diff parsing
  // and detail formatting until the user asks to reveal the detail.
  // An edit renders as one card per file it changed, which speaks for the call
  // AND its result — the raw flat diff and the result body are suppressed, so
  // one turn never shows two presentations of the same change.
  const editFiles =
    !taskList && expanded && call && isEditToolName(call.name) ? editFilesForPair(pair) : null
  const rendered = editFiles !== null || taskList !== null
  const callDiff =
    !rendered && expanded && call ? diffFromToolCall(call.name, call.input, diffLineLimit) : null
  const resultDiff =
    !rendered && expanded && result ? diffFromText(result.output, diffLineLimit) : null
  const callDetail =
    expanded && inputDisplay && !callDiff && !rendered ? inputDisplay.formatDetail() : undefined
  const searchResults = call?.webSearchResults
  const hasResults = (searchResults?.length ?? 0) > 0
  const hasDetail =
    callDiff !== null || result !== undefined || inputDisplay?.hasDetail === true || hasResults
  // The group toggle opens every line at once, bypassing the tap guard, so the
  // panel has to consult it too — else a detail-less row echoes its own label
  // under itself and no tap can dismiss it.
  const showDetail = hasDetail && expanded
  const filePath = inputDisplay?.filePath ?? null
  const openable = filePath !== null && onOpenFile !== undefined
  return (
    <View>
      <Pressable
        style={styles.toolLine}
        onPress={() => hasDetail && setExpanded((v) => !v)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetail }}
      >
        {showDetail ? (
          <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
        )}
        {call ? (
          <ToolRowName name={name} mcpIdentity={call.mcpIdentity} styles={styles} />
        ) : (
          <Text style={styles.toolName}>{name}</Text>
        )}
        {preview ? (
          <Text
            testID="tool-line-preview"
            style={[styles.toolPreview, openable && styles.toolPreviewLink]}
            numberOfLines={1}
            onPress={openable ? () => onOpenFile!(filePath!) : undefined}
            suppressHighlighting={!openable}
          >
            {preview}
          </Text>
        ) : null}
        {call ? <ToolExecutionMeta block={call} styles={styles} /> : null}
      </Pressable>
      {showDetail ? (
        <View style={styles.toolDetail}>
          {hasResults ? <ToolSearchResults results={searchResults} styles={styles} /> : null}
          {taskList ? (
            <MobileNativeChatTaskList
              list={taskList.list}
              {...(taskList.previous ? { previous: taskList.previous } : {})}
            />
          ) : null}
          {editFiles?.map((file, index) => (
            <MobileNativeChatDiffCard
              key={`${file.path}:${index}`}
              file={file}
              rowLimit={diffLineLimit}
            />
          ))}
          {callDiff ? <DiffView lines={callDiff} styles={styles} /> : null}
          {callDetail ? <Text style={styles.mono}>{callDetail}</Text> : null}
          {!rendered && result ? (
            <ResultBody
              output={result.output}
              isError={result.isError}
              diff={resultDiff}
              styles={styles}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** Breathing label for a still-running tool, matching desktop's `animate-pulse`. */
function PulsingText({
  style,
  numberOfLines,
  testID,
  children
}: {
  style?: React.ComponentProps<typeof Animated.Text>['style']
  numberOfLines?: number
  testID?: string
  children: React.ReactNode
}) {
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [pulse])
  return (
    <Animated.Text
      style={[style, { opacity: pulse }]}
      numberOfLines={numberOfLines}
      testID={testID}
    >
      {children}
    </Animated.Text>
  )
}

/** A run of a message's tool calls/results, collapsed to a one-line summary
 *  ("2×  Read src/app.ts · Edit …", Codex-app style) that expands to the inline
 *  tool lines. `defaultExpanded` lets the global toolbar toggle drive every run. */
export function ToolRun({
  blocks,
  defaultExpanded,
  expandChildren,
  activeCall = null,
  trailing,
  onOpenFile,
  styles
}: {
  blocks: NativeChatBlock[]
  defaultExpanded: boolean
  /** Child tool lines stay collapsed when the turn caret drove the run open.
   *  Omitted, the children follow the run — which is what the global Tools
   *  toggle has always done, and the only behaviour the bridge lane has. */
  expandChildren?: boolean
  /** The still-running call, when the turn is live (desktop parity). Null on
   *  the bridge lane, which has no per-call lifecycle to read. */
  activeCall?: NativeChatToolCallBlock | null
  trailing?: React.ReactNode
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(defaultExpanded)
  const pairs = pairToolBlocks(blocks, MAX_VISIBLE_TOOL_PAIRS)
  // Cheap enough to run collapsed: it also decides the one-line row preview, so
  // a plan row says how far along it is before anyone opens it.
  const taskLists = mobileTaskListRows(pairs)
  const diffLineLimit = Math.max(1, Math.floor(MAX_TOOL_RUN_DIFF_ROWS / (pairs.length * 2 || 1)))
  let callCount = 0
  for (const block of blocks) {
    if (block.type === 'tool-call') {
      callCount++
    }
  }
  callCount ||= pairs.length
  // Members stay separate all the way to the markup. Joining them into one
  // string is what made a batch read as a single call: the separator also
  // occurs inside tool names like `browser.open` and `tools/read`, so nothing
  // told the reader where one call ended and the next began. Each member now
  // opens with its name in the foreground tone and trails its argument muted,
  // and that tone change is the boundary.
  const summaryMembers = toolRunSummaryMembers(blocks)
  const hiddenCallCount = Math.max(0, callCount - summaryMembers.length)
  // The call's input, not its word: Codex names a classified shell row
  // `read`/`search`/`list` and keeps the command it ran, while Claude's `Read`
  // shares that word and ran none.
  const ActiveToolIcon = activeCall && isShellActivityToolCall(activeCall) ? SquareTerminal : Wrench
  if (activeCall) {
    return (
      <View style={styles.toolRun}>
        <View style={styles.toolRunHeader}>
          <Pressable
            style={styles.toolRunActive}
            onPress={() => setOpen((v) => !v)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLiveRegion="polite"
          >
            <ActiveToolIcon size={14} color={colors.textMuted} strokeWidth={2} />
            <PulsingText
              style={styles.toolRunActiveLabel}
              numberOfLines={1}
              testID="tool-run-active-label"
            >
              {formatActiveToolLabel(describeActiveToolCall(activeCall))}
            </PulsingText>
            {open ? <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} /> : null}
          </Pressable>
          {trailing}
        </View>
        {open ? renderBody() : null}
      </View>
    )
  }
  return (
    <View style={styles.toolRun}>
      <View style={styles.toolRunHeader}>
        <Pressable
          style={styles.toolRunToggle}
          onPress={() => setOpen((v) => !v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <SquareChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.toolRunCount}>{callCount}×</Text>
          {summaryMembers.length > 0 ? (
            <Text style={styles.toolRunLabel} numberOfLines={1}>
              {summaryMembers.map((member, index) => (
                <Text key={`${member.name}:${member.arg}:${index}`}>
                  {/* A real space, not a gap: a gap is invisible to a copied
                      selection and to the row's accessible name, which would
                      otherwise run one member's argument into the next name. */}
                  {index > 0 ? '   ' : null}
                  <Text testID="tool-run-member-name" style={styles.toolRunMemberName}>
                    {member.name}
                  </Text>
                  {member.arg ? (
                    <Text style={styles.toolRunMemberArg}>{` ${member.arg}`}</Text>
                  ) : null}
                </Text>
              ))}
            </Text>
          ) : (
            <Text style={styles.toolRunLabel} numberOfLines={1}>
              {formatToolCallCount(callCount)}
            </Text>
          )}
          {hiddenCallCount > 0 ? (
            // Outside the truncating label, so the count of what the header did
            // not name survives a phone too narrow to print the list.
            <Text style={styles.toolRunMore}>
              {NATIVE_CHAT_TOOL_ACTIVITY_COPY.moreCalls.replaceAll(
                '{{value0}}',
                String(hiddenCallCount)
              )}
            </Text>
          ) : null}
          {open ? (
            <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} />
          ) : (
            <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
          )}
        </Pressable>
        {trailing}
      </View>
      {open ? renderBody() : null}
    </View>
  )

  function renderBody(): React.JSX.Element {
    return (
      <View style={styles.toolRunBody}>
        {pairs.map((pair, i) => (
          <ToolLine
            key={i}
            pair={pair}
            taskList={taskLists[i] ?? null}
            defaultExpanded={expandChildren ?? defaultExpanded}
            diffLineLimit={diffLineLimit}
            onOpenFile={onOpenFile}
            styles={styles}
          />
        ))}
        {callCount > pairs.length ? (
          <Text style={styles.toolPreview}>… {callCount - pairs.length} more tool calls</Text>
        ) : null}
      </View>
    )
  }
}
