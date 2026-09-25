import { describe, expect, it } from 'vitest'
import {
  detectFilePathSegments,
  isFilePathCodeSpan,
  normalizeFilePath,
  splitFilePathLineSuffix
} from './markdown-file-path-detection'

describe('detectFilePathSegments', () => {
  it('returns a single text segment when there is no path', () => {
    expect(detectFilePathSegments('just some prose here')).toEqual([
      { type: 'text', value: 'just some prose here' }
    ])
  })

  it('detects a relative source path with surrounding prose', () => {
    const segments = detectFilePathSegments('Edit src/app/Main.tsx now')
    expect(segments).toEqual([
      { type: 'text', value: 'Edit ' },
      { type: 'file', value: 'src/app/Main.tsx', path: 'src/app/Main.tsx' },
      { type: 'text', value: ' now' }
    ])
  })

  it('strips a leading ./ in the path but keeps the displayed value', () => {
    const segments = detectFilePathSegments('see ./lib/x.ts')
    expect(segments).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'file', value: './lib/x.ts', path: 'lib/x.ts' }
    ])
  })

  it('keeps ../ parent-relative paths intact', () => {
    const segments = detectFilePathSegments('../shared/util.ts')
    expect(segments).toEqual([
      { type: 'file', value: '../shared/util.ts', path: '../shared/util.ts' }
    ])
  })

  it('detects multiple paths in one run', () => {
    const segments = detectFilePathSegments('a/b.ts and c/d/e.json')
    expect(segments.filter((s) => s.type === 'file')).toEqual([
      { type: 'file', value: 'a/b.ts', path: 'a/b.ts' },
      { type: 'file', value: 'c/d/e.json', path: 'c/d/e.json' }
    ])
  })

  it('detects Windows relative, drive, and UNC paths', () => {
    const segments = detectFilePathSegments(
      String.raw`Edit src\app\Main.tsx, C:\repo\config.json, and \\server\share\docs\readme.md`
    )

    expect(segments.filter((segment) => segment.type === 'file')).toEqual([
      { type: 'file', value: String.raw`src\app\Main.tsx`, path: String.raw`src\app\Main.tsx` },
      {
        type: 'file',
        value: String.raw`C:\repo\config.json`,
        path: String.raw`C:\repo\config.json`
      },
      {
        type: 'file',
        value: String.raw`\\server\share\docs\readme.md`,
        path: String.raw`\\server\share\docs\readme.md`
      }
    ])
  })

  it('detects POSIX absolute paths', () => {
    expect(detectFilePathSegments('Wrote /Users/me/wt/src/app.tsx today')).toEqual([
      { type: 'text', value: 'Wrote ' },
      { type: 'file', value: '/Users/me/wt/src/app.tsx', path: '/Users/me/wt/src/app.tsx' },
      { type: 'text', value: ' today' }
    ])
    expect(detectFilePathSegments('/repo/src/index.ts')).toEqual([
      { type: 'file', value: '/repo/src/index.ts', path: '/repo/src/index.ts' }
    ])
    expect(detectFilePathSegments('/root.ts')).toEqual([
      { type: 'file', value: '/root.ts', path: '/root.ts' }
    ])
  })

  it('detects files directly under explicit Windows and relative roots', () => {
    expect(detectFilePathSegments(String.raw`C:\root.ts`)).toEqual([
      { type: 'file', value: String.raw`C:\root.ts`, path: String.raw`C:\root.ts` }
    ])
    expect(detectFilePathSegments('./root.ts')).toEqual([
      { type: 'file', value: './root.ts', path: 'root.ts' }
    ])
    expect(detectFilePathSegments('../root.ts')).toEqual([
      { type: 'file', value: '../root.ts', path: '../root.ts' }
    ])
  })

  it('detects paths with :line and :line:col suffixes', () => {
    expect(detectFilePathSegments('see src/foo.ts:42 here')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'file', value: 'src/foo.ts:42', path: 'src/foo.ts:42' },
      { type: 'text', value: ' here' }
    ])
    expect(
      detectFilePathSegments('/wt/src/app.tsx:120:7 and C:\\repo\\a.ts:3').filter(
        (s) => s.type === 'file'
      )
    ).toEqual([
      { type: 'file', value: '/wt/src/app.tsx:120:7', path: '/wt/src/app.tsx:120:7' },
      { type: 'file', value: 'C:\\repo\\a.ts:3', path: 'C:\\repo\\a.ts:3' }
    ])
  })

  it('keeps a non-line colon tail out of the match', () => {
    expect(detectFilePathSegments('edit src/foo.ts: then run')).toEqual([
      { type: 'text', value: 'edit ' },
      { type: 'file', value: 'src/foo.ts', path: 'src/foo.ts' },
      { type: 'text', value: ': then run' }
    ])
  })

  it('does not partially parse numeric-looking non-line tails', () => {
    expect(detectFilePathSegments('log src/app.ts:1e3 oops')).toEqual([
      { type: 'text', value: 'log ' },
      { type: 'file', value: 'src/app.ts', path: 'src/app.ts' },
      { type: 'text', value: ':1e3 oops' }
    ])
    expect(detectFilePathSegments('coverage src/app.ts:80% of lines')).toEqual([
      { type: 'text', value: 'coverage ' },
      { type: 'file', value: 'src/app.ts', path: 'src/app.ts' },
      { type: 'text', value: ':80% of lines' }
    ])
  })

  it('does not match bare filenames without a slash', () => {
    expect(detectFilePathSegments('open Main.tsx please')).toEqual([
      { type: 'text', value: 'open Main.tsx please' }
    ])
  })

  it('does not match URLs', () => {
    expect(detectFilePathSegments('https://example.com/path/file.ts')).toEqual([
      { type: 'text', value: 'https://example.com/path/file.ts' }
    ])
    expect(detectFilePathSegments('see https://example.com/path/file.ts:42 now')).toEqual([
      { type: 'text', value: 'see https://example.com/path/file.ts:42 now' }
    ])
  })

  it('does not match protocol-relative URLs', () => {
    expect(detectFilePathSegments('load //cdn.example.com/lib/app.js')).toEqual([
      { type: 'text', value: 'load //cdn.example.com/lib/app.js' }
    ])
  })

  it('does not match version numbers', () => {
    expect(detectFilePathSegments('upgraded to 1.2.3 today')).toEqual([
      { type: 'text', value: 'upgraded to 1.2.3 today' }
    ])
  })

  // 2026-09-25, the user: "if a file like md or pdf or text is created when
  // the user clicks this files on chatui open that corresponding file". A PDF
  // usually comes from a command, not a Write, so the reply naming it is the
  // only place it shows, and the viewer can draw a PDF and a picture.
  it('links a PDF, a picture or a data file the agent names in its reply', () => {
    for (const path of ['docs/report.pdf', 'out/chart.png', 'shots/home.JPG', 'data/rows.csv', 'logs/run.log']) {
      expect(detectFilePathSegments(`Saved it to ${path} for you.`)).toEqual([
        { type: 'text', value: 'Saved it to ' },
        { type: 'file', value: path, path },
        { type: 'text', value: ' for you.' }
      ])
      expect(isFilePathCodeSpan(path.split('/').pop()!)).toBe(!path.endsWith('.log'))
    }
  })

  // The second review of cd562b81: an image or PDF address without its
  // scheme ends in exactly the extensions that commit added, and read as a
  // file the host would then fail to find.
  it('leaves a web address without https:// as text, not a file that cannot open', () => {
    for (const address of ['i.imgur.com/abc123.png', 'example.com/report.pdf', 'www.example.com/a.jpg', 'docs.github.io/guide.md']) {
      expect(detectFilePathSegments(`See ${address} here`)).toEqual([{ type: 'text', value: `See ${address} here` }])
      expect(isFilePathCodeSpan(address)).toBe(false)
    }
    expect(detectFilePathSegments('in src.old/app.ts')).toEqual([
      { type: 'text', value: 'in ' },
      { type: 'file', value: 'src.old/app.ts', path: 'src.old/app.ts' }
    ])
  })

  it('does not match unknown extensions', () => {
    expect(detectFilePathSegments('path/to/thing.whatever')).toEqual([
      { type: 'text', value: 'path/to/thing.whatever' }
    ])
  })

  it('detects scoped-package file paths with a segment-leading @', () => {
    expect(detectFilePathSegments('open @types/react/index.d.ts here')).toEqual([
      { type: 'text', value: 'open ' },
      {
        type: 'file',
        value: '@types/react/index.d.ts',
        path: '@types/react/index.d.ts'
      },
      { type: 'text', value: ' here' }
    ])
    expect(
      detectFilePathSegments('node_modules/@scope/pkg/file.ts').filter((s) => s.type === 'file')
    ).toEqual([
      {
        type: 'file',
        value: 'node_modules/@scope/pkg/file.ts',
        path: 'node_modules/@scope/pkg/file.ts'
      }
    ])
  })

  it('does not match emails or git URLs with a mid-token @', () => {
    expect(detectFilePathSegments('clone git@github.com:user/repo.git')).toEqual([
      { type: 'text', value: 'clone git@github.com:user/repo.git' }
    ])
    expect(detectFilePathSegments('open user@host.com/path/file.txt')).toEqual([
      { type: 'text', value: 'open user@host.com/path/file.txt' }
    ])
  })

  it('returns a single text segment when the run has no dot', () => {
    const text = 'a/'.repeat(8192)
    expect(detectFilePathSegments(text)).toEqual([{ type: 'text', value: text }])
  })

  it('skips detection for runs over the length cap even with dots', () => {
    // 'a.b/'-repeats pass the dot precheck, so this exercises the length cap that
    // bounds CANDIDATE_PATTERN's worst-case backtracking.
    const text = 'a.b/'.repeat(2000)
    expect(detectFilePathSegments(text)).toEqual([{ type: 'text', value: text }])
  })

  it('still detects a path in a long-but-under-cap run', () => {
    const prefix = 'context '.repeat(200)
    const segments = detectFilePathSegments(`${prefix}src/app/Main.tsx`)
    expect(segments.filter((s) => s.type === 'file')).toEqual([
      { type: 'file', value: 'src/app/Main.tsx', path: 'src/app/Main.tsx' }
    ])
  })
})

