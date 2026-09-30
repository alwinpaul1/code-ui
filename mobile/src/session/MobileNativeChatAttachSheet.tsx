import { Camera, Image as ImageIcon, Paperclip, Zap, ChevronRight } from 'lucide-react-native'
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
  const run = (press?: () => void) => () => {
    onClose()
    press?.()
  }
  return (
    <BottomDrawer visible={visible} onClose={onClose}>
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
              onPress={run(card.onPress)}
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
          onPress={run(onOpenPermission)}
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
