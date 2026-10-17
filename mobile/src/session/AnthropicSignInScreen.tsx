import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import {
  accountLabel,
  codeFromCallbackUrl,
  exchangeCode,
  listAccounts,
  prepareLogin,
  type StoredAccount
} from '../dictation/anthropic-auth-store'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  captureClaudeSession,
  claudeSessionOtherAccountMessage,
  clearClaudeCookies,
  wireClaudeSessionSignOut,
  type ClaudeSessionAccount
} from './claude-ai-session'
import { ClaudeCdsGlyph } from './ClaudeCdsGlyph'

wireClaudeSessionSignOut()

/** A signed-in claude.ai page, loaded after the OAuth code so claude.ai sets lastActiveOrg. */
export const CLAUDE_HOME_URL = 'https://claude.ai/new'
/** How often the jar is looked at once the code is exchanged. */
export const ANTHROPIC_SIGN_IN_POLL_MS = 1000
/** How long, after the OAuth code, claude.ai gets to show a signed-in page before the account is
 *  kept without its claude.ai session. */
export const ANTHROPIC_SIGN_IN_SETTLE_MS = 20_000

export const ANTHROPIC_SIGN_IN_EMAIL_HINT =
  'Google sign-in may not open inside an app. If it refuses, use Continue with email: claude.ai sends a code.'
export const ANTHROPIC_SIGN_IN_PARTIAL =
  "Signed in. claude.ai didn't finish its own sign-in here, so artifacts won't open in the app yet. Sign in to this account again to try once more."
export const ANTHROPIC_SIGN_IN_UNKNOWN_ORG =
  "Signed in. Code UI couldn't read this account's organization, so artifacts won't open in the app yet. Sign in to this account again to try once more."

type Phase =
  | { kind: 'starting' }
  | { kind: 'web' }
  /** The OAuth code is exchanged; waiting for claude.ai's session. */
  | { kind: 'finishing' }
  | { kind: 'done' }
  /** Nothing usable came of it: say why, offer to try again. */
  | { kind: 'refused'; message: string }
  /** The account is signed in, its claude.ai session is not: say why. */
  | { kind: 'partial'; message: string }

function toSessionAccount(account: StoredAccount, index: number): ClaudeSessionAccount {
  return { id: account.id, organizationUuid: account.organizationUuid, label: accountLabel(account, index) }
}

/**
 * The Anthropic accounts sign-in, run in the app so that one sign-in gives an account everything
 * (user, 2026-10-17: "if I log in from Anthropic accounts, get all the things from there — why
 * sign in again to see artifacts").
 *
 * It loads the OAuth authorize page (prepareLogin), which until 2026-10-17 opened in the phone's
 * browser with a code to paste back. That page
 * redirects to REDIRECT_URI, an https page that draws `<code>#<state>` with both in its query; the
 * WebView is stopped there (codeFromCallbackUrl) and the code goes to exchangeCode exactly as a
 * pasted one would, so an account signed in again is updated in place (upsertAccount matches it
 * by its account uuid). The authorize page needs claude.ai's own login, which leaves the
 * account's claude.ai session in the WebView's jar; once a signed-in claude.ai page has set
 * lastActiveOrg it is captured for the account the code signed in (captureClaudeSession), so its
 * artifacts open in the app's viewer.
 *
 * The jar's claude.ai cookies are cleared first, so claude.ai asks who is signing in rather than
 * reusing whichever account it was on. A claude.ai session for another organization is refused
 * and cleared, and the user is told whose it was. Google refuses to sign in inside an embedded
 * WebView (its "disallowed_useragent" page); the user agent is not disguised, and the screen says
 * to use claude.ai's email code instead.
 */
