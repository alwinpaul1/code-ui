/**
 * A prompt as Claude Code PAINTS it, for comparing a row read off the screen
 * with the text that was typed.
 *
 * Claude Code renders a prompt's markdown when it draws it — in the queue box
 * and as the transcript echo — so inline code loses its backticks: typed
 * "written as a `user` row", painted "written as a user row" (queue box on
 * Claude Code 2.1.278 at 46 columns, 2026-09-19; the rows are in
 * use-absorbed-queue-echoes.test.ts). Every comparison of a drawn row against
 * a typed message keyed on the typed characters, so a send with inline code
 * was never recognised as its own row: it stood as a bubble and a queue row
 * while queued, and once absorbed came back as a second bubble built from the
 * painted rows, with "Image on Desktop" chips for photos the phone itself had
 * sent (device, 2026-09-19).
 *
 * Applied to BOTH sides of a comparison, so it does not matter which side was
 * typed. It is a key, never shown: the bubble keeps the backticks the author
 * wrote. Only backticks are known to go; bold and the rest were not verified
 * and are left alone.
 */
export function asPaintedPrompt(text: string): string {
  return text.replace(/`/g, '')
}
