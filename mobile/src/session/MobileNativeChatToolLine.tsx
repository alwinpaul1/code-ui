import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { diffFromText, diffFromToolCall } from '../../../src/shared/native-chat-diff'
import { isEditToolName } from '../../../src/shared/native-chat-edit-normalize'
import type { NativeChatToolPair as ToolPair } from '../../../src/shared/native-chat-tool-fold'
import { createToolInputDisplay } from '../../../src/shared/native-chat-tool-summary'
import { cutWholeCharacters } from '../text/whole-character-cut'
import { useTheme } from '../theme/theme-context'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatTaskList } from './MobileNativeChatTaskList'
import { mobileTaskListPreview, type MobileTaskListRow } from './mobile-native-chat-task-list-rows'
import { toolPairOpensDetailSheet } from './mobile-native-chat-tool-detail'
import { editFilesForToolCall, type VerifiedCreateCount } from './mobile-native-chat-tool-run-diff-stat'
import { ToolExecutionMeta, ToolRowName, ToolSearchResults } from './MobileNativeChatToolAnnotations'
import { DiffView, ResultBody } from './MobileNativeChatToolRunBodyParts'

/** The files one edit call changed, or null when the model refuses to claim an
 *  edit — a failed call, one still running, or a turn that stopped before its
 *  call was answered. Those keep the generic tool view and its error body. A
 *  file the wire cut arrives `truncated`, the same answer the run's chip gets. */
function editFilesForPair(pair: ToolPair) {
  const files = pair.call ? editFilesForToolCall(pair.call, pair.result ?? null) : null
  return files && files.length > 0 ? files : null
}

/** One request: a tool call and its result rendered together as a single
 *  expandable line. `defaultExpanded` lets the group toggle open every line. */
export function ToolLine({
  pair,
  taskList,
  defaultExpanded,
  diffLineLimit,
  onOpenFile,
  onOpenDetail,
  onRevertHunk,
  revertScope,
  createdFileCount,
  styles
}: {
  pair: ToolPair
  /** Set when this pair is the agent revising its plan, in which case the
   *  checklist speaks for the call AND its result. */
  taskList: MobileTaskListRow | null
  defaultExpanded: boolean
  diffLineLimit: number
  onOpenFile?: (relativePath: string) => void
  /** Opens the Claude-app-style detail sheet for this call instead of the
   *  inline expand, for every row that has no richer inline card of its own
   *  (a plan checklist, an edit's diff card, a web search's result list). */
  onOpenDetail: (pair: ToolPair) => void
  onRevertHunk?: MobileNativeChatRevertHunk
  /** This line's place in its message, for the diff card's identity. */
  revertScope?: string
  /** The run's read-back counts of the created files the wire cut. */
  createdFileCount?: VerifiedCreateCount
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
  // A result with no call previews its first line, never cut through an emoji.
  const preview = taskList
    ? mobileTaskListPreview(taskList.list)
    : (inputDisplay?.label ?? cutWholeCharacters(result?.output.split('\n')[0] ?? '', 80))
  // Why: collapsed tool rows are the common path; defer bounded diff parsing
  // and detail formatting until the user asks to reveal the detail.
  // An edit renders as one card per file it changed, which speaks for the call
  // AND its result — the raw flat diff and the result body are suppressed, so
  // one turn never shows two presentations of the same change.
  const editFiles =
    !taskList && expanded && call && isEditToolName(call.name) ? editFilesForPair(pair) : null
  const rendered = editFiles !== null || taskList !== null
  // A created file the wire cut keeps its cut rows and "Diff truncated", with
  // the count read back from the file beside them once the file proved it.
  const verifiedAdded =
    call && editFiles?.length === 1
      ? (createdFileCount?.(call, result ?? null) ?? undefined)
      : undefined
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
  // A row with no richer inline card (a plan checklist, an edit's diff card, a
  // web search's result list) opens the Claude-app detail sheet instead of
  // expanding in place — the sheet is where its inputs/output now live, so it
  // never shows both. Because of that, the global "expand all tools" toggle
  // has nothing to expand on these rows: there is no inline detail left to
  // reveal, only a sheet, and opening N sheets at once for one tap makes no
  // sense.
  const opensSheet = toolPairOpensDetailSheet(pair, { isTaskList: taskList !== null })
  // The group toggle opens every line at once, bypassing the tap guard, so the
  // panel has to consult it too — else a detail-less row echoes its own label
  // under itself and no tap can dismiss it.
  const showDetail = !opensSheet && hasDetail && expanded
  const filePath = inputDisplay?.filePath ?? null
  const openable = filePath !== null && onOpenFile !== undefined
  return (
    <View>
      <Pressable
        testID="tool-line"
        style={styles.toolLine}
        onPress={() => {
          if (opensSheet) {
            onOpenDetail(pair)
            return
          }
          if (hasDetail) {
            setExpanded((v) => !v)
          }
        }}
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
              onRevertHunk={onRevertHunk}
              revertScope={`${revertScope ?? ''}:${index}`}
              onOpenFile={onOpenFile}
              verifiedAdded={verifiedAdded}
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