describe('isFilePathCodeSpan', () => {
  it('accepts a slashed path code span', () => {
    expect(isFilePathCodeSpan('src/app/Main.tsx')).toBe(true)
  })

  it('accepts Windows paths in code spans', () => {
    expect(isFilePathCodeSpan(String.raw`src\app\Main.tsx`)).toBe(true)
    expect(isFilePathCodeSpan(String.raw`C:\repo\Main.tsx`)).toBe(true)
    expect(isFilePathCodeSpan(String.raw`\\server\share\Main.tsx`)).toBe(true)
  })

  it('accepts a bare filename code span', () => {
    expect(isFilePathCodeSpan('package.json')).toBe(true)
  })

  it('rejects multi-word code spans', () => {
    expect(isFilePathCodeSpan('npm run build')).toBe(false)
  })

  // The second review of cd562b81: with `log` known, `console.log` in an
  // agent's reply became a link that failed with "Couldn't open console.log".
  // `process.env` had done the same since `env` joined the list.
  it('leaves a method call or property read as code, but links the same name in a folder', () => {
    for (const code of ['console.log', 'Math.log', 'np.log', 'logger.log', 'process.env', 'import.meta.env']) {
      expect(isFilePathCodeSpan(code)).toBe(false)
    }
    expect(isFilePathCodeSpan('logs/run.log')).toBe(true)
    expect(isFilePathCodeSpan('config/app.env')).toBe(true)
    expect(isFilePathCodeSpan('package.json')).toBe(true)
  })

  it('rejects non-file code spans', () => {
    expect(isFilePathCodeSpan('someVariable')).toBe(false)
  })

  it('rejects urls in code spans', () => {
    expect(isFilePathCodeSpan('https://x.com/a.ts')).toBe(false)
  })

  it('accepts scoped-package paths with a segment-leading @', () => {
    expect(isFilePathCodeSpan('@types/react/index.d.ts')).toBe(true)
    expect(isFilePathCodeSpan('node_modules/@scope/pkg/file.ts')).toBe(true)
  })

  it('accepts POSIX absolute paths and :line citations', () => {
    expect(isFilePathCodeSpan('/Users/me/wt/src/app.tsx')).toBe(true)
    expect(isFilePathCodeSpan('src/foo.ts:42')).toBe(true)
    expect(isFilePathCodeSpan('src/foo.ts:42:7')).toBe(true)
    expect(isFilePathCodeSpan('MobileNativeChatComposer.tsx:23')).toBe(true)
    expect(isFilePathCodeSpan(String.raw`C:\repo\Main.tsx:12`)).toBe(true)
  })

  it('rejects emails and git URLs with a mid-token @', () => {
    expect(isFilePathCodeSpan('git@github.com:user/repo.git')).toBe(false)
    expect(isFilePathCodeSpan('user@host.com/path/file.txt')).toBe(false)
  })
})

