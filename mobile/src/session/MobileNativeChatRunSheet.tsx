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
      <View style={{ paddingBottom: space.md }} testID="run-sheet">
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

function RowConnector() {
  const { colors } = useTheme()
  return <View style={{ width: 1, height: 10, marginLeft: 8.5, backgroundColor: colors.border }} />
}

/** Between two rows: a row 34 plus this 10 is the Claude app's 44 dp pitch
 *  (114 px at 2.57 px/dp, 2026-10-09 screenshots); ours was 56. A row stays
 *  tappable at 44 through the slop its hit area gets above and below. */
const ROW_HEIGHT = 34
const ROW_HIT_SLOP = { top: 5, bottom: 5 } as const

function RunSheetRowView({ row, onPress }: { row: RunSheetRow; onPress: () => void }) {
  const { colors, fonts, space, type } = useTheme()
  const Icon = row.glyph === 'toolbox' ? Briefcase : ICON_BY_KIND[row.kind]
  // About 15% under the body size the rows had, the label step of the scale.
  const size = type.label.size
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
        gap: space.md,
        minHeight: ROW_HEIGHT,
        opacity: pressed ? 0.6 : 1
      })}
    >
      <Icon size={18} color={colors.textMuted} />
      {row.failed ? <TriangleAlert size={16} color={colors.danger} testID="run-sheet-row-failed" /> : null}
      <Text
        style={{ flexShrink: 1, fontFamily: fonts.regular, fontSize: size, color: colors.textSecondary }}
        numberOfLines={1}
      >
        <Text style={{ fontFamily: fonts.medium, color: verbColor }}>{row.verb}</Text>
        {row.detail ? (
          <Text
            style={[
              row.detailIsKey ? { color: colors.textMuted } : undefined,
              row.detailMono ? { fontFamily: fonts.mono, fontSize: type.mono.size } : undefined
            ]}
          >{`  ${row.detail}`}</Text>
        ) : null}
      </Text>
      {row.diff ? <DiffPill stat={row.diff} fontFamily={fonts.mono} fontSize={type.caption.size} /> : null}
    </Pressable>
  )
}
