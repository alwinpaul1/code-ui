import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import { Button } from '../src/ui/Button'
import { Txt } from '../src/ui/Txt'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'

export default function PairRedirectScreen() {
  const router = useRouter()
  const { colors, space } = useTheme()
  const params = useLocalSearchParams<{ code?: string }>()
  const [missingCode, setMissingCode] = useState(false)

  const goHome = useCallback(() => {
    router.replace('/')
  }, [router])

  useEffect(() => {
    let disposed = false

    async function redirectToConfirm() {
      const codeParam = Array.isArray(params.code) ? params.code[0] : params.code
      if (codeParam) {
        router.replace({ pathname: '/pair-confirm', params: { code: codeParam } })
        return
      }

      const initialUrl = await Linking.getInitialURL().catch(() => null)
      const code = initialUrl ? extractPairingCodeFromUrl(initialUrl) : null
      if (disposed) {
        return
      }
      if (code) {
        router.replace({ pathname: '/pair-confirm', params: { code } })
        return
      }
      setMissingCode(true)
    }

    void redirectToConfirm()
    return () => {
      disposed = true
    }
  }, [params.code, router])

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
        padding: space.lg,
        gap: space.xl
      }}
    >
      {missingCode ? (
        <>
          <Txt variant="body" tone="danger" align="center">
            Missing pairing code
          </Txt>
          <Button label="Back to home" onPress={goHome} />
        </>
      ) : (
        <ActivityIndicator size="large" color={colors.textSecondary} />
      )}
    </View>
  )
}
