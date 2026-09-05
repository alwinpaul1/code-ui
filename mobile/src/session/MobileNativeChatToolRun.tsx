import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight, SquareChevronRight } from 'lucide-react-native'
import { diffFromText, diffFromToolCall } from '../../../src/shared/native-chat-diff'
import type { NativeChatDiffLine as DiffLine } from '../../../src/shared/native-chat-diff'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatToolPair as ToolPair } from '../../../src/shared/native-chat-tool-fold'
import {
  createToolInputDisplay,
  summarizeToolRun,
  truncateToolDetail
} from '../../../src/shared/native-chat-tool-summary'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
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

/** One request: a tool call and its result rendered together as a single
 *  expandable line. `defaultExpanded` lets the group toggle open every line. */
function ToolLine({
  pair,
  defaultExpanded,
  diffLineLimit,
  onOpenFile,
  styles
}: {
  pair: ToolPair
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
  const preview = inputDisplay?.label ?? result?.output.split('\n')[0]?.slice(0, 80) ?? ''
  // Why: collapsed tool rows are the common path; defer bounded diff parsing
  // and detail formatting until the user asks to reveal the detail.
  const callDiff = expanded && call ? diffFromToolCall(call.name, call.input, diffLineLimit) : null
  const resultDiff = expanded && result ? diffFromText(result.output, diffLineLimit) : null
  const callDetail = expanded && inputDisplay && !callDiff ? inputDisplay.formatDetail() : undefined
  const hasDetail = callDiff !== null || result !== undefined || inputDisplay?.hasDetail === true
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
        <Text style={styles.toolName}>{name}</Text>
        {preview ? (
          <Text
            style={[styles.toolPreview, openable && styles.toolPreviewLink]}
            numberOfLines={1}
            onPress={openable ? () => onOpenFile!(filePath!) : undefined}
            suppressHighlighting={!openable}
          >
            {preview}
          </Text>
        ) : null}
      </Pressable>
      {showDetail ? (
        <View style={styles.toolDetail}>
          {callDiff ? <DiffView lines={callDiff} styles={styles} /> : null}
          {callDetail ? <Text style={styles.mono}>{callDetail}</Text> : null}
          {result ? (
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

/** A run of a message's tool calls/results, collapsed to a one-line summary
 *  ("2×  Read src/app.ts · Edit …", Codex-app style) that expands to the inline
 *  tool lines. `defaultExpanded` lets the global toolbar toggle drive every run. */
export function ToolRun({
  blocks,
  defaultExpanded,
  trailing,
  onOpenFile,
  styles
}: {
  blocks: NativeChatBlock[]
  defaultExpanded: boolean
  trailing?: React.ReactNode
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(defaultExpanded)
  const pairs = pairToolBlocks(blocks, MAX_VISIBLE_TOOL_PAIRS)
  const diffLineLimit = Math.max(1, Math.floor(MAX_TOOL_RUN_DIFF_ROWS / (pairs.length * 2 || 1)))
  let callCount = 0
  for (const block of blocks) {
    if (block.type === 'tool-call') {
      callCount++
    }
  }
  callCount ||= pairs.length
  const summary = summarizeToolRun(blocks)
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
          <Text style={styles.toolRunLabel} numberOfLines={1}>
            {summary || `Ran ${callCount} tool ${callCount === 1 ? 'call' : 'calls'}`}
          </Text>
          {open ? (
            <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} />
          ) : (
            <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
          )}
        </Pressable>
        {trailing}
      </View>
      {open ? (
        <View style={styles.toolRunBody}>
          {pairs.map((pair, i) => (
            <ToolLine
              key={i}
              pair={pair}
              defaultExpanded={defaultExpanded}
              diffLineLimit={diffLineLimit}
              onOpenFile={onOpenFile}
              styles={styles}
            />
          ))}
          {callCount > pairs.length ? (
            <Text style={styles.toolPreview}>… {callCount - pairs.length} more tool calls</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
