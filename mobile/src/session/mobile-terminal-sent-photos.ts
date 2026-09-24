import { sentPromptRowsFromScreen } from './mobile-terminal-sent-prompts'

/** A message Claude accepted, by the text of its `❯` row, and how many photos
 *  Claude painted with it. */
export type ScreenSentPhotos = { prompt: string; photos: number }

/** The first photo, at column 0. */
const FIRST_PHOTO_ROW = /^\[Image #\d+\]$/
/** Each further photo, on a `⎿` row: two spaces, the hook, a space and a
 *  no-break space before the marker. */
const MORE_PHOTO_ROW = /^\s+⎿[\s\u00a0]+\[Image #\d+\]$/

/**
 * How many photos each message Claude has accepted carried, read off its own
 * screen.
 *
 * A photo sent from the Claude app reaches Claude Code inline, as image data
 * with no path. Orca's reader keeps an image block only when it has a path or
 * a URL, so the row the phone gets holds the words and no sign of the photo,
 * while the terminal and the VS Code extension both show it (the user,
 * 2026-09-24). Claude Code paints one marker row per photo directly above the
 * message's `❯` row. Captured with `tmux capture-pane -p` from Claude Code
 * 2.1.281 (fixtures/claude-screen-sent-photos-2.1.281.txt), one photo, then two:
 *
 *     [Image #1]
 *
 *     ❯ See this photo from the Claude app please
 *
 *     ⏺ Got the photo.
 *
 *     [Image #1]
 *       ⎿  [Image #1]
 *
 *     ❯ Two photos here, what do you think
 *
 * The first marker is at column 0 and every further one on a `⎿` row, with at
 * most one blank row between them and the message. A group that does not
 * start at column 0 is refused: a photo pasted in the terminal paints its `⎿`
 * row UNDER its own message, which is also directly above the next one. Those
 * pasted photos carry `[Image #N]` in their text, which the phone already
 * draws (mobile-desktop-image-placeholders.ts), so only rows above are read.
 *
 * This reads the screen, so it only sees a message while Claude has it on
 * screen; mobile-native-chat-sent-photos.ts remembers what it saw.
 */
export function sentPhotosFromScreen(screen: readonly string[]): ScreenSentPhotos[] {
  const found: ScreenSentPhotos[] = []
  for (const row of sentPromptRowsFromScreen(screen)) {
    const photos = photosAbove(screen, row.index)
    if (photos > 0) {
      found.push({ prompt: row.text, photos })
    }
  }
  return found
}

function photosAbove(screen: readonly string[], promptIndex: number): number {
  const rowAt = (index: number) => (screen[index] ?? '').trimEnd()
  let index = promptIndex - 1
  if (index >= 0 && rowAt(index) === '') {
    index -= 1
  }
  let photos = 0
  while (index >= 0 && MORE_PHOTO_ROW.test(rowAt(index))) {
    photos += 1
    index -= 1
  }
  return index >= 0 && FIRST_PHOTO_ROW.test(rowAt(index)) ? photos + 1 : 0
}
