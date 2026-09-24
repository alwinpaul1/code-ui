import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { SENT_PHOTO_REF } from './mobile-desktop-prompt-images'
import { rememberScreenSentPhotos, withScreenSentPhotos } from './mobile-native-chat-sent-photos'
import { sentPhotosFromScreen } from './mobile-terminal-sent-photos'

// Captured with `tmux capture-pane -p` from Claude Code 2.1.281 (2026-09-24),
// resuming a session whose user rows carry inline image blocks the way the
// Claude app sends them: one photo, then two, then one pasted in the terminal.
const screen = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-sent-photos-2.1.281.txt', import.meta.url)),
  'utf8'
).split('\n')

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function photoCount(message: NativeChatMessage | undefined): number {
  return message?.blocks.filter((block) => block.type === 'image-ref' && block.path === SENT_PHOTO_REF).length ?? 0
}

// 2026-09-24, the user: the terminal and the VS Code extension both show that
// a message from the Claude app had photos; Code UI drew the words alone.
// Orca's reader drops an inline photo without a trace, so the screen's
// `[Image #N]` rows are the phone's only witness.
describe('photos sent from the Claude app, read off the terminal', () => {
  it('counts the photos Claude Code paints above each message', () => {
    expect(sentPhotosFromScreen(screen)).toEqual([
      { prompt: 'See this photo from the Claude app please', photos: 1 },
      { prompt: 'Two photos here, what do you think', photos: 2 }
    ])
  })

  it('leaves a photo pasted in the terminal to the marker in its own text', () => {
    const prompts = sentPhotosFromScreen(screen).map((entry) => entry.prompt)
    expect(prompts).not.toContain('[Image #1] pasted in the terminal')
  })

  it('reads nothing from an empty screen or one with no composer to bound it', () => {
    expect(sentPhotosFromScreen([])).toEqual([])
    const noComposer = screen.filter((row) => row !== '❯\u00a0')
    expect(noComposer.length).toBe(screen.length - 1)
    expect(sentPhotosFromScreen(noComposer)).toEqual([])
  })

  it('does not hand a message the photo row that belongs to the one above it', () => {
    // A pasted photo's `⎿` row, then straight into the next message with no
    // reply between: the row is not the next message's.
    const stacked = ['❯ first [Image #1]', '  ⎿  [Image #1]', '', '❯ second message', '', '❯ ']
    expect(sentPhotosFromScreen(stacked)).toEqual([])
  })

  it('counts a single marker row with no blank row before the message', () => {
    expect(sentPhotosFromScreen(['[Image #3]', '❯ tight layout', '', '❯ '])).toEqual([
      { prompt: 'tight layout', photos: 1 }
    ])
  })
})

describe('the photo placeholders a Claude-app message gets in the chat', () => {
  const messages = [
    user('u1', 'See this photo from the Claude app please'),
    user('u2', 'Two photos here, what do you think'),
    user('u3', 'No photos on this one')
  ]

  it('puts one Photo chip per photo above the words, on the row the screen names', () => {
    const known = rememberScreenSentPhotos(new Map(), messages, sentPhotosFromScreen(screen))
    const drawn = withScreenSentPhotos(messages, known)
    expect(drawn.map(photoCount)).toEqual([1, 2, 0])
    expect(drawn[0]!.blocks[0]).toEqual({ type: 'image-ref', path: SENT_PHOTO_REF })
    expect(drawn[0]!.blocks.at(-1)).toEqual({ type: 'text', text: 'See this photo from the Claude app please' })
  })

  it('keeps the chips once the message has scrolled off the screen', () => {
    const known = rememberScreenSentPhotos(new Map(), messages, sentPhotosFromScreen(screen))
    const later = rememberScreenSentPhotos(known, messages, [])
    expect(withScreenSentPhotos(messages, later).map(photoCount)).toEqual([1, 2, 0])
  })

  it('matches a long message by the first row the terminal wrapped it to', () => {
    const long = user('u9', 'Look at this long message that the terminal has to wrap onto a second row, twice over')
    const known = rememberScreenSentPhotos(new Map(), [long], [
      { prompt: 'Look at this long message that the terminal has to wrap onto a second', photos: 1 }
    ])
    expect(withScreenSentPhotos([long], known).map(photoCount)).toEqual([1])
  })

  it('refuses when two rows could be the one the screen names', () => {
    const twins = [user('a', 'see this'), user('b', 'see this')]
    const known = rememberScreenSentPhotos(new Map(), twins, [{ prompt: 'see this', photos: 1 }])
    expect(known.size).toBe(0)
  })

  it('adds nothing to a row that already draws its own images', () => {
    const marked: NativeChatMessage = {
      ...user('m', 'See this photo from the Claude app please'),
      blocks: [
        { type: 'image-ref', path: 'desktop-image' },
        { type: 'text', text: 'See this photo from the Claude app please' }
      ]
    }
    const known = rememberScreenSentPhotos(new Map(), [marked], sentPhotosFromScreen(screen))
    expect(known.size).toBe(0)
  })

  it('never touches the agent’s own rows', () => {
    const reply: NativeChatMessage = { ...user('r', 'Two photos here, what do you think'), role: 'assistant' }
    const known = rememberScreenSentPhotos(new Map(), [reply], sentPhotosFromScreen(screen))
    expect(known.size).toBe(0)
  })
})

// A defect of wiring has no behavioural handle here: the parser and the
// matcher can both be right while nothing hands the one to the other. Read
// the code, not its comments.
describe('the screen photos reach the chat', () => {
  const code = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
      .join('\n')

  it('is read on every screen poll, for Claude only', () => {
    expect(code('./use-mobile-terminal-hud-observation.ts')).toMatch(
      /agent === 'claude' \|\| agent === 'openclaude' \? sentPhotosFromScreen\(lines\) : \[\]/
    )
  })

  it('is handed from the controller to the overlay, and drawn there', () => {
    expect(code('./use-mobile-native-chat-controller.ts')).toMatch(
      /nativeChatScreenSentPhotos: activeChatStructured \|\| connState !== 'connected' \? \[\] : screenSentPhotos/
    )
    expect(code('./MobileNativeChatOverlay.tsx')).toMatch(
      /useScreenSentPhotos\(\s*controller\.nativeChatScreenSentPhotos \?\? NO_SENT_PHOTOS,\s*foldedWithoutPhotos,/
    )
  })
})
