/**
 * Agents summarise their turn in Markdown; Android notifications render none
 * of it, so "**Done** — fixed `foo`" shows its asterisks and backticks. Strip
 * the markup and keep the words. Bullets become "•" so a list still reads as
 * one, and blank lines collapse: a notification body is a few lines at most.
 */
export function notificationPlainText(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        // Fenced code markers and heading hashes carry no words of their own.
        .replace(/^\s*(```+|~~~+)[^\n]*$/, '')
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        // "* item", "- item", "+ item" → "• item"; "1. item" keeps its number.
        .replace(/^(\s*)[*\-+]\s+/, '$1• ')
        // Block quotes.
        .replace(/^\s*>\s?/, '')
        // Links and images keep their visible text.
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Inline code, bold, italic, strikethrough: drop the markers only.
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        // Horizontal rules and table rules are noise in a notification.
        .replace(/^\s*([-*_]\s*){3,}$/, '')
        .replace(/^\s*\|?(\s*:?-+:?\s*\|)+\s*$/, '')
        .replace(/\s+$/, '')
    )
    .filter((line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]!.trim() !== ''))
  return lines.join('\n').trim()
}
