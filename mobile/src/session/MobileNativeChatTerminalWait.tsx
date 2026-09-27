import { useEffect } from 'react'
import { View } from 'react-native'
import { SquareTerminal } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import type { NativeChatTerminalWait } from './mobile-terminal-permission-options-merge'

export const TERMINAL_WAIT_TITLE = 'Waiting for approval in the terminal'
export const TERMINAL_WAIT_BODY = "This chat can't show the prompt. Answer it in the terminal."

/**
 * The agent waits on a prompt the chat has no card for (a dialog the screen
 * parser refuses, or a hook wait with nothing to read). Said where the card
 * would be, in the dock, so a blocked agent never looks like a busy one: on
 * 2026-09-27 a subagent sat on a prompt for eight hours behind a chat that
 * showed only "1 running task". Nothing here answers the prompt; the one
 * action goes to where it can be answered.
 */
export function MobileNativeChatTerminalWait({
  wait,
  onOpenTerminal
}: {
  wait: NativeChatTerminalWait
  onOpenTerminal?: () => void
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  // The one line this leaves behind names the dialog no card could show, so
  // the next one points at the screen readers. Logged here, where the chat
  // actually falls back, and not in the screen poll: that cannot see the hook
  // card an Edit or MCP prompt gets, and logged every one of them.
  const said = terminalWaitLogLine(wait)
  useEffect(() => {
    console.warn(said)
  }, [said])
  return (
    <View
      testID="native-chat-terminal-wait"
      accessibilityRole="alert"
      style={{
        marginHorizontal: space.md,
        marginVertical: space.sm,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgPanel
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <SquareTerminal size={15} color={colors.accentText} strokeWidth={2.2} />
        <Txt variant="label" weight="semibold" style={{ flex: 1 }}>
          {TERMINAL_WAIT_TITLE}
        </Txt>
      </View>
      <Txt variant="caption" tone="secondary">
        {TERMINAL_WAIT_BODY}
      </Txt>
      {onOpenTerminal ? (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="Open terminal"
          pressedScale={0.98}
          onPress={onOpenTerminal}
          style={{
            minHeight: 48,
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 4,
            justifyContent: 'center',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.text,
            backgroundColor: colors.text
          }}
        >
          <Txt variant="label" weight="semibold" align="center" tone="inverse">
            Open terminal
          </Txt>
        </PressScale>
      ) : null}
    </View>
  )
}

export function terminalWaitLogLine(wait: NativeChatTerminalWait): string {
  return wait.source === 'screen'
    ? `[permission] no card for the dialog on screen (${wait.choices.join(' | ')}); the chat points to the terminal`
    : '[permission] the hook says the agent waits, with no card to show; the chat points to the terminal'
}
