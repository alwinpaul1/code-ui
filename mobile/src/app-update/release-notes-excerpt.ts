// GitHub's generated release body is Markdown ("## What's Changed", "* fix: … by
// @x in https://…/pull/12", "**Full Changelog**: …"). The card shows a short
// plain-text excerpt; "Read the full release notes" opens the real page.

const MAX_LINES = 4

export function releaseNotesExcerpt(body: string | null | undefined): string[] {
  if (!body) {
    return []
  }
  const lines: string[] = []
  for (const raw of body.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || /^#{1,6}\s/.test(line) || /^\*\*full changelog\*\*/i.test(line)) {
      continue
    }
    if (line.startsWith('<!--')) {
      continue
    }
    line = line
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\s+by\s+@[\w-]+\s+in\s+\S+$/i, '')
      .replace(/\s+in\s+https?:\/\/\S+$/i, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_`]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (line) {
      lines.push(line)
    }
    if (lines.length >= MAX_LINES) {
      break
    }
  }
  return lines
}
