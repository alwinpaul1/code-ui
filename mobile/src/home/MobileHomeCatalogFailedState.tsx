import { RefreshCw } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'
import { AppLogo } from '../components/AppLogo'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

// Home's words for a read that failed. They follow EMPTY_HOSTS_FAILED_COPY in
// transport/use-loaded-hosts.ts, but home has a Retry, so it does not ask the
// user to reopen the screen.
export const HOME_CATALOG_FAILED_TITLE = "Couldn't read your paired desktops"
export const HOME_CATALOG_FAILED_DETAIL =
  'The list saved on this phone could not be read just now. Try again in a moment.'

// Why its own body and not the pairing screen: a locked or failing Keychain, or
// a read stuck past its cap, says nothing about what is paired. "Connect your
// desktop" over a phone that still has its desktops sends the user off to pair
// again for no reason.
export function MobileHomeCatalogFailedState(props: {
  bottomInset: number
  contentMaxWidth: number
  isWideLayout: boolean
  onRetry: () => Promise<void>
}) {
  const { space } = useTheme()
  const [retrying, setRetrying] = useState(false)
  const retry = () => {
    setRetrying(true)
    // The read logs its own failure; this only frees the button for another try.
    void props
      .onRetry()
      .catch(() => undefined)
      .finally(() => setRetrying(false))
  }
  return (
    <View
      style={[
        { flex: 1, paddingBottom: props.bottomInset },
        props.isWideLayout && {
          maxWidth: props.contentMaxWidth,
          width: '100%',
          alignSelf: 'center'
        }
      ]}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.xxl,
          paddingBottom: space.xxl
        }}
      >
        <AppLogo size={44} />
        <Txt variant="title" weight="semibold" align="center" style={{ marginTop: space.xl }}>
          {HOME_CATALOG_FAILED_TITLE}
        </Txt>
        <Txt
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginTop: space.sm, marginBottom: space.xl, maxWidth: 320 }}
        >
          {HOME_CATALOG_FAILED_DETAIL}
        </Txt>
        <Button
          label="Retry"
          icon={RefreshCw}
          variant="accent"
          size="lg"
          align="center"
          loading={retrying}
          onPress={retry}
        />
      </View>
    </View>
  )
}
