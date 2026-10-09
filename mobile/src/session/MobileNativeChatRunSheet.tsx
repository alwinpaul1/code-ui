import { Pressable, Text, View } from 'react-native'
import {
  Briefcase,
  Eye,
  FileText,
  Globe,
  ListTodo,
  MessageSquare,
  Search,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  type LucideIcon
} from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { RunSheetRow } from './mobile-native-chat-run-sheet-rows'
import { DiffPill } from './MobileNativeChatToolRunDiffChip'
import type { ToolRunKind } from './mobile-native-chat-tool-kind'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

const ICON_BY_KIND: Record<ToolRunKind, LucideIcon> = {
  command: SquareTerminal,
  read: Eye,
  edit: FileText,
  search: Search,
  agent: ListTodo,
  web: Globe,
  webSearch: Globe,
  skill: Sparkles,
  message: MessageSquare,
  other: Wrench
}

/**
 * The sheet behind a run's row: every call of the run as icon + verb +
 * description, the way the Claude app draws it (2026-10-01 screenshots; the
 * agent-only form of 2026-09-24). It opens part way and drags up to full
 * screen, like the Background tasks sheet. A row opens that call's detail
 * sheet, or, for an agent whose id the phone knows, that agent's transcript.
 */
export function MobileNativeChatRunSheet({
  visible,
  title,
  rows,
  running,
  onSelectPair,
  onOpenTranscript,
  onAfterClose,
  onClose
}: {
  visible: boolean
  /** The run's past-tense sentence: "Used a tool, ran 3 commands, ran an agent". */
  title: string
  rows: readonly RunSheetRow[]
  /** An agent of the run still runs; handed to its transcript viewer. */
  running: boolean
  onSelectPair: (pair: NativeChatToolPair) => void
  onOpenTranscript?: (agentId: string, title: string, running: boolean) => void
  /** Fires once the sheet has left the screen, which is when a detail sheet
   *  chosen from it may open without the two overlapping. */
  onAfterClose?: () => void
  onClose: () => void
}) {
  const { space } = useTheme()
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={onAfterClose}
      dragContentToDismiss
      dismissKeyboardOnOpen
      expandable
      header={<MobileSheetTitleBar title={title} onClose={onClose} wrap />}
    >
      <View style={{ paddingBottom: space.md, paddingLeft: ROW_ICON_INSET - space.md }} testID="run-sheet">
        {rows.map((row, index) => (
          <View key={index}>
            <RunSheetRowView
              row={row}
              onPress={() => {
                if (row.agentId && onOpenTranscript) {
                  onOpenTranscript(row.agentId, row.detail ?? 'Agent', running)
                } else {
                  onSelectPair(row.pair)
                }
              }}
            />
            {index < rows.length - 1 ? <RowConnector /> : null}
          </View>
        ))}
        {rows.length === 0 ? (
          <Txt variant="caption" tone="muted">
            No tool calls in this run.
          </Txt>
        ) : null}
      </View>
    </BottomDrawer>
  )
}

/** The rows' geometry, measured on the Claude app's sheet (claude-sheet3.png,
 *  2026-10-09, 2.57 px/dp). From the sheet's edge to the icon 27 dp (the drawer
 *  pads its content by `space.md`, the sheet adds the rest); the icon 16 wide;
 *  15 to the verb, 11 from the verb to the detail. Ours had the icon at 15, 18
 *  wide, with 12 between every part. */
const ROW_ICON_INSET = 27
const ROW_ICON_SIZE = 16
const ROW_ICON_TO_VERB = 15
const ROW_VERB_TO_DETAIL = 11
/** The row's words are the transcript's prose size, as the Claude app's are
 *  (its row glyphs measure the same as its transcript text). The label size
 *  (13) these had sat under the 15 prose above the sheet. */
const ROW_TEXT = TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose

function RowConnector() {
  const { colors } = useTheme()
  // A 1 dp line centred under the icon.
  return (
    <View
      style={{ width: 1, height: 10, marginLeft: ROW_ICON_SIZE / 2 - 0.5, backgroundColor: colors.border }}
    />
  )
}

/** Between two rows: a row 34 plus this 10 is the Claude app's 44 dp pitch
 *  (114 px at 2.57 px/dp, 2026-10-09 screenshots); ours was 56. A row stays
 *  tappable at 44 through the slop its hit area gets above and below. */
const ROW_HEIGHT = 34
const ROW_HIT_SLOP = { top: 5, bottom: 5 } as const

function RunSheetRowView({ row, onPress }: { row: RunSheetRow; onPress: () => void }) {
  const { colors, fonts, space, type } = useTheme()
  const Icon = row.glyph === 'toolbox' ? Briefcase : ICON_BY_KIND[row.kind]
  const word = { fontSize: ROW_TEXT.fontSize, lineHeight: ROW_TEXT.lineHeight }
  // The Claude app marks a failed step with a warning triangle after its icon
  // and the verb in the danger colour. The row's spoken label still says it.
  const verbColor = row.failed ? colors.danger : colors.text
  return (
    <Pressable
      accessibilityRole={row.opens ? 'button' : undefined}
      disabled={!row.opens}
      accessibilityLabel={`${row.detail ? `${row.verb} ${row.detail}` : row.verb}${row.failed ? '. Failed' : ''}`}
      accessibilityHint={row.opens ? (row.agentId ? 'Shows what this agent did' : 'Shows this call') : undefined}
      testID="run-sheet-row"
      onPress={row.opens ? onPress : undefined}
      hitSlop={ROW_HIT_SLOP}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: ROW_HEIGHT,
        opacity: pressed ? 0.6 : 1
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Icon size={ROW_ICON_SIZE} color={colors.textMuted} />
        {row.failed ? <TriangleAlert size={ROW_ICON_SIZE} color={colors.danger} testID="run-sheet-row-failed" /> : null}
      </View>
      {/* The verb keeps its width while a detail follows, so a long detail takes
          the ellipsis; with none it is the one text and shrinks itself. */}
      <Text
        style={{
          ...word,
          flexShrink: row.detail ? 0 : 1,
          marginLeft: ROW_ICON_TO_VERB,
          fontFamily: fonts.regular,
          color: verbColor
        }}
        numberOfLines={1}
      >
        {row.verb}
      </Text>
      {row.detail ? (
        <Text
          style={{
            ...word,
            flexShrink: 1,
            marginLeft: ROW_VERB_TO_DETAIL,
            fontFamily: row.detailMono ? fonts.mono : fonts.regular,
            // A file name is code: its own size, not the prose's.
            ...(row.detailMono ? { fontSize: type.mono.size } : null),
            color: colors.textMuted
          }}
          numberOfLines={1}
        >
          {row.detail}
        </Text>
      ) : null}
      {row.diff ? (
        <View style={{ marginLeft: space.sm }}>
          <DiffPill stat={row.diff} fontFamily={fonts.mono} fontSize={type.caption.size} />
        </View>
      ) : null}
    </Pressable>
  )
}
