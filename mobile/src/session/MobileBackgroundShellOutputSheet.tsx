import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { DraggableDetailSheet } from '../components/DraggableDetailSheet'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask } from './mobile-background-tasks'
import { backgroundTaskKindLabel, backgroundTaskStatusLabel } from './mobile-background-task-labels'
import { capturedShellOutput, type ShellOutputCapture } from './mobile-background-shell-output'
import { capToolDetailOutput } from './mobile-native-chat-tool-detail-sections'
import { SelectableSheetText } from './SelectableSheetText'

/**
 * A finished background shell's output, opened from its row in the Background
 * tasks sheet (the Claude app's "Show output"). What it shows is the agent's
 * own last read of the shell's output file, the only copy of it the phone
 * receives (mobile-background-shell-output.ts).
 */
export function MobileBackgroundShellOutputSheet({
  task,
  messages,
  onClose
}: {
  /** The shell to show, or null when no sheet should be open. */
  task: BackgroundTask | null
  messages: readonly NativeChatMessage[]
  onClose: () => void
}) {
  // Kept through the exit animation, as the tool sheet keeps its pair.
  const [shown, setShown] = useState(task)
  useEffect(() => {
    if (task !== null) {
      setShown(task)
    }
  }, [task])
  const capture = useMemo(() => (shown ? capturedShellOutput(messages, shown.id) : null), [messages, shown])
  return (
    <DraggableDetailSheet
      visible={task !== null}
      onClose={onClose}
      header={
        shown ? (
          <View style={{ gap: 4, paddingHorizontal: 32 }}>
            <Txt variant="title" weight="bold" align="center" numberOfLines={1} accessibilityRole="header">
              {shown.title}
            </Txt>
            <Txt variant="label" tone={shown.status === 'failed' ? 'danger' : 'secondary'} align="center">
              {`${backgroundTaskKindLabel(shown.kind)} · ${backgroundTaskStatusLabel(shown.status)}`}
            </Txt>
          </View>
        ) : null
      }
    >
      {capture ? <BackgroundShellOutputBody capture={capture} /> : null}
    </DraggableDetailSheet>
  )
}

/** The output, or why there is none. Also drawn inside the launching Bash
 *  call's own sheet. */
export function BackgroundShellOutputBody({ capture }: { capture: ShellOutputCapture }) {
  const { colors, radius, space } = useTheme()
  if (capture.kind === 'none') {
    return (
      <View style={{ gap: space.xs }}>
        <Txt variant="body" tone="secondary">
          No output captured
        </Txt>
        <Txt variant="caption" tone="muted">
          The desktop does not share a shell's output file with the phone, and the agent has not read this one itself.
        </Txt>
      </View>
    )
  }
  const { text, hiddenLines } = capToolDetailOutput(capture.text)
  return (
    <View style={{ gap: space.sm }}>
      <View testID="shell-output-box" style={{ backgroundColor: colors.bgSunken, borderRadius: radius.xs, padding: space.lg }}>
        {text.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SelectableSheetText variant="mono" testID="shell-output-text">
              {text}
            </SelectableSheetText>
          </ScrollView>
        ) : (
          <Txt variant="caption" tone="muted">
            The file was empty when the agent read it.
          </Txt>
        )}
      </View>
      {capture.truncated || hiddenLines > 0 ? (
        <Txt variant="caption" tone="muted">
          Output truncated
        </Txt>
      ) : null}
      {capture.whileRunning ? (
        <Txt variant="caption" tone="muted">
          Read while the shell was still running
        </Txt>
      ) : null}
    </View>
  )
}
