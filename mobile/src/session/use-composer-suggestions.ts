import { useEffect, useMemo, useState } from 'react'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { detectAutocompleteTrigger, rankSuggestions } from './mobile-native-chat-autocomplete'
import { mobileNativeChatSlashSuggestions } from './mobile-native-chat-session-catalog'
import type { ComposerSuggestion } from './MobileNativeChatComposerSuggestions'
import { useSuggestionPopoverMaxHeight } from './mobile-native-chat-suggestion-popover'

/**
 * The composer's autocomplete: the trigger under the caret, the rows for it,
 * the loads it asks for, and how tall the popover may be. Lifted out of the
 * composer whole so that file only threads it (2026-09-20).
 */
export function useComposerSuggestions(args: {
  value: string
  cursor: number
  agent: string | null
  skills: readonly DiscoveredSkill[]
  sessionCommands?: readonly AgentSessionSlashCommand[]
  conversationCommands?: readonly AgentSessionConversationCommand[]
  filePaths: readonly string[]
  onNeedFiles?: (query: string) => void
  onNeedSkills?: () => void
  popoverSpace: number
  dockHeight: number
  /** The composer's field has focus. Leaving it with the menu up closes the
   *  menu for that token, as a tap outside does in the Claude app. */
  focused?: boolean
}) {
  const {
    value,
    cursor,
    agent,
    skills,
    sessionCommands,
    conversationCommands,
    filePaths,
    onNeedFiles,
    onNeedSkills,
    popoverSpace,
    dockHeight,
    focused = true
  } = args
  const typed = useMemo(() => detectAutocompleteTrigger(value, cursor), [value, cursor])
  // Claude Android 1.261009.20: a tap outside the `/` menu closes it for the
  // token it was showing, and it stays shut until that token is gone (a space,
  // the caret leaving it) or another one opens. Here "outside" is the field
  // losing focus with the menu up; the rows are not focusable, so a pick never
  // counts. Keyed on where the token starts and what opened it, which is what
  // tells one token from the next.
  const typedKey = typed ? `${typed.kind}:${typed.start}` : null
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [wasFocused, setWasFocused] = useState(focused)
  if (wasFocused !== focused) {
    setWasFocused(focused)
    if (!focused && typedKey !== null) {
      setDismissedKey(typedKey)
    }
  }
  if (dismissedKey !== null && dismissedKey !== typedKey) {
    setDismissedKey(null)
  }
  const trigger = typed !== null && typedKey !== dismissedKey ? typed : null
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!trigger) {
      return []
    }
    if (trigger.kind === 'slash') {
      return mobileNativeChatSlashSuggestions({
        agent,
        scannedSkills: skills,
        sessionCommands,
        conversationCommands,
        query: trigger.query
      })
    }
    return rankSuggestions(filePaths, trigger.query).map((path) => ({
      kind: 'file' as const,
      path
    }))
  }, [trigger, filePaths, agent, skills, sessionCommands, conversationCommands])

  useEffect(() => {
    if (trigger?.kind === 'file') {
      onNeedFiles?.(trigger.query)
    }
  }, [onNeedFiles, trigger?.kind, trigger?.query])

  useEffect(() => {
    if (trigger?.kind === 'slash') {
      onNeedSkills?.()
    }
  }, [onNeedSkills, trigger?.kind])

  const { maxHeight: popoverMaxHeight, onPopoverLayout } = useSuggestionPopoverMaxHeight(
    suggestions.length,
    popoverSpace,
    dockHeight
  )
  return { trigger, suggestions, popoverMaxHeight, onPopoverLayout }
}