describe('splitFilePathLineSuffix', () => {
  it('splits :line and :line:col suffixes', () => {
    expect(splitFilePathLineSuffix('src/foo.ts:42')).toEqual({
      path: 'src/foo.ts',
      line: 42,
      column: null
    })
    expect(splitFilePathLineSuffix('src/foo.ts:42:7')).toEqual({
      path: 'src/foo.ts',
      line: 42,
      column: 7
    })
  })

  it('keeps Windows drive colons intact', () => {
    expect(splitFilePathLineSuffix(String.raw`C:\repo\a.ts`)).toEqual({
      path: String.raw`C:\repo\a.ts`,
      line: null,
      column: null
    })
    expect(splitFilePathLineSuffix(String.raw`C:\repo\a.ts:12`)).toEqual({
      path: String.raw`C:\repo\a.ts`,
      line: 12,
      column: null
    })
  })

  it('ignores non-numeric and zero suffixes', () => {
    expect(splitFilePathLineSuffix('src/foo.ts')).toEqual({
      path: 'src/foo.ts',
      line: null,
      column: null
    })
    expect(splitFilePathLineSuffix('src/foo.ts:0')).toEqual({
      path: 'src/foo.ts:0',
      line: null,
      column: null
    })
  })
})

describe('normalizeFilePath', () => {
  it('strips a leading ./', () => {
    expect(normalizeFilePath('./a/b.ts')).toBe('a/b.ts')
    expect(normalizeFilePath(String.raw`.\a\b.ts`)).toBe(String.raw`a\b.ts`)
  })

  it('leaves other paths unchanged', () => {
    expect(normalizeFilePath('../a/b.ts')).toBe('../a/b.ts')
    expect(normalizeFilePath('a/b.ts')).toBe('a/b.ts')
  })
})
