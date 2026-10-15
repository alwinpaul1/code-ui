import { useEffect, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

/**
 * The Claude app's one-time notice that Auto is now Claude Code's default permission mode
 * (1.261013.20: jv30.java:75, `ccr_auto_default_notice_title` / `_body` / `_ok` "Got it",
 * h5n.java:194). The app shows it when a session is put in Auto by that default and the
 * install has not seen it (`auto_default_notice_seen`, mr8.java:45), and keeps the dismissal on
 * the device. Code UI launches Claude in Auto (claude-auto-permission-mode.ts), so it shows it on
 * a Claude tab matched to its Anthropic session whose mode is Auto, once per install. Nothing is
 * written to the desktop.
 *
 * Failure: a store that cannot be read shows nothing (an informational notice is not worth
 * nagging over on every launch), and says why in the log; a dismissal that cannot be written
 * still closes it for this launch and may come back on the next.
 */

export const AUTO_DEFAULT_NOTICE_TITLE = 'Auto mode is now Claude Code’s default permission mode'
export const AUTO_DEFAULT_NOTICE_BODY =
  'Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.'
const SEEN_KEY = 'orca:autoDefaultNoticeSeen'

/** Null until the store was read this launch. */
let seen: boolean | null = null
let reading = false
const listeners = new Set<() => void>()

function setSeen(value: boolean): void {
  seen = value
  listeners.forEach((listener) => listener())
}

function readOnce(): void {
  if (seen !== null || reading) {
    return
  }
  reading = true
  AsyncStorage.getItem(SEEN_KEY).then(
    (value) => setSeen(value === 'true'),
    (error: unknown) => {
      console.warn(`[auto-default-notice] could not read whether it was seen, not showing it: ${error instanceof Error ? error.message : String(error)}`)
      setSeen(true)
    }
  )
}

function dismiss(): void {
  setSeen(true)
  AsyncStorage.setItem(SEEN_KEY, 'true').catch((error: unknown) => {
    console.warn(`[auto-default-notice] could not store the dismissal; it may show again next launch: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => seen

/** A Claude chat matched to its Anthropic session (never Codex: no match is made for it), in Auto. */
export function claudeAutoDefaultNoticeEligible(chat: Pick<MobileNativeChatController, 'showNativeChat' | 'nativeChatAnthropicGate' | 'nativeChatPermissionMode'>): boolean {
  return chat.showNativeChat && chat.nativeChatAnthropicGate?.kind === 'matched' && chat.nativeChatPermissionMode === 'auto'
}

export function resetAutoDefaultNoticeForTests(): void {
  seen = null
  reading = false
}

export function MobileClaudeAutoDefaultNotice({ eligible }: { eligible: boolean }): React.JSX.Element | null {
  const { space } = useTheme()
  const known = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (eligible) {
      readOnce()
    }
  }, [eligible])
  if (!eligible || known !== false) {
    return null
  }
  return (
    <BottomDrawer visible onClose={dismiss}>
      <View style={{ paddingBottom: space.lg, paddingHorizontal: space.xs }} testID="auto-default-notice">
        <Txt variant="heading" weight="semibold">
          {AUTO_DEFAULT_NOTICE_TITLE}
        </Txt>
        <Txt variant="body" tone="secondary" style={{ marginTop: space.xs }}>
          {AUTO_DEFAULT_NOTICE_BODY}
        </Txt>
      </View>
      <Button label="Got it" variant="primary" onPress={dismiss} />
    </BottomDrawer>
  )
}
