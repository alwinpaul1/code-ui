import { redirectArtifactSystemPath } from '../src/session/claude-artifact-native-intent'

/**
 * Expo Router hands every URL the system delivers (cold start and while running) to this before
 * matching it to a route. Only claude.ai artifact links from other apps and the artifact
 * shortcut's `codeui://artifact` link are rewritten (claude-artifact-native-intent.ts); pairing
 * (`orca://pair`, `codeui://pair`), notification and every other link comes back unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return redirectArtifactSystemPath(path)
}
