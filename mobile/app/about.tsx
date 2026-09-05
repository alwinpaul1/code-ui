import { View, Linking, Platform, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronRight, Globe, RefreshCw, type LucideIcon } from 'lucide-react-native'
import Svg, { Path } from 'react-native-svg'
import Constants from 'expo-constants'
import { OrcaLogo } from '../src/components/OrcaLogo'
import { AppUpdateDialog } from '../src/app-update/AppUpdateDialog'
import { useAppUpdateStore } from '../src/app-update/app-update-store'
import { useTheme } from '../src/theme/theme-context'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'

// Why: read version + native build identifier from expo-constants at
// runtime so the About screen never drifts out of sync with app.json.
// nativeBuildVersion is iOS buildNumber on iOS and versionCode on
// Android — different concepts, same role (monotonic native build id).
function getVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '?.?.?'
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : String(Constants.expoConfig?.android?.versionCode ?? '')
  return build ? `v${version} (${build})` : `v${version}`
}

function GithubIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </Svg>
  )
}

function LinkRow({
  icon,
  label,
  url,
  first = false
}: {
  icon: LucideIcon | 'github'
  label: string
  url: string
  first?: boolean
}) {
  const { colors, space } = useTheme()
  const Icon = icon === 'github' ? null : icon
  return (
    <Pressable
      accessibilityRole="link"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 52,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
      onPress={() => void Linking.openURL(url)}
    >
      {Icon ? (
        <Icon size={17} color={colors.textSecondary} strokeWidth={2} />
      ) : (
        <GithubIcon size={17} color={colors.textSecondary} />
      )}
      <Txt variant="body" weight="medium" style={{ flex: 1 }}>
        {label}
      </Txt>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}

function CheckForUpdatesRow() {
  const { colors, space } = useTheme()
  const status = useAppUpdateStore((s) => s.status)
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const checkForUpdate = useAppUpdateStore((s) => s.checkForUpdate)
  const hint =
    status === 'checking'
      ? 'Checking…'
      : status === 'available' && latestVersion
        ? `v${latestVersion} available`
        : status === 'up-to-date'
          ? 'Up to date'
          : status === 'error'
            ? 'Could not check'
            : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Check for updates"
      disabled={status === 'checking'}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 52,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
      onPress={() => void checkForUpdate({ force: true })}
    >
      <RefreshCw size={17} color={colors.textSecondary} strokeWidth={2} />
      <Txt variant="body" weight="medium" style={{ flex: 1 }}>
        Check for updates
      </Txt>
      {hint ? (
        <Txt variant="caption" tone={status === 'available' ? 'accent' : 'muted'}>
          {hint}
        </Txt>
      ) : null}
    </Pressable>
  )
}

export default function AboutScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="About" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
          <OrcaLogo size={48} />
          <Txt variant="title" weight="semibold" style={{ marginTop: space.sm }}>
            Code UI
          </Txt>
          <Txt variant="body" tone="secondary" align="center" style={{ maxWidth: 300 }}>
            A phone-first view of the agents running in Orca on your desktop.
          </Txt>
          <Txt variant="caption" tone="muted">
            {getVersionLabel()}
          </Txt>
        </View>

        <SectionLabel style={{ marginTop: 0 }}>Code UI</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <CheckForUpdatesRow />
          <LinkRow
            icon="github"
            label="alwinpaul1/code-ui"
            url="https://github.com/alwinpaul1/code-ui"
          />
        </Surface>

        <SectionLabel>Built on Orca</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <LinkRow icon={Globe} label="onOrca.dev" url="https://onOrca.dev" first />
          <LinkRow icon="github" label="stablyai/orca" url="https://github.com/stablyai/orca" />
        </Surface>
        <Txt
          variant="caption"
          tone="muted"
          style={{ marginTop: space.md, paddingHorizontal: space.xs }}
        >
          Code UI reuses Orca's relay, pairing and terminal engine under the MIT licence. The
          desktop app stays the source of truth; this app is a remote control for it.
        </Txt>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Developed with love by Alwin Paul, opens alwinpaul.me"
          onPress={() => void Linking.openURL('https://alwinpaul.me')}
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: 'center',
            marginTop: space.xl,
            marginBottom: space.md,
            opacity: pressed ? 0.6 : 1
          })}
        >
          <Txt variant="caption" tone="muted">
            Developed with{' '}
            <Txt variant="caption" style={{ color: colors.danger }}>
              ♥
            </Txt>{' '}
            by{' '}
            <Txt variant="caption" weight="medium" tone="accent">
              Alwin Paul
            </Txt>
          </Txt>
        </Pressable>
      </ScrollView>
      <AppUpdateDialog />
    </View>
  )
}
