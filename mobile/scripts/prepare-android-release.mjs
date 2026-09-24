#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const mobileRoot = path.resolve(import.meta.dirname, '..')
const appConfigPath = process.env.MOBILE_APP_CONFIG_PATH || path.join(mobileRoot, 'app.json')
const androidTagRefPrefix = 'refs/tags/mobile-android-v'
const semverPattern = /^\d+\.\d+\.\d+$/

function input(name) {
  return (process.env[name] || '').trim()
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function validateSemver(version, name) {
  if (!semverPattern.test(version)) {
    fail(`${name} must use x.y.z format`)
  }
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return
  }

  fs.appendFileSync(outputPath, `${name}=${value}\n`)
}

const config = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))
const expo = config.expo || fail('app.json is missing expo config')
const android = expo.android || fail('app.json is missing expo.android config')
const currentVersion = String(expo.version || '').trim()
validateSemver(currentVersion, 'Current mobile version')

const currentVersionCode = Number(android.versionCode)
if (!Number.isSafeInteger(currentVersionCode) || currentVersionCode <= 0) {
  fail('Current Android versionCode must be a positive integer')
}

const githubRef = input('GITHUB_REF')
const tagVersion = githubRef.startsWith(androidTagRefPrefix)
  ? githubRef.slice(androidTagRefPrefix.length)
  : ''
const requestedVersion = input('MOBILE_ANDROID_RELEASE_VERSION')
const bumpPatch = truthy(input('MOBILE_ANDROID_BUMP_PATCH_VERSION'))

if (tagVersion) {
  validateSemver(tagVersion, 'Android release tag version')
}

if (requestedVersion) {
  validateSemver(requestedVersion, 'MOBILE_ANDROID_RELEASE_VERSION')
}

if (bumpPatch) {
  fail('MOBILE_ANDROID_BUMP_PATCH_VERSION is no longer supported; commit mobile/app.json first')
}

if (tagVersion && tagVersion !== currentVersion) {
  fail('Android release tag version must match the committed mobile app version')
}

if (requestedVersion && requestedVersion !== currentVersion) {
  fail('MOBILE_ANDROID_RELEASE_VERSION must match the committed mobile app version')
}

const requestedVersionCode = input('MOBILE_ANDROID_VERSION_CODE')
const bumpVersionCode = truthy(input('MOBILE_ANDROID_BUMP_VERSION_CODE'))

if (requestedVersionCode || bumpVersionCode) {
  // Why: Android rejects lower versionCode installs; release-only bumps leave
  // committed dev builds behind shipped APKs and break local testing.
  fail('Android versionCode changes must be committed in mobile/app.json before release')
}

// Why: a tag push carries no workflow inputs, so an empty value is the native shell, the app we
// ship. The build step reads this output as EXPO_PUBLIC_MOBILE_SHELL, so this is the one place the
// shell kind is decided.
const shell = input('MOBILE_ANDROID_SHELL') || 'native'
if (shell !== 'native' && shell !== 'ota') {
  fail(`MOBILE_ANDROID_SHELL must be native or ota, got "${shell}"`)
}

const tag = `mobile-android-v${currentVersion}`
const publishRequested =
  githubRef.startsWith(androidTagRefPrefix) || truthy(input('MOBILE_ANDROID_PUBLISH_RELEASE'))
// Why: the in-app update card offers the APK on the newest mobile-android-v* release, and the
// asset name carries no shell kind, so publishing an OTA build would hand the hybrid shell to
// every user. An OTA build is a test build: the run's artifact is where it goes.
const publishRelease = publishRequested && shell === 'native'

writeOutput('version', currentVersion)
writeOutput('android_version_code', String(currentVersionCode))
writeOutput('tag', tag)
writeOutput('shell', shell)
writeOutput('publish_release', publishRelease ? 'true' : 'false')

console.log(`Prepared Code UI Android ${currentVersion} (${currentVersionCode})`)
console.log(`Release tag: ${tag}`)
console.log(`Shell: ${shell}`)
console.log(`Publish GitHub Release: ${publishRelease ? 'yes' : 'no'}`)
if (publishRequested && !publishRelease) {
  console.log(
    `::warning::Not publishing ${tag}: an ota-shell build is never released. The APK is on this run's artifacts.`
  )
}
