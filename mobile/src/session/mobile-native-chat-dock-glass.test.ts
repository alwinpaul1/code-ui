import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 2026-09-20: "a black line above the tools". The dock — the Working/Tools
// strip and the ground under the composer — draws NOTHING behind itself,
// as it had since 2026-09-13 (0a8642a6): a translucent ground read as a line
// above the Working row on the device that day, the opaque page-coloured
// ground added on 2026-09-19 read as a hard edge over scrolled rows, and the
// translucent one put back on 2026-09-20 read as the line again. A source pin
// on the style block, since the styles module needs React Native to load.
describe('the composer dock', () => {
  it('draws no ground of its own', () => {
    const source = readFileSync(new URL('./mobile-native-chat-view-styles.ts', import.meta.url), 'utf8')
    const dock = /\n\s*dock:\s*\{[\s\S]*?\n\s*\}/.exec(source)?.[0] ?? ''
    expect(dock.length).toBeGreaterThan(0)
    // The property line itself, not the comment that tells the history.
    expect(dock).not.toMatch(/\n\s*backgroundColor:/)
    expect(dock).not.toMatch(/\n\s*borderTop/)
  })
})

// 2026-09-20, keyboard open on the device: a swipe begun on the row above the
// composer did nothing. With no ground the list shows through that row and
// reads as list, but the dock caught the touch. Pinned on the source: the
// dock and the chrome row let touches through where they draw nothing.
describe('touches on the dock’s empty parts', () => {
  it('reach the list', () => {
    const view = readFileSync(new URL('./MobileNativeChatView.tsx', import.meta.url), 'utf8')
    const dock = /<View\s+style=\{\[styles\.dock[\s\S]*?>/.exec(view)?.[0] ?? ''
    expect(dock).toMatch(/pointerEvents="box-none"/)
    const row = readFileSync(new URL('./MobileNativeChatChromeRow.tsx', import.meta.url), 'utf8')
    expect(row).toMatch(/<View style=\{styles\.chromeRow\} pointerEvents="box-none">/)
  })
})
