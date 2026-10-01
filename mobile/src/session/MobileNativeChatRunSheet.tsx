import { Pressable, Text, View } from 'react-native'
import {
  Eye,
  Globe,
  ListTodo,
  MessageSquare,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { RunSheetRow } from './mobile-native-chat-run-sheet-rows'
import type { ToolRunKind } from './mobile-native-chat-tool-kind'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

const ICON_BY_KIND: Record<ToolRunKind, LucideIcon> = {
  command: SquareTerminal,
  read: Eye,
  edit: Pencil,
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
      header={<MobileSheetTitleBar title={title} onClose={onClose} />}
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

function RunSheetRowView({ row, onPress }: { row: RunSheetRow; onPress: () => void }) {
  const { colors, fonts, space, type } = useTheme()
  const Icon = ICON_BY_KIND[row.kind]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.detail ? `${row.verb} ${row.detail}` : row.verb}${row.failed ? '. Failed' : ''}`}
      accessibilityHint={row.agentId ? 'Shows what this agent did' : 'Shows this call'}
      testID="run-sheet-row"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 44,
        opacity: pressed ? 0.6 : 1
      })}
    >
      <Icon size={18} color={colors.textMuted} />
      <Text
        style={{ flex: 1, fontFamily: fonts.regular, fontSize: type.body.size, color: colors.textSecondary }}
        numberOfLines={1}
      >
        <Text style={{ fontFamily: fonts.medium, color: colors.text }}>{row.verb}</Text>
        {row.detail ? (
          <Text style={row.detailIsKey ? { color: colors.textMuted } : undefined}>{`  ${row.detail}`}</Text>
        ) : null}
      </Text>
      {row.failed ? (
        <Txt variant="label" tone="danger" testID="run-sheet-row-failed">
          Failed
        </Txt>
      ) : null}
    </Pressable>
  )
}
