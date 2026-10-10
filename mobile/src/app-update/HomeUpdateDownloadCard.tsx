import { Download } from 'lucide-react-native'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useApkInstallStore } from './apk-install-store'
import { downloadProgressPercent } from './download-progress'

/**
 * A download's progress, on Home, while it runs. Not a dialog: a download
 * popup that trapped the app was withdrawn on 2026-09-14, and the update
 * dialog stays hidden while the file comes down (app-update-dialog-state-
 * machine.ts). This card sits over the bottom of the list and takes no
 * touches, so the app stays usable under it; the dialog returns with Install
 * when the file is in.
 *
 * Percent only, no megabytes: the updater reports a fraction and never the
 * file's size. No Cancel either: neither engine has a way to stop a download
 * once it is handed over (DownloadManager carries it outside the app).
 */
export function HomeUpdateDownloadCard() {
  const { colors, radius, space } = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useApkInstallStore((s) => s.phase)
  const progress = useApkInstallStore((s) => s.progress)
  const version = useApkInstallStore((s) => s.version)
  if (phase !== 'downloading') {
    return null
  }
  const percent = downloadProgressPercent(progress)
  const name = version ? `Code UI ${version}` : 'Code UI'
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: space.lg,
        right: space.lg,
        bottom: insets.bottom + space.lg,
        alignItems: 'center'
      }}
    >
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Downloading ${name}`}
        accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent} percent` }}
        accessibilityLiveRegion="polite"
        testID="home-update-download-card"
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: colors.bgPanel,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space.lg,
          paddingVertical: space.md + 2,
          gap: space.md,
          shadowColor: colors.shadow,
          shadowOpacity: 1,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accentSoft
            }}
          >
            <Download size={18} color={colors.accentText} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="label" weight="semibold">
              Downloading update
            </Txt>
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {name} · you'll be asked before it installs
            </Txt>
          </View>
          <Txt
            variant="label"
            weight="semibold"
            style={{ fontVariant: ['tabular-nums'] }}
            testID="home-update-download-percent"
          >
            {percent}%
          </Txt>
        </View>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            overflow: 'hidden',
            backgroundColor: colors.bgRaised
          }}
        >
          <View
            testID="home-update-download-fill"
            style={{ width: `${percent}%`, height: '100%', borderRadius: 3, backgroundColor: colors.accent }}
          />
        </View>
      </View>
    </View>
  )
}
