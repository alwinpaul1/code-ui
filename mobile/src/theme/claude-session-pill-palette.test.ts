import { describe, expect, it } from 'vitest'
import { claudeSessionPillPalette } from './claude-session-pill-palette'

// Every expected value is the hex the Claude Android app (com.anthropic.claude 1.261009.20) resolves
// for that token, read from the decompile (pl7 fields and ad5 methods, light = j95/a65, dark =
// i65/z55). The comment on each names the token and the class that reads it, so a later build can
// be compared against this table.

describe('the Claude app session pill palette', () => {
  const light = claudeSessionPillPalette('light')
  const dark = claudeSessionPillPalette('dark')

  it('draws the +N and -M counts of the Diff pill and file rows in ad5.K() and ad5.u() (jlc.b)', () => {
    expect([light.countAddText, light.countDelText]).toEqual(['#006300', '#8E2626'])
    expect([dark.countAddText, dark.countDelText]).toEqual(['#0CA30C', '#EC7E7E'])
  })

  it('draws the +A -R chip of a tool row on ad5.J()/f0() and ad5.h()/s() (ra20.a, ra20.java:92-93)', () => {
    // f0() and s() are vqv.c(857644604), (858969931), (869081172) and (872361046): 0x33 alpha, 20%.
    expect(light.chipAddText).toBe('#1E9E3C')
    expect(light.chipAddFill).toBe('rgba(30, 158, 60, 0.2)')
    expect(light.chipDelText).toBe('#CD2054')
    expect(light.chipDelFill).toBe('rgba(205, 32, 84, 0.2)')
    expect(dark.chipAddText).toBe('#32D74B')
    expect(dark.chipAddFill).toBe('rgba(50, 215, 75, 0.2)')
    expect(dark.chipDelText).toBe('#FF2C56')
    expect(dark.chipDelFill).toBe('rgba(255, 44, 86, 0.2)')
  })

  it('rests every pill on pl7.p with a pl7.v hairline (jc20.c defaults, jc20.java:538)', () => {
    expect(light.surface).toBe('#FFFFFF')
    expect(dark.surface).toBe('#20201F')
    // pl7.v is #1E1E1D at 40% in light and #E1E0D9 at 40% in dark.
    expect(light.border).toBe('rgba(30, 30, 29, 0.4)')
    expect(dark.border).toBe('rgba(225, 224, 217, 0.4)')
  })

  it('colours the open, draft and closed pull request by w130.o and the merged one violet (jc20.q)', () => {
    expect([light.prOpen, light.prDraft, light.prClosed]).toEqual(['#006300', '#898781', '#8E2626'])
    expect([dark.prOpen, dark.prDraft, dark.prClosed]).toEqual(['#0CA30C', '#898781', '#EC7E7E'])
    // Merged: fill ad5.i0(), border ad5.a0(), text and icon ad5.T().
    expect([light.mergedFill, light.mergedBorder, light.mergedText]).toEqual(['#DFDBFD', '#B0A7F2', '#4A3AA7'])
    expect([dark.mergedFill, dark.mergedBorder, dark.mergedText]).toEqual(['#1D1649', '#322777', '#A096EB'])
  })

  it('colours a queued pull request by ad5.W(), ad5.c() and ad5.m() (jc20.q, zko)', () => {
    expect([light.queuedFill, light.queuedBorder, light.queuedText]).toEqual(['#F9DCA4', '#EDA100', '#734500'])
    expect([dark.queuedFill, dark.queuedBorder, dark.queuedText]).toEqual(['#311A00', '#512E00', '#DB9300'])
  })

  it('colours the CI dot by ad5.e0(), ad5.G() and ad5.y() (jc20.l); pending is a spinner in the pill text', () => {
    for (const palette of [light, dark]) {
      expect(palette.ciPassed).toBe('#009300')
      expect(palette.ciFailed).toBe('#D03B3B')
      expect(palette.ciUnavailable).toBe('#898781')
    }
  })

  it('writes the grey of an open pull request’s number and CI label as ad5.y() in both schemes', () => {
    expect(light.pillText).toBe('#898781')
    expect(dark.pillText).toBe('#898781')
  })

  // 1.261013.20: the session bar's outputs pill (artifacts, pull requests, plan) rests on ad5.n0()
  // with no hairline and draws its glyph and count in ad5.x0() (u8z.t, u8z.java:4781; r3z case 1).
  // n0 is z79.c / z79.u, x0 is z79.q / z79.j (w55 light, v55 dark).
  it('draws the outputs pill on ad5.n0() and its glyph and count in ad5.x0() (u8z.t, r3z)', () => {
    expect([light.outputsFill, light.outputsInk]).toEqual(['#FFFFFF', '#52514E'])
    expect([dark.outputsFill, dark.outputsInk]).toEqual(['#20201F', '#C3C2B7'])
  })
})
