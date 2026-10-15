import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Which module mounts what is a defect of structure, so these read the code (CLAUDE.md rule 6),
// comments stripped: the long "why" notes in these files would otherwise satisfy every match.
function code(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
}

describe('where the connection row and the rate-limit banner are mounted', () => {
  it('the route builds them and hands them to the chat overlay, with the controller it already holds', () => {
    const route = code('MobileSessionActiveContent.tsx')
    expect(route).toMatch(
      /<MobileNativeChatOverlay[\s\S]*?notices=\{\s*<MobileNativeChatConnectionRow controller=\{controller\} \/>\s*\}[\s\S]*?composerBanner=\{\s*<MobileNativeChatRateLimitBanner controller=\{controller\} \/>\s*\}[\s\S]*?\/>/
    )
  })

  it('the route hands the connection notice to the chat, whose status line draws it on its one line', () => {
    const route = code('MobileSessionActiveContent.tsx')
    expect(route).toMatch(
      /<NativeChatConnectionNoticeProvider controller=\{controller\}>[\s\S]*?<MobileNativeChatOverlay[\s\S]*?<\/NativeChatConnectionNoticeProvider>/
    )
    expect(code('MobileNativeChatConnectionRow.tsx')).toMatch(
      /const notice = connectionNoticeOf\(controller\)\s*return <NativeChatConnectionNoticeContext\.Provider value=\{notice\}>/
    )
    expect(code('MobileNativeChatStatusLine.tsx')).toMatch(/useNativeChatConnectionNotice\(\)/)
  })

  it('the overlay forwards the slot to the chat view untouched', () => {
    const overlay = code('MobileNativeChatOverlay.tsx')
    expect(overlay).toMatch(/notices=\{notices\}/)
    expect(overlay).toMatch(/composerBanner=\{composerBanner\}/)
    expect(overlay).not.toMatch(/MobileNativeChatRateLimitBanner|MobileNativeChatConnectionRow/)
  })

  it('the chat view draws the slot in the dock after the key strip and before the session pills', () => {
    const view = code('MobileNativeChatView.tsx')
    const strip = view.indexOf('<MobileNativeChatKeyStrip')
    const notices = view.indexOf('{notices}')
    const pills = view.indexOf('{sessionPills}')
    expect(strip).toBeGreaterThan(-1)
    expect(notices).toBeGreaterThan(strip)
    expect(pills).toBeGreaterThan(notices)
  })

  it('draws the rate-limit banner inside the composer card, above its attachments and field, as the Claude app does', () => {
    const view = code('MobileNativeChatView.tsx')
    expect(view).toMatch(/<MobileNativeChatComposer[\s\S]*?banner=\{composerBanner\}/)
    const composer = code('MobileNativeChatComposer.tsx')
    const card = composer.indexOf('testID="native-chat-composer"')
    const banner = composer.indexOf('{banner}')
    const chips = composer.indexOf('<MobileNativeChatAttachmentChips')
    expect(card).toBeGreaterThan(-1)
    expect(banner).toBeGreaterThan(card)
    expect(chips).toBeGreaterThan(banner)
  })

  it('the transcript\'s own notice row is not the connection row: it still draws a host-authored block', () => {
    // MobileNativeChatMessage draws compaction rules, plan documents and toned lines with it.
    const transcriptRow = code('MobileNativeChatNoticeRow.tsx')
    expect(transcriptRow).toMatch(/export function MobileNativeChatNoticeRow\(\{\s*block,/)
    expect(code('MobileNativeChatMessage.tsx')).toMatch(/<MobileNativeChatNoticeRow block=/)
    expect(code('MobileNativeChatConnectionRow.tsx')).not.toMatch(/MobileNativeChatNoticeRow/)
  })
})
