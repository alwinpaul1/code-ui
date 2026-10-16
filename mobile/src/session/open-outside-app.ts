import { requireOptionalNativeModule } from 'expo-modules-core'
import { openExternalLink } from '../platform/external-link'

// ─── Opening a web link in a browser, never back in Code UI ──────────────────
//
// app.json gives Code UI an (unverified) https filter for claude.ai artifact
// links. Once the user turns on "Open supported links" for the app, a plain
// Linking.openURL of such a link is routed straight back here, so "Open in
// browser" would reopen the viewer. On Android this goes through
// modules/orca-artifact-shortcuts, which starts the user's default browser (or
// the first installed one that is not this app) by package name. Where that
// module is absent (web, iOS, tests), or finds no browser, or throws, the
// ordinary openExternalLink is the fallback.

const MODULE = 'OrcaArtifactShortcuts'

type NativeOpenOutside = {
  openUrlOutsideApp(url: string): Promise<string>
}

/** Opens an https URL in a browser outside the app. Anything but https is refused with a warning. */
export async function openUrlOutsideApp(url: string): Promise<void> {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url.trim())) {
    console.warn(`[open-outside-app] refused a non-https URL: ${String(url)}`)
    return
  }
  const native = requireOptionalNativeModule<NativeOpenOutside>(MODULE)
  if (native === null) {
    openExternalLink(url)
    return
  }
  let answer: string
  try {
    answer = await native.openUrlOutsideApp(url)
  } catch (error) {
    console.warn(`[open-outside-app] ${MODULE}.openUrlOutsideApp threw, opening with Linking: ${String(error)}`)
    openExternalLink(url)
    return
  }
  if (answer === 'opened') {
    return
  }
  console.warn(`[open-outside-app] ${MODULE}.openUrlOutsideApp answered ${String(answer)}, opening with Linking`)
  openExternalLink(url)
}
