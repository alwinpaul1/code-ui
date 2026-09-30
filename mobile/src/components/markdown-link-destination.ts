/**
 * A link's destination without its title: `https://x.dev "The docs"` is
 * `https://x.dev`. The one reading for what a link opens and what a Copy
 * pastes, in a chat reply (routeMarkdownHref, markdown-plain-text.ts) and in
 * a PR comment (parseInline). A chat link opened its address with the title
 * glued on while the Copy left it out, and a PR comment link did the same
 * (review, 2026-09-30).
 *
 * Only a quoted title comes off: after a space, in double or single quotes,
 * a backslash escaping a quote inside it, and ending the address. The link on
 * screen opens an address with a space in it whole, so an address with a
 * space and no quoted title stays whole. A title in parentheses, which
 * CommonMark also allows, stays too: a file an agent links often has one in
 * its name, `Screenshot (2).png`, and taking it off would open another file.
 * (An `<…>` destination never gets here: the preview's HTML cleanup takes it
 * for a tag first, on screen too.)
 */
export function markdownLinkDestination(href: string): string {
  const text = href.trim()
  const start = titleStart(text)
  return start === -1 ? text : text.slice(0, start).trimEnd()
}

/**
 * Where the quoted title that ends `text` opens, or -1. What
 * `/\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/` matches, read in one pass:
 * that regex tried every space of a long run in turn, so an address with
 * 100,000 spaces in it cost the square of that on every Copy.
 *
 * An opener's title runs to the first quote no backslash escapes. If that is
 * not the last character, no opener before it can end there either, and the
 * next one to try is that quote itself.
 */
function titleStart(text: string): number {
  const last = text.length - 1
  const quote = text[last]
  if (quote !== '"' && quote !== "'") {
    return -1
  }
  let at = text.indexOf(quote)
  while (at !== -1 && at < last) {
    if (at === 0 || !/\s/.test(text[at - 1]!)) {
      at = text.indexOf(quote, at + 1)
      continue
    }
    let end = at + 1
    while (end < last && text[end] !== quote) {
      end += text[end] === '\\' ? 2 : 1
    }
    if (end === last) {
      return at
    }
    at = end
  }
  return -1
}
