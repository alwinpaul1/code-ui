// Mirror of src/shared/agent-image-paste.test.ts (Orca e7da72c3d). This fork's
// gate runs only mobile/src, so the vendored shared test is never collected;
// the phone's clipboard and picker paths go through formatAgentImagePath and
// these are the cases that decide what an OMP tab receives.
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { formatAgentImagePath } from '../../../src/shared/agent-image-paste'

describe('OMP image references', () => {
  it.each([
    ['/tmp/screen@2x.png', '@"/tmp/screen@2x.png"'],
    ['/tmp/a "quote".png', `@'/tmp/a "quote".png'`],
    ["/tmp/a 'quote'.png", `@"/tmp/a 'quote'.png"`],
    ['C:\\Images\\screen shot.png', '@"C:\\Images\\screen shot.png"']
  ])('quotes %s for file-mention parsing', (path, expected) => {
    expect(formatAgentImagePath('omp', path)).toBe(expected)
    expect(formatAgentImagePath('claude', path)).toBe(path)
  })

  it.each([
    `/tmp/a "both' quotes.png`,
    `/tmp/a "both' quotes/image.png`,
    `/tmp/a "both' @quotes#100%.png`,
    `/tmp/a "both' \\quotes.png`,
    `C:\\Images\\a "both' quotes.png`,
    `\\\\server\\share\\a "both' quotes.png`
  ])('round trips unquotable absolute paths through OMP file URLs: %s', (path) => {
    const mention = formatAgentImagePath('omp', path)
    const encodedPath = /^@"([^"]+)"$/.exec(mention)?.[1]
    expect(encodedPath).toBeDefined()
    expect(fileURLToPath(encodedPath!, { windows: !path.startsWith('/') })).toBe(path)
    expect(formatAgentImagePath('claude', path)).toBe(path)
  })
})
