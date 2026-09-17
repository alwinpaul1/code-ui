import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { alphaAt,
  alphaRange,
  decodePng,
  opaqueColours,
  visibleColours,
  type DecodedPng
} from '../test/png-pixels'
import { brand } from '../theme/tokens'
import { APP_LOGO_PATH, APP_LOGO_VIEWBOX_HEIGHT, APP_LOGO_VIEWBOX_WIDTH } from './app-logo-path'

// Why: the icon PNGs are the one part of the brand no type check or render
// test can see, and the failure is silent: a coloured notification icon ships
// as a white blob, an icon with alpha is rejected by the store, a splash mark
// that does not read on the dark background is only found on a phone. These
// read the actual pixels of the files app.json points at (2026-09-17).

const mobileRoot = path.resolve(import.meta.dirname, '../..')
const appJson = JSON.parse(readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
const expo = appJson.expo

function asset(relative: string): DecodedPng {
  return decodePng(readFileSync(path.join(mobileRoot, relative)))
}

function plugin(name: string): Record<string, unknown> {
  const entry = (expo.plugins as unknown[]).find(
    (item) => Array.isArray(item) && item[0] === name
  ) as [string, Record<string, unknown>] | undefined
  if (!entry) {
    throw new Error(`app.json has no ${name} plugin entry`)
  }
  return entry[1]
}

const WHITE = '255,255,255'
const RED = [1, 3, 5].map((at) => Number.parseInt(brand.red.slice(at, at + 2), 16)).join(',')

/** The one colour of every pixel with any coverage; fails naming the others. */
function onlyVisibleColour(png: DecodedPng): string {
  const keys = [...visibleColours(png).keys()]
  expect(keys, 'every pixel with any coverage').toEqual([keys[0]])
  return keys[0]
}

/** The one colour of every fully opaque pixel; fails naming the others. */
function onlyOpaqueColour(png: DecodedPng): string {
  const keys = [...opaqueColours(png).keys()]
  expect(keys, 'every fully opaque pixel').toEqual([keys[0]])
  return keys[0]
}

describe('the notification icon', () => {
  it('is a white silhouette on transparent, 96x96', () => {
    const png = asset(plugin('expo-notifications').icon as string)
    expect([png.width, png.height]).toEqual([96, 96])
    expect(onlyVisibleColour(png)).toBe(WHITE)
    const alpha = alphaRange(png)
    expect(alpha.max, 'some pixel fully opaque').toBe(255)
    expect(alpha.min, 'some pixel fully transparent').toBe(0)
  })

  it('is tinted with the brand red', () => {
    expect(plugin('expo-notifications').color).toBe(brand.red)
  })
})

describe('the launcher icon', () => {
  it('is an adaptive foreground of the knot alone in white over a red background', () => {
    const { foregroundImage, backgroundColor } = expo.android.adaptiveIcon
    const png = asset(foregroundImage)
    expect([png.width, png.height]).toEqual([1024, 1024])
    expect(onlyVisibleColour(png)).toBe(WHITE)
    expect(alphaRange(png)).toEqual({ min: 0, max: 255 })
    expect(backgroundColor).toBe(brand.red)
  })

  /**
   * The icon carries its own squircle rather than being a full-bleed square.
   * It is shown UNMASKED in most places it turns up — the legacy API 24-25
   * launcher, a sideload prompt, a file browser, a repository listing — where a
   * square reads as a raw tile. Android 8+ uses the adaptive icon and applies
   * its own mask, so nothing double-rounds.
   *
   * Pinning the CORNER specifically, because that is the whole change: a
   * regenerated full-bleed icon would still be 1024, still mostly red and still
   * have white in it, and would pass every other assertion here.
   */
  it('has a 1024 app icon cut to a squircle, red with a white knot', () => {
    const png = asset(expo.icon)
    expect([png.width, png.height]).toEqual([1024, 1024])
    expect(alphaAt(png, 4, 4), 'the corner is cut away').toBe(0)
    expect(alphaAt(png, 512, 512), 'the middle is solid').toBe(255)
    // A superellipse, not a rounded rectangle. The two shapes only disagree in a
    // narrow band, so the point is computed, not guessed: at x = 20 the n = 5
    // squircle is still cut until y = 148, while a rounded rect with an
    // iOS-sized 180 px radius has finished its arc by y = 98. (20, 120) sits
    // between them, so it is transparent here and would be solid there. A first
    // draft guessed (40, 123) and was inside the shape.
    expect(alphaAt(png, 20, 120), 'still curving where a rounded rect would be solid').toBe(0)
    expect(alphaAt(png, 512, 2), 'the edge midpoint is solid').toBe(255)
    const colours = visibleColours(png)
    const ranked = [...colours.entries()].sort((a, b) => b[1] - a[1])
    expect(ranked[0][0]).toBe(RED)
    expect(colours.get(WHITE) ?? 0).toBeGreaterThan(0)
  })
})

describe('the splash mark', () => {
  const splash = plugin('expo-splash-screen') as {
    image: string
    backgroundColor: string
    dark: { image: string; backgroundColor: string }
  }

  it('is the red tile with transparent corners and knot, 1024x1024', () => {
    const png = asset(splash.image)
    expect([png.width, png.height]).toEqual([1024, 1024])
    expect(onlyOpaqueColour(png)).toBe(RED)
    expect(alphaRange(png)).toEqual({ min: 0, max: 255 })
    expect(splash.dark.image).toBe(splash.image)
  })

  it('reads on the light and the dark splash background', () => {
    for (const background of [splash.backgroundColor, splash.dark.backgroundColor]) {
      expect(contrastRatio(brand.red, background), background).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('the favicon', () => {
  it('is the red tile at 48x48', () => {
    const png = asset('assets/favicon.png')
    expect([png.width, png.height]).toEqual([48, 48])
    // Asserted first so an all-transparent render says so, instead of failing
    // inside onlyOpaqueColour with an empty colour map and naming nothing.
    expect(alphaRange(png).max).toBe(255)
    expect(onlyOpaqueColour(png)).toBe(RED)
  })
})

describe('the in-app mark', () => {
  it('is the same shape as the icon master', () => {
    const svg = readFileSync(path.join(mobileRoot, 'assets/brand/mark.svg'), 'utf8')
    expect(svg).toContain(`viewBox="0 0 ${APP_LOGO_VIEWBOX_WIDTH} ${APP_LOGO_VIEWBOX_HEIGHT}"`)
    expect(svg).toContain(`fill="${brand.red}"`)
    const d = /\sd="([^"]+)"/.exec(svg)?.[1]
    expect(d).toBe(APP_LOGO_PATH)
  })
})
