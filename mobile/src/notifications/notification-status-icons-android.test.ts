import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ICON_KINDS,
  drawableName,
  statusLayoutXml,
  statusResourceFiles,
  svgToVectorDrawable
} from '../../plugins/android-notification-status-icons'
import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

const MOBILE_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PATCH = readFileSync(
  fileURLToPath(new URL('../../patches/expo-notifications@57.0.17.patch', import.meta.url)),
  'utf8'
)
// The Kotlin the patch adds, not its context lines or its comments: a name in
// the doc comment must not satisfy a lookup the code never makes.
const PATCH_CODE = PATCH.split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1))
  .filter((line) => !/^\s*(\*|\/\*\*|\/\/)/.test(line))
  .join('\n')

// 2026-09-24, the user: no emoji in notifications, a drawn icon in each one's
// place. Three pieces have to agree for an icon to appear at all — the JS
// names it, the plugin draws it into android/, the patch looks it up by name —
// and a mismatch fails silently into the stock template, so pin the seams.
describe('the icons drawn where a notification used to have an emoji', () => {
  it('has a drawn icon for every kind the phone can name, and no extra', () => {
    expect(ICON_KINDS.map(drawableName).sort()).toEqual(Object.values(NOTIFICATION_STATUS_ICONS).sort())
  })

  it('converts every hand-drawn SVG, so a prebuild cannot fail on one', () => {
    const files = statusResourceFiles(MOBILE_ROOT)
    for (const icon of Object.values(NOTIFICATION_STATUS_ICONS)) {
      const xml = files[`drawable/${icon}.xml`]
      expect(xml).toContain('android:viewportWidth="24"')
      expect(xml).toMatch(/android:pathData="M/)
      expect(xml).not.toContain('"none"')
    }
  })

  it('carries a stroke through with its caps, which is what draws a dot', () => {
    const xml = svgToVectorDrawable(
      '<svg viewBox="0 0 24 24"><path d="M12 16h0.01" fill="none" stroke="#FFF" stroke-width="2.7" stroke-linecap="round"/></svg>'
    )
    expect(xml).toContain('android:strokeColor="#FFF"')
    expect(xml).toContain('android:strokeWidth="2.7"')
    expect(xml).toContain('android:strokeLineCap="round"')
    expect(xml).not.toContain('fillColor')
  })

  it('refuses a shape it cannot convert instead of drawing a wrong icon', () => {
    expect(() => svgToVectorDrawable('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')).toThrow(
      /circle/
    )
    expect(() =>
      svgToVectorDrawable('<svg viewBox="0 0 24 24"><path d="M0 0" transform="rotate(4)"/></svg>')
    ).toThrow(/transform/)
    expect(() => svgToVectorDrawable('<svg viewBox="0 0 24 24"></svg>')).toThrow(/no <path>/)
  })

  it('looks up in the patch exactly the views the layouts define', () => {
    const defined = new Set(
      [statusLayoutXml({ expanded: false }), statusLayoutXml({ expanded: true })].flatMap((xml) =>
        [...xml.matchAll(/@\+id\/(\w+)/g)].map((match) => match[1])
      )
    )
    const looked = new Set([...PATCH_CODE.matchAll(/\bid\("(\w+)"\)/g)].map((match) => match[1]))
    expect([...looked].sort()).toEqual([...defined].sort())
    expect(PATCH_CODE).toContain('getIdentifier("notification_status", "layout", pkg)')
    expect(PATCH_CODE).toContain('getIdentifier("notification_status_big", "layout", pkg)')
  })

  it('reads the data keys the phone writes, and only icons of its own', () => {
    expect(PATCH_CODE).toContain('optString("statusIcon", "")')
    expect(PATCH_CODE).toContain('optString("replyVerdict", "")')
    expect(PATCH_CODE).toContain('iconName.startsWith("notification_status_")')
  })

  it('draws the text in the shade’s own styles, so light and dark both follow the system', () => {
    for (const expanded of [false, true]) {
      const xml = statusLayoutXml({ expanded })
      expect(xml).toContain('@style/TextAppearance.Compat.Notification.Title')
      expect(xml).toContain('@style/TextAppearance.Compat.Notification"')
      expect(xml).not.toMatch(/textColor|#[0-9A-Fa-f]{3,8}/)
    }
  })
})
