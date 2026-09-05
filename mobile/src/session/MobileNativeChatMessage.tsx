import { memo, useEffect, useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  Sparkles
} from 'lucide-react-native'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import { isImageRefBlock, isTextBlock } from '../../../src/shared/native-chat-types'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import {
  TEXT_SIZE,
  useChatMessageStyles,
  type ChatMessageStyles
} from './mobile-native-chat-message-styles'
import { nativeChatMessageText } from './mobile-native-chat-message-text'
import { ToolRun } from './MobileNativeChatToolRun'

/** Collapsed reasoning shows this many characters of its first line. */
const REASONING_PREVIEW_CHARS = 96

function Prose({
  block,
  invert,
  fontScale,
  onOpenFile,
  styles
}: {
  block: NativeChatBlock
  invert?: boolean
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  if (isTextBlock(block)) {
    if (invert) {
      return (
        <Text
          style={[
            styles.userText,
            { fontSize: TEXT_SIZE * fontScale, lineHeight: (TEXT_SIZE + 7) * fontScale }
          ]}
        >
          {block.text}
        </Text>
      )
    }
    return <MobileMarkdown content={block.text} textScale={fontScale} onOpenFile={onOpenFile} />
  }
  if (isImageRefBlock(block)) {
    // A local preview (composer echo) or real URL renders as a thumbnail; a bare
    // host path (not loadable on the device) falls back to a text placeholder.
    const uri = block.url ?? block.path
    if (isRenderableImageUri(uri)) {
      // Why tappable: the host path (desktop paste or the phone's own upload)
      // opens through the same file-preview route a tapped path uses, full size.
      const hostPath = block.path
      return (
        <Pressable
          onPress={hostPath && onOpenFile ? () => onOpenFile(hostPath) : undefined}
          accessibilityRole={hostPath && onOpenFile ? 'imagebutton' : 'image'}
        >
          <Image
            source={{ uri }}
            style={styles.imageThumb}
            resizeMode="contain"
            accessibilityLabel={block.alt ?? 'Attached image'}
          />
        </Pressable>
      )
    }
    // Not loadable (yet): a compact chip instead of the raw host path. Tapping
    // still asks the host for the file through the preview route.
    const hostPath = block.path
    return (
      <Pressable
        onPress={hostPath && onOpenFile ? () => onOpenFile(hostPath) : undefined}
        accessibilityRole="button"
        accessibilityLabel={block.alt ?? 'Attached image'}
        style={styles.imageChip}
      >
        <ImageIcon size={14} color={styles.imageRef.color as string} strokeWidth={2} />
        <Text style={[styles.imageRef, { fontSize: (TEXT_SIZE - 2) * fontScale }]}>Image</Text>
      </Pressable>
    )
  }
  return null
}

/** Subtle controls for an agent message: copy its prose, or scroll so this
 *  message's top aligns to the top of the viewport. */
function AgentControls({
  onCopy,
  onScrollToTop,
  styles
}: {
  onCopy: () => void
  onScrollToTop?: () => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.controls}>
      <Pressable
        style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        onPress={onCopy}
        hitSlop={8}
        accessibilityLabel="Copy message"
      >
        <Copy size={14} color={colors.textMuted} strokeWidth={2} />
      </Pressable>
      {onScrollToTop ? (
        <Pressable
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          onPress={onScrollToTop}
          hitSlop={8}
          accessibilityLabel="Scroll this message to top"
        >
          <ArrowUp size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Reasoning turns fold into a "Thinking" disclosure so a long think-aloud does
 *  not swamp the transcript (#17579). Collapsed shows one preview line. */
function ReasoningDisclosure({
  message,
  fontScale,
  onOpenFile,
  styles
}: {
  message: NativeChatMessage
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const text = nativeChatMessageText(message.blocks)
  const preview =
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  const truncated =
    preview.length > REASONING_PREVIEW_CHARS
      ? `${preview.slice(0, REASONING_PREVIEW_CHARS).trimEnd()}…`
      : preview
  return (
    <View style={styles.reasoning}>
      <Pressable
        style={styles.reasoningHeader}
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide thinking' : 'Show thinking'}
      >
        <Sparkles size={13} color={colors.textMuted} strokeWidth={2} />
        <Txt variant="caption" weight="semibold" tone="muted">
          Thinking
        </Txt>
        {open ? (
          <ChevronDown size={13} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <ChevronRight size={13} color={colors.textMuted} strokeWidth={2} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.reasoningBody}>
          <MobileMarkdown content={text} textScale={fontScale * 0.93} onOpenFile={onOpenFile} />
        </View>
      ) : truncated ? (
        <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {truncated}
        </Txt>
      ) : null}
    </View>
  )
}

function MobileNativeChatMessageImpl({
  message,
  toolsExpanded = false,
  fontScale = 1,
  messageIndex,
  onScrollToMessage,
  onOpenFile,
  onCancelQueued
}: {
  message: NativeChatMessage
  toolsExpanded?: boolean
  /** Present while this optimistic echo is still queued behind a running turn. */
  onCancelQueued?: () => void
  /** Multiplies all chat text sizes for pinch-to-zoom (1 = no change). */
  fontScale?: number
  /** This message's index in the list, paired with onScrollToMessage. */
  messageIndex?: number
  /** Ask the list to align this message's top to the top of the viewport. */
  onScrollToMessage?: (index: number) => void
  onOpenFile?: (relativePath: string) => void
}) {
  const styles = useChatMessageStyles()
  const isUser = message.role === 'user'
  const isReasoning = message.role === 'reasoning'
  const isAgent = !isUser
  // Briefly tint the bubble to confirm a copy landed.
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
    },
    []
  )

  if (isReasoning) {
    return (
      <View style={styles.row}>
        <ReasoningDisclosure
          message={message}
          fontScale={fontScale}
          onOpenFile={onOpenFile}
          styles={styles}
        />
      </View>
    )
  }

  // Separate the agent's words from its tool activity: prose renders first, the
  // tool calls fold into a collapsible run beneath. The user's own messages get
  // a soft bubble so they stand apart from agent prose.
  const { prose, tools } = splitNativeChatBlocks(message.blocks)

  const handleCopy = (): void => {
    const text = nativeChatMessageText(message.blocks)
    if (!text) {
      return
    }
    void Clipboard.setStringAsync(text)
    setCopied(true)
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
    }
    copyTimer.current = setTimeout(() => setCopied(false), 700)
  }

  const controls = isAgent ? (
    <AgentControls
      onCopy={handleCopy}
      onScrollToTop={
        onScrollToMessage && messageIndex !== undefined
          ? () => onScrollToMessage(messageIndex)
          : undefined
      }
      styles={styles}
    />
  ) : null

  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <View style={[styles.content, isUser && styles.userBubble, copied && styles.copied]}>
        {prose.map((block, index) => (
          <Prose
            key={index}
            block={block}
            invert={isUser}
            fontScale={fontScale}
            onOpenFile={onOpenFile}
            styles={styles}
          />
        ))}
        {tools.length > 0 ? (
          <ToolRun
            // Why: a global toggle intentionally resets all per-run/per-line
            // overrides in one remount, avoiding an effect-driven second render.
            key={toolsExpanded ? 'expanded' : 'collapsed'}
            blocks={tools}
            defaultExpanded={toolsExpanded}
            trailing={controls}
            onOpenFile={onOpenFile}
            styles={styles}
          />
        ) : onCancelQueued ? (
          <View style={styles.controlsRow}>
            <Txt variant="caption" tone="inverse" style={{ opacity: 0.7 }}>
              Queued
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel queued message"
              hitSlop={8}
              onPress={onCancelQueued}
              style={({ pressed }) => ({ marginLeft: 12, opacity: pressed ? 0.5 : 1 })}
            >
              <Txt variant="caption" weight="semibold" tone="danger">
                Cancel
              </Txt>
            </Pressable>
          </View>
        ) : controls ? (
          <View style={styles.controlsRow}>{controls}</View>
        ) : null}
      </View>
    </View>
  )
}

export const MobileNativeChatMessage = memo(MobileNativeChatMessageImpl)
