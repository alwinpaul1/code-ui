import { Pressable, ScrollView, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { QueueEditorAgent } from './use-mobile-native-chat-queue-editor'
import type { TerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'

/** Deliberately explicit keystrokes in the visible native editor. Taking back a
 * queue is agent-specific; clearing/replaying preview text would lose payloads. */
export function MobileNativeQueueEditorControls({
  agent,
  enabled,
  onKey,
  onClose
}: {
  agent: QueueEditorAgent
  enabled: boolean
  onKey: (input: TerminalLiveAccessoryInput) => void
  onClose: () => void
}) {
  const { colors, space, radius } = useTheme()
  const codex = agent === 'codex'
  const keys = [
    { label: codex ? 'Alt+↑' : '↑', bytes: codex ? '\x1b[1;3A' : '\x1b[A' },
    { label: 'Ctrl+U', bytes: '\x15' },
    { label: '⌫', bytes: '\x7f', localEdit: 'backspace' as const },
    { label: codex ? 'Tab' : 'Enter', bytes: codex ? '\t' : '\r' }
  ]
  return (
    <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt weight="semibold">{codex ? 'Edit latest queued message' : 'Edit queued messages'}</Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          onPress={onClose}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
        >
          <Txt tone="secondary">Done</Txt>
        </Pressable>
      </View>
      <Txt variant="caption" tone="secondary">
        {codex
          ? 'With an empty input, Alt+↑ takes back the latest queued message. Edit it, then Tab to queue it again. Delete the recalled text and attachments to cancel it.'
          : 'From the first input line, ↑ opens the agent’s queue controls. Follow its hint to select a message and Enter to edit. Older versions recall the whole queue together. Delete recalled text and attachments to cancel; Enter queues the edited input.'}
      </Txt>
      <Txt variant="caption" tone="secondary">
        Ctrl+U clears before the cursor on this line. Use the shortcut shown by your agent if
        customized. Done only returns to chat.
      </Txt>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ gap: space.sm }}
      >
        {keys.map(({ label, ...input }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`Send ${label}`}
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            onPress={() => onKey(input)}
            style={{
              minHeight: 44,
              minWidth: 52,
              paddingHorizontal: space.md,
              borderRadius: radius.sm,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: colors.bgRaised,
              opacity: enabled ? 1 : 0.4
            }}
          >
            <Txt>{label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
