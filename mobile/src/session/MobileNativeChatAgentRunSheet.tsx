import { Pressable, Text, View } from 'react-native'
import { ListTodo } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { NativeChatAgentRunEntry } from './mobile-native-chat-agent-run'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'

/** "Ran 5 agents" and one row per agent, joined by a thin line, as the Claude
 *  app draws the sheet behind its "Running agent" row (2026-09-24). A row
 *  opens that agent's transcript where the phone knows which one is its. */
export function MobileNativeChatAgentRunSheet({
  visible,
  entries,
  running,
  onOpenTranscript,
  onClose
}: {
  visible: boolean
  entries: readonly NativeChatAgentRunEntry[]
  running: boolean
  onOpenTranscript?: (agentId: string, title: string, running: boolean) => void
  onClose: () => void
}) {
  const { colors, fonts, space, type } = useTheme()
  const title = `Ran ${entries.length} agent${entries.length === 1 ? '' : 's'}`
  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: space.md }} testID="agent-run-sheet">
        <MobileSheetTitleBar title={title} onClose={onClose} />
        {entries.map((entry, index) => {
          const agentId = entry.agentId
          const open =
            agentId && onOpenTranscript ? () => onOpenTranscript(agentId, entry.title, running) : undefined
          return (
            <View key={index}>
              <Pressable
                accessibilityRole={open ? 'button' : undefined}
                accessibilityLabel={`Ran agent ${entry.title}`}
                accessibilityHint={open ? 'Shows what this agent did' : undefined}
                onPress={open}
                disabled={!open}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  minHeight: 44,
                  opacity: pressed ? 0.6 : 1
                })}
              >
                <ListTodo size={18} color={colors.textMuted} />
                <Text
                  style={{ flex: 1, fontFamily: fonts.regular, fontSize: type.body.size, color: colors.textSecondary }}
                  numberOfLines={1}
                >
                  <Text style={{ fontFamily: fonts.medium, color: colors.text }}>Ran agent</Text>
                  {`  ${entry.title}`}
                </Text>
              </Pressable>
              {index < entries.length - 1 ? (
                <View style={{ width: 1, height: 10, marginLeft: 8.5, backgroundColor: colors.border }} />
              ) : null}
            </View>
          )
        })}
        {entries.length === 0 ? (
          <Txt variant="caption" tone="muted">
            No agents in this run.
          </Txt>
        ) : null}
      </View>
    </BottomDrawer>
  )
}
