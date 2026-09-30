/**
 * An ATX heading's text with its closing run of '#' taken off, as CommonMark
 * 4.2 reads it: the run goes only when a space or tab stands before it, so
 * "Title ##" reads "Title" and "Ported to C#" keeps its '#'. A heading that
 * is nothing but the run is empty.
 *
 * Pass the text after the opening run and its spaces. Three readers carried
 * this rule and each had it wrong: the release notes took the '#' off "C#"
 * (`\s*#*` needs no space before the run), and PR comments and notifications
 * drew a closing "##" as part of the title (review, 2026-09-30).
 *
 * A scan back from the end rather than a regex: the lazy
 * `(.*?)(?:\s+#+)?\s*$` that states the rule walks a run of spaces once per
 * character it tries, 1.9 s for a heading holding 40,000 of them, and the
 * release notes' `(.+?)\s*#*\s*$` did not finish at 20,000. A PR comment
 * body is anybody's text.
 */
export function markdownHeadingText(text: string): string {
  const trimmed = text.trimEnd()
  let run = trimmed.length
  while (run > 0 && trimmed[run - 1] === '#') {
    run -= 1
  }
  if (run === trimmed.length) {
    return trimmed
  }
  if (run === 0) {
    return ''
  }
  const before = trimmed[run - 1]
  if (before !== ' ' && before !== '\t') {
    return trimmed
  }
  return trimmed.slice(0, run).trimEnd()
}
