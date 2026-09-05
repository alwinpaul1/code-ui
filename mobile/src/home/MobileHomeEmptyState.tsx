import { QrCode } from 'lucide-react-native'
import { View } from 'react-native'
import { OrcaLogo } from '../components/OrcaLogo'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { SectionLabel } from '../ui/SectionLabel'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'

const ONBOARDING_STEPS = [
  {
    title: 'Open Orca on your computer',
    desc: 'Go to Settings → Mobile and generate a pairing QR code.'
  },
  {
    title: 'Scan the code',
    desc: 'Point your camera at the QR code, or paste the pairing code instead.'
  },
  {
    title: "You're connected",
    desc: 'Your desktop and every running agent appear here. Traffic is encrypted end to end.'
  }
]

export function MobileHomeEmptyState(props: {
  bottomInset: number
  contentMaxWidth: number
  isWideLayout: boolean
  onPairDesktop: () => void
}) {
  const { colors, space } = useTheme()
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
        <OrcaLogo size={44} />
        <Txt variant="title" weight="semibold" align="center" style={{ marginTop: space.xl }}>
          Connect your desktop
        </Txt>
        <Txt
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginTop: space.sm, marginBottom: space.xl, maxWidth: 320 }}
        >
          Pair with Orca on your computer to watch your agents, read any terminal, and reply
          from your phone.
        </Txt>
        <Button label="Pair desktop" icon={QrCode} variant="accent" size="lg" onPress={props.onPairDesktop} />
      </View>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
        <SectionLabel style={{ marginTop: 0 }}>How it works</SectionLabel>
        <Surface rounded="lg">
          {ONBOARDING_STEPS.map((step, index) => (
            <View
              key={step.title}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: space.md,
                paddingHorizontal: space.md,
                paddingVertical: space.md,
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: colors.border
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1
                }}
              >
                <Txt variant="caption" weight="bold" tone="accent">
                  {index + 1}
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="label" weight="semibold">
                  {step.title}
                </Txt>
                <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {step.desc}
                </Txt>
              </View>
            </View>
          ))}
        </Surface>
      </View>
    </View>
  )
}
