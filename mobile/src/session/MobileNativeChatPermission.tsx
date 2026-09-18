import { memo, useRef, useState } from 'react'
import { splitPermissionDetail } from './mobile-permission-detail'
import { ScrollView, useWindowDimensions, View } from 'react-native'
import { ShieldQuestion } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import { TextInputModal } from '../components/TextInputModal'
import { isClaudePlanFeedbackOptionLabel } from './claude-plan-permission'
import type { MobileChatPermission } from './mobile-native-chat-permission'

// Keep agent-provided choices intact; action surfaces grow with their content.
function MobileNativeChatPermissionImpl({
  permission,
  onRespond,
  onRespondWithComment
}: {
  permission: MobileChatPermission
  onRespond: (send: string) => Promise<boolean>
  /** Rejects a Claude Code plan review with typed feedback in one tap
   *  (option select + comment, sequenced by the caller). Only offered when
   *  set: the structured (native chat) lane has no verified way to carry
   *  this, so it passes nothing and the option falls back to a plain,
   *  comment-less reject — see claude-plan-permission.ts. */
  onRespondWithComment?: (send: string, comment: string) => Promise<boolean>
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  // The card sits in the dock, which the chat list clears; a tall one would push
  // the composer off a short screen, so the reading area gives up space first and
  // the choices keep theirs. Half the window leaves the conversation visible.
  const { height: windowHeight } = useWindowDimensions()
  const readingMaxHeight = Math.max(64, Math.min(132, Math.round(windowHeight * 0.16)))
  // The choices scroll rather than run off the bottom. Capping the reading area
  // alone was not enough: the options are the only thing the user can act on,
  // and a prompt with four long labels still pushed them past the composer.
  const choicesMaxHeight = Math.max(160, Math.round(windowHeight * 0.34))
  // The Claude app offers exactly three: allow once, always for this session,
  // deny. The TUI's "switch to auto mode" is a mode change, not an answer to
  // this prompt. Filtering never leaves nothing to tap: if it would, the agent
  // offered only that, so keep what it gave rather than render a dead card.
  const withoutAutoMode = permission.options.filter(
    (option) => !/^Yes, and switch to auto mode\b/i.test(option.label)
  )
  const choices = withoutAutoMode.length > 0 ? withoutAutoMode : permission.options
  const [accepted, setAccepted] = useState(false)
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null)
  const submitting = submittingIndex !== null
  const submittingRef = useRef(false)
  const [commentTarget, setCommentTarget] = useState<{ send: string; index: number } | null>(null)
  // A `$ ` line is the older shape; the structured lane hands over the TUI's
  // whole prompt body, which needs splitting. See mobile-permission-detail.ts.
  const commandStart = permission.detail?.search(/^\$ /m) ?? -1
  const split =
    commandStart >= 0
      ? {
          // The same boilerplate has to go here too: any summary carrying a
          // `$ ` line took this branch and the auto-mode tip came back with it
          // (2026-09-14 review).
          description:
            splitPermissionDetail(permission.detail?.slice(0, commandStart), undefined)
              .description,
          command: permission.command ?? permission.detail?.slice(commandStart + 2).trim() ?? null
        }
      : splitPermissionDetail(permission.detail, permission.command)
  const description = split.description ?? undefined
  const command = split.command ?? undefined
  const respond = async (send: string, index: number, comment?: string): Promise<void> => {
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmittingIndex(index)
    let sent = false
    try {
      sent = comment !== undefined ? await onRespondWithComment!(send, comment) : await onRespond(send)
      setAccepted(sent)
    } catch {
      setAccepted(false)
    } finally {
      if (!sent) {
        submittingRef.current = false
        setSubmittingIndex(null)
      }
    }
  }
  return (
    <View
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
      accessibilityRole="alert"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ShieldQuestion size={15} color={colors.accentText} strokeWidth={2.2} />
        <Txt variant="label" weight="semibold" style={{ flex: 1 }}>
          {permission.title}
        </Txt>
      </View>
      {description || command ? (
        <ScrollView
          style={{ maxHeight: readingMaxHeight, flexShrink: 1 }}
          nestedScrollEnabled
          contentContainerStyle={{ gap: space.md }}
        >
          {/* The agent's own words about what it wants to do. Prose, so it
              wraps — it went into the command's horizontal scroll for one
              release and a sentence ran off the side with no way back. */}
          {description ? (
            <Txt variant="body" tone="secondary" selectable>
              {description}
            </Txt>
          ) : null}
          {/* The command itself: the Claude app's sunken monospace block, never
              wrapped, scrolling sideways so a long path stays one path. */}
          {command ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              style={{ borderRadius: radius.md, backgroundColor: colors.bgSunken }}
              contentContainerStyle={{ padding: space.md }}
            >
              <Txt variant="mono" selectable>
                {command}
              </Txt>
            </ScrollView>
          ) : null}
        </ScrollView>
      ) : null}
      <ScrollView
        style={{ maxHeight: choicesMaxHeight, flexShrink: 1 }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm }}
      >
        {/* The Claude app offers exactly three: allow once, always for this
            session, deny. The TUI's "switch to auto mode" is a mode change, not
            an answer to this prompt, and is left out on the user's instruction. */}
        {choices.map((option, index) => {
          const rememberedPrefix = option.label.match(
            /^Yes, and don't ask again for commands that start with\s+(.+)$/is
          )?.[1]
          const rememberedScope = option.label.match(
            /^Yes, and don['’]t ask again for:?\s+(.+)$/is
          )?.[1]
          // Only when the caller wired a way to carry it — see the prop doc.
          const opensCommentSheet =
            onRespondWithComment != null && isClaudePlanFeedbackOptionLabel(option.label)
          const shortLabel =
            rememberedPrefix || rememberedScope
              ? 'Always allow for this session'
              : /^Yes$/i.test(option.label)
                ? 'Allow once'
                : /^No$/i.test(option.label)
                  ? 'Deny'
                  : opensCommentSheet
                    ? 'Send back'
                    : option.label
          return (
            <View key={`${option.send}:${option.label}`} style={{ gap: space.sm }}>
              {submittingIndex === index ? (
                <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
                  {accepted ? 'Response sent · waiting for agent' : 'Sending response…'}
                </Txt>
              ) : null}
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ disabled: submitting, busy: submittingIndex === index }}
                pressedScale={0.98}
                disabled={submitting}
                onPress={() =>
                  opensCommentSheet
                    ? setCommentTarget({ send: option.send, index })
                    : void respond(option.send, index)
                }
                style={{
                  minHeight: 48,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm + 4,
                  gap: space.sm,
                  justifyContent: 'center',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: index === 0 ? colors.text : colors.border,
                  backgroundColor: index === 0 ? colors.text : 'transparent',
                  opacity: submitting ? 0.55 : 1
                }}
              >
                <Txt
                  variant="label"
                  weight="semibold"
                  align="center"
                  tone={index === 0 ? 'inverse' : 'primary'}
                >
                  {shortLabel}
                </Txt>
              </PressScale>
            </View>
          )
        })}
      </ScrollView>
      {/* A true native Modal (mounted-bottom-drawer.tsx) — nesting it here
          costs nothing layout-wise and keeps its open/close state scoped to
          this one card. */}
      <TextInputModal
        visible={commentTarget != null}
        title="Tell Claude what to change"
        placeholder="What should Claude do differently?"
        submitLabel="Send back"
        allowEmpty
        onCancel={() => setCommentTarget(null)}
        onSubmit={(comment) => {
          const target = commentTarget
          setCommentTarget(null)
          if (target) {
            void respond(target.send, target.index, comment)
          }
        }}
      />
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)
