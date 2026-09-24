import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(
  new URL('../../scripts/prepare-android-release.mjs', import.meta.url)
)

const appConfig = {
  expo: {
    version: '0.0.22',
    android: {
      versionCode: 4
    }
  }
}

let tempDirs: string[] = []

function createAppConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-android-release-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'app.json')
  const contents = `${JSON.stringify(appConfig, null, 2)}\n`
  writeFileSync(configPath, contents)
  return { configPath, contents }
}

// Why: on the release runner GITHUB_REF is the mobile-android-v* tag being built, and
// GITHUB_OUTPUT points at the job's output file. The script under test must see neither,
// or its fixture app.json (0.0.22) fails the tag-version match and the suite blocks the
// very release it guards.
const scriptEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== 'GITHUB_REF' && key !== 'GITHUB_OUTPUT' && !key.startsWith('MOBILE_ANDROID_')
  )
)

/** Runs the script with GITHUB_OUTPUT pointed at a temp file and reads back what it wrote there,
 *  which is what the workflow's later steps see as `steps.release.outputs`. */
function runWithOutputs(env: Record<string, string>) {
  const { configPath } = createAppConfig()
  const outputPath = join(tempDirs.at(-1)!, 'github-output')
  writeFileSync(outputPath, '')
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...scriptEnv, MOBILE_APP_CONFIG_PATH: configPath, GITHUB_OUTPUT: outputPath, ...env }
  })
  const outputs = Object.fromEntries(
    readFileSync(outputPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
  return { result, outputs }
}

describe('prepare Android release script', () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
    tempDirs = []
  })

  it('uses committed Android release identity without mutating app config', () => {
    const { configPath, contents } = createAppConfig()

    const output = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_PUBLISH_RELEASE: 'true'
      }
    })

    expect(output).toContain('Prepared Code UI Android 0.0.22 (4)')
    expect(output).toContain('Release tag: mobile-android-v0.0.22')
    expect(readFileSync(configPath, 'utf8')).toBe(contents)
  })

  it('rejects release-only Android versionCode bumps', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_BUMP_VERSION_CODE: 'true'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Android versionCode changes must be committed in mobile/app.json before release'
    )
  })

  it('rejects release versions that do not match committed app config', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_RELEASE_VERSION: '0.0.23'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'MOBILE_ANDROID_RELEASE_VERSION must match the committed mobile app version'
    )
  })

  // Why: the in-app update card offers whatever APK the newest mobile-android-v* release carries,
  // and the asset name has no shell kind in it, so a published OTA build would replace the native
  // one for every user. publish_github_release defaults to true, so a dispatch that only flips the
  // shell would otherwise publish.
  it('publishes nothing for an OTA-shell build, even one dispatched from a release tag', () => {
    const { result, outputs } = runWithOutputs({
      GITHUB_REF: 'refs/tags/mobile-android-v0.0.22',
      MOBILE_ANDROID_PUBLISH_RELEASE: 'true',
      MOBILE_ANDROID_SHELL: 'ota'
    })

    expect(result.status).toBe(0)
    expect(outputs.shell).toBe('ota')
    expect(outputs.publish_release).toBe('false')
    expect(result.stdout).toContain('::warning::')
  })

  it('builds a tag push, which carries no shell input, as native and publishes it', () => {
    const { result, outputs } = runWithOutputs({ GITHUB_REF: 'refs/tags/mobile-android-v0.0.22' })

    expect(result.status).toBe(0)
    expect(outputs.shell).toBe('native')
    expect(outputs.publish_release).toBe('true')
  })

  it('refuses a shell kind it does not know rather than building the native one', () => {
    const { result } = runWithOutputs({ MOBILE_ANDROID_SHELL: 'hybrid' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MOBILE_ANDROID_SHELL must be native or ota')
  })
})
