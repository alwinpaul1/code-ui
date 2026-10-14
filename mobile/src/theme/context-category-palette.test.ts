import { describe, expect, it } from 'vitest'
import {
  contextCategoryPaletteForScheme,
  darkContextCategoryPalette,
  lightContextCategoryPalette
} from './context-category-palette'

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

describe('the context card palette', () => {
  it('is the Claude app\'s own, slot by slot (ad5.r, M, n, D0, r0, C, d0, R, F; 1.261009.20)', () => {
    expect(lightContextCategoryPalette).toEqual({
      1: '#2A78D6',
      2: '#EB6834',
      3: '#1BAF7A',
      4: '#EDA100',
      5: '#E87BA4',
      6: '#008300',
      7: '#898781',
      8: '#C3C2B7',
      9: 'rgba(137, 135, 129, 0.15)'
    })
    expect(darkContextCategoryPalette).toEqual({
      1: '#3987E5',
      2: '#D95926',
      3: '#199E70',
      4: '#C98500',
      5: '#D55181',
      6: '#008300',
      7: '#97958D',
      8: '#5F5E5A',
      9: 'rgba(151, 149, 141, 0.15)'
    })
  })

  it.each([
    ['light', lightContextCategoryPalette],
    ['dark', darkContextCategoryPalette]
  ] as const)('gives the %s scheme nine colours, no two of them alike, so no two categories read as one', (scheme, palette) => {
    expect(contextCategoryPaletteForScheme(scheme)).toBe(palette)
    expect(new Set(SLOTS.map((slot) => palette[slot])).size).toBe(SLOTS.length)
  })

  it('differs between the schemes in every slot but the one the app keeps the same (slot 6)', () => {
    const same = SLOTS.filter((slot) => lightContextCategoryPalette[slot] === darkContextCategoryPalette[slot])
    expect(same).toEqual([6])
  })
})
