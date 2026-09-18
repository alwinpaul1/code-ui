/** Appends a mention token (an `@file` reference, say) to draft text: a
 *  trailing space after it always, and — only when the draft already has
 *  something in it — one separating space before it, so the mention never
 *  runs into the user's own words. */
export function appendMentionToDraftText(current: string, mention: string): string {
  return current.length > 0 ? `${current} ${mention} ` : `${mention} `
}
