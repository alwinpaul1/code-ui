/**
 * Agents summarise their turn in Markdown; Android notifications take plain
 * strings and render none of it, so "**Done** — fixed `foo`" showed its
 * asterisks and backticks. There is no styled-text API in expo-notifications,
 * but the shade renders any Unicode, so emphasis is carried by the
 * Mathematical Alphanumeric letterforms: **bold** → 𝗯𝗼𝗹𝗱, *italic* → 𝘪𝘵𝘢𝘭𝘪𝘤,
 * `code` → 𝚌𝚘𝚍𝚎. Only ASCII letters and digits have such forms; anything else
 * is kept as typed. Headings read as bold, list markers become "•", links keep
 * their visible text, and blank-line runs collapse.
 */
export function notificationPlainText(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(```+|~~~+)[^\n]*$/, '')
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/, (_, text: string) => styleText(text, 'bold'))
        .replace(/^(\s*)[*\-+]\s+/, '$1• ')
        .replace(/^\s*>\s?/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, (_, text: string) => styleText(text, 'mono'))
        .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) =>
          styleText(text, 'bolditalic')
        )
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) => styleText(text, 'bold'))
        .replace(/(^|[^\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/(^|[^\w_])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        .replace(/^\s*([-*_]\s*){3,}$/, '')
        .replace(/^\s*\|?(\s*:?-+:?\s*\|)+\s*$/, '')
        .replace(/\s+$/, '')
    )
    .filter(
      (line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]!.trim() !== '')
    )
  return lines.join('\n').trim()
}

type TextStyle = 'bold' | 'italic' | 'bolditalic' | 'mono'

// Code points of the first glyph ("A", "a", "0") in each Mathematical
// Alphanumeric block. Sans-serif faces match the shade's own typeface.
const STYLE_BASES: Record<TextStyle, { upper: number; lower: number; digit: number | null }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  bolditalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
  mono: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 }
}

export function styleText(text: string, style: TextStyle): string {
  const base = STYLE_BASES[style]
  let out = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(base.upper + code - 0x41)
    } else if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCodePoint(base.lower + code - 0x61)
    } else if (code >= 0x30 && code <= 0x39 && base.digit !== null) {
      out += String.fromCodePoint(base.digit + code - 0x30)
    } else {
      out += char
    }
  }
  return out
}
