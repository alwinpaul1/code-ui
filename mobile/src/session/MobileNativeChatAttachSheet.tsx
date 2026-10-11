import { Camera, Image as ImageIcon, Paperclip, Zap, ChevronRight } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import type { LucideIcon } from 'lucide-react-native'
import {
  CODEX_AGENT_MODES,
  permissionModeLabel,
  type TerminalAgentMode,
  type TerminalPermissionMode
} from './mobile-terminal-hud-parse'

/** The mode row's title, caption and label. A Codex tab (agentMode set) names
 *  its own Plan/Default mode: Codex has no permission mode, and its footer
 *  parse fills one with 'default', which read "Permission: Manual" over a
 *  session in Plan mode (review, 2026-09-30). With no mode read the caption
 *  says so, never a mode name: this said 'Auto', a real and riskier mode,
 *  whenever the mode was null (review, 2026-09-30). The row still opens the
 *  sheet to pick one. */
function modeRowText(
  agentMode: TerminalAgentMode | null,
  permissionMode: TerminalPermissionMode | null
): { title: string; caption: string; label: string } {
  if (agentMode) {
    const caption = CODEX_AGENT_MODES.find((mode) => mode.id === agentMode)?.label ?? 'Not known yet'
    return { title: 'Mode', caption, label: 'Mode' }
  }
  return {
    title: 'Permission',
    caption: permissionMode ? permissionModeLabel(permissionMode) : 'Not known yet',
    label: 'Permission mode'
  }
}

/** The Claude-app "Add context" sheet: one horizontal row of source cards
 *  (camera, photos, files) with no descriptions, over a permission row.
 *  Requested from the phone 2026-09-14 with a screenshot; replaces the older
 *  vertical list, and drops the "Paste image" row — a screenshot is reached
 *  through Photos, and the composer surfaces a clipboard image on its own. */
export function MobileNativeChatAttachSheet({
  visible,
  onClose,
  onCaptureImage,
  onAttachImage,
  onAttachFile,
  permissionMode,
  agentMode = null,
  onOpenPermission
}: {
  visible: boolean
  onClose: () => void
  onCaptureImage?: () => void
  onAttachImage?: () => void
  onAttachFile?: () => void
  permissionMode?: TerminalPermissionMode | null
  /** Set only on a Codex tab. */
  agentMode?: TerminalAgentMode | null
  onOpenPermission?: () => void
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  const modeRow = modeRowText(agentMode, permissionMode ?? null)
  const cards: { key: string; label: string; icon: LucideIcon; onPress?: () => void }[] = [
    { key: 'camera', label: 'Camera', icon: Camera, onPress: onCaptureImage },
    { key: 'photos', label: 'Photos', icon: ImageIcon, onPress: onAttachImage },
    { key: 'files', label: 'Files', icon: Paperclip, onPress: onAttachFile }
  ]
  // A source card's work starts once the sheet has gone, never while it closes.
  // Each card launches a system picker, which is an Activity: it pauses this
  // one, and Reanimated stops driving frames on a host pause, so the 150 ms exit
  // froze where its first frames left it. Android's photo picker is a sheet
  // over the app, so the half-closed + sheet and its dimmed backdrop stayed in
  // sight behind it, and back from the pick the exit's end reached JS behind
  // the photo's chip and its read, leaving the sheet's window up over the chat
  // (reported 2026-10-11: "closes stuck after attaching media especially
  // images"). The press is held here and run from `onAfterClose`, after the
  // unmount has committed, so the picker, the chip and the upload all come
  // after the sheet. The cost is the exit itself before the picker opens.
  const pendingPressRef = useRef<(() => void) | null>(null)
  // A sheet opened again before its exit finished (the + tapped again) never
  // unmounts, so the held press would run on some later close instead: the
  // user took it back by reopening.
  useEffect(() => {
    if (visible) {
      pendingPressRef.current = null
    }
  }, [visible])
  const runAfterClose = (press?: () => void) => () => {
    pendingPressRef.current = press ?? null
    onClose()
  }
  const runAfterClosed = (): void => {
    const press = pendingPressRef.current
    pendingPressRef.current = null
    press?.()
  }
  return (
    <BottomDrawer visible={visible} onClose={onClose} onAfterClose={runAfterClosed}>
      <Txt
        variant="label"
        weight="semibold"
        align="center"
        style={{ paddingBottom: space.md }}
      >
        Add context
      </Txt>
      <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md }}>
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Pressable
              key={card.key}
              accessibilityRole="button"
              accessibilityLabel={card.label}
              disabled={!card.onPress}
              onPress={runAfterClose(card.onPress)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 96,
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.sm,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.bgRaised : colors.bgPanel,
                opacity: card.onPress ? 1 : 0.4
              })}
            >
              <Icon size={24} color={colors.text} strokeWidth={1.8} />
              <Txt variant="label" weight="semibold">
                {card.label}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      {onOpenPermission ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={modeRow.label}
          // Another sheet, not an Activity: it opens beside this one's exit.
          onPress={() => {
            onClose()
            onOpenPermission()
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            marginTop: space.md,
            marginHorizontal: space.md,
            padding: space.md,
            borderRadius: radius.lg,
            backgroundColor: pressed ? colors.bgRaised : colors.bgPanel
          })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.bgRaised
            }}
          >
            <Zap size={18} color={colors.text} strokeWidth={1.8} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="label" weight="semibold">
              {modeRow.title}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {modeRow.caption}
            </Txt>
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </BottomDrawer>
  )
}
