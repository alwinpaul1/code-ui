import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { AnthropicSignInScreen } from '../src/session/AnthropicSignInScreen'

/**
 * The Anthropic accounts sign-in, in the app (open-anthropic-sign-in.ts): one sign-in yields the
 * account's OAuth token and its claude.ai session (AnthropicSignInScreen.tsx).
 */
export default function AnthropicSignInRoute() {
  const router = useRouter()
  const done = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }, [router])
  return <AnthropicSignInScreen onDone={done} />
}