export function AnthropicSignInScreen({ onDone }: { onDone: () => void }) {
  const { colors, space } = useTheme()
  const insets = useSafeAreaInsets()
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [source, setSource] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** The account the code signed in: the session is captured for it. */
  const target = useRef<string | null>(null)
  const verifier = useRef<string | null>(null)
  const exchanging = useRef(false)
  const capturing = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    let stale = false
    target.current = null
    exchanging.current = false
    setPhase({ kind: 'starting' })
    void (async () => {
      await clearClaudeCookies()
      try {
        const login = await prepareLogin()
        if (!stale) {
          verifier.current = login.codeVerifier
          setSource(login.url)
          setPhase({ kind: 'web' })
        }
      } catch (err) {
        if (!stale) {
          setPhase({ kind: 'refused', message: `Could not start the sign-in: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [attempt])

  const tryCapture = useCallback(async () => {
    const id = target.current
    if (id === null || capturing.current) {
      return
    }
    capturing.current = true
    try {
      const accounts = await listAccounts()
      const index = accounts.findIndex((account) => account.id === id)
      if (index === -1) {
        return
      }
      const all = accounts.map(toSessionAccount)
      const result = await captureClaudeSession(all[index]!, all)
      if (!live.current) {
        return
      }
      switch (result.kind) {
        case 'stored':
          setPhase({ kind: 'done' })
          onDone()
          return
        case 'waiting':
          return
        case 'other-account':
          setPhase({ kind: 'refused', message: claudeSessionOtherAccountMessage(result.label) })
          return
        case 'unknown-org':
          setPhase({ kind: 'partial', message: ANTHROPIC_SIGN_IN_UNKNOWN_ORG })
          return
        case 'failed':
          setPhase({ kind: 'partial', message: `Signed in, but the claude.ai sign-in could not be kept (${result.reason}), so artifacts won't open in the app yet.` })
          return
        default: {
          const unknown: never = result
          return unknown
        }
      }
    } catch (err) {
      console.warn(`[anthropic-sign-in] the claude.ai capture failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      capturing.current = false
    }
  }, [onDone])

  /** True when the address is the code page: the WebView must not go there. */
  const takeCode = useCallback((address: string): boolean => {
    const pasted = codeFromCallbackUrl(address)
    if (pasted === null) {
      return false
    }
    if (exchanging.current) {
      return true
    }
    exchanging.current = true
    const codeVerifier = verifier.current
    void (async () => {
      try {
        if (!codeVerifier) {
          throw new Error('No sign-in in progress. Try again.')
        }
        const credential = await exchangeCode(pasted, codeVerifier)
        const accounts = await listAccounts()
        target.current = accounts.find((account) => account.credential.accessToken === credential.accessToken)?.id ?? null
        if (!live.current) {
          return
        }
        setPhase({ kind: 'finishing' })
        setSource(CLAUDE_HOME_URL)
      } catch (err) {
        if (live.current) {
          setPhase({ kind: 'refused', message: err instanceof Error ? err.message : String(err) })
        }
      }
    })()
    return true
  }, [])

  // Only once the code is exchanged: the account the session is for is not known before.
  const watching = phase.kind === 'finishing'
  useEffect(() => {
    if (!watching) {
      return undefined
    }
    const timer = setInterval(() => void tryCapture(), ANTHROPIC_SIGN_IN_POLL_MS)
    const settle = setTimeout(() => {
      if (live.current) {
        setPhase((now) => (now.kind === 'finishing' ? { kind: 'partial', message: ANTHROPIC_SIGN_IN_PARTIAL } : now))
      }
    }, ANTHROPIC_SIGN_IN_SETTLE_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(settle)
    }
  }, [watching, tryCapture])

  const onNavigationStateChange = useCallback(
    (state: WebViewNavigation) => {
      takeCode(state.url)
    },
    [takeCode]
  )

  const showWeb = source !== null && (phase.kind === 'web' || phase.kind === 'finishing')
  const textButton = (props: { testID: string; label: string; onPress: () => void; primary?: boolean }) => (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      onPress={props.onPress}
      style={[
        styles.textButton,
        props.primary ? { backgroundColor: colors.text } : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong }
      ]}
    >
      <Txt variant="label" weight="semibold" style={{ color: props.primary ? colors.bg : colors.text }}>
        {props.label}
      </Txt>
    </Pressable>
  )

  return (
    <View testID="anthropic-sign-in" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          paddingTop: insets.top,
          minHeight: 56 + insets.top,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.xs,
          gap: space.xs,
          backgroundColor: colors.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border
        }}
      >
        <Pressable testID="anthropic-sign-in-close" accessibilityRole="button" accessibilityLabel="Close" onPress={onDone} style={styles.iconButton}>
          <ClaudeCdsGlyph name="x" size={24} color={colors.text} />
        </Pressable>
        <Txt testID="anthropic-sign-in-title" variant="heading" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
          Sign in to Anthropic
        </Txt>
      </View>
      {showWeb ? (
        <View style={{ flex: 1 }}>
          <WebView
            testID="anthropic-sign-in-webview"
            style={{ flex: 1, backgroundColor: colors.bg }}
            source={{ uri: source }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            onShouldStartLoadWithRequest={(request) => {
              if (takeCode(request.url)) {
                return false
              }
              // Only web pages: an intent: or app link from a provider page has nowhere to go here.
              return /^https?:\/\//i.test(request.url) || request.url === 'about:blank'
            }}
            onNavigationStateChange={onNavigationStateChange}
            onLoadEnd={() => {
              if (watching) {
                void tryCapture()
              }
            }}
          />
          {phase.kind === 'finishing' ? (
            <View testID="anthropic-sign-in-finishing" style={[styles.cover, { backgroundColor: colors.bg }]}>
              <Txt variant="body" align="center">
                Finishing the sign-in…
              </Txt>
            </View>
          ) : null}
          <View style={{ padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
            <Txt testID="anthropic-sign-in-hint" variant="caption" tone="secondary">
              {ANTHROPIC_SIGN_IN_EMAIL_HINT}
            </Txt>
          </View>
        </View>
      ) : phase.kind === 'refused' || phase.kind === 'partial' ? (
        <View testID="anthropic-sign-in-message" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: space.md }}>
          <Txt variant="body" align="center">
            {phase.message}
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {textButton({ testID: 'anthropic-sign-in-retry', label: 'Try again', primary: true, onPress: () => setAttempt((n) => n + 1) })}
            {textButton({ testID: 'anthropic-sign-in-done', label: 'Close', onPress: onDone })}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  textButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  cover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }
})
