import { describe, expect, it } from 'vitest'
import { classifyMobileArtifact } from './mobile-artifact-kind'

describe('classifyMobileArtifact', () => {
  it('classifies raster image extensions (case-insensitive)', () => {
    for (const p of ['a.png', 'b.JPG', 'c/d.jpeg', 'e.gif', 'f.webp', 'g.bmp', 'h.ico']) {
      expect(classifyMobileArtifact(p)).toBe('image')
    }
  })

  it('treats svg as other (RN Image cannot decode svg data URIs; render as source)', () => {
    expect(classifyMobileArtifact('logo.svg')).toBe('other')
  })

  it('classifies html extensions', () => {
    expect(classifyMobileArtifact('index.html')).toBe('html')
    expect(classifyMobileArtifact('a/b/page.HTM')).toBe('html')
  })

  // `README.md` used to be here; markdown now renders as a document, see below.
  it('treats code/text/unknown as other', () => {
    for (const p of ['main.ts', 'data.csv', 'notes', 'x.json']) {
      expect(classifyMobileArtifact(p)).toBe('other')
    }
  })

  it('classifies pdf', () => {
    expect(classifyMobileArtifact('a.pdf')).toBe('pdf')
    expect(classifyMobileArtifact('docs/Paper.PDF')).toBe('pdf')
  })

  it('treats a dotfile or no-extension path as other', () => {
    expect(classifyMobileArtifact('.gitignore')).toBe('other')
    expect(classifyMobileArtifact('Makefile')).toBe('other')
    expect(classifyMobileArtifact('dir/.env')).toBe('other')
  })
})

// 2026-09-15 from the phone: opening CLAUDE.md showed raw markdown, where the
// desktop shows it rendered with a source toggle. A `.md` file is a document,
// not source, and it is the most-read kind of file in this project.
describe('a markdown file', () => {
  it('is classified as markdown, not as plain source', () => {
    expect(classifyMobileArtifact('/Users/x/Code UI/CLAUDE.md')).toBe('markdown')
    expect(classifyMobileArtifact('docs/mobile-agent-hud.markdown')).toBe('markdown')
    expect(classifyMobileArtifact('README.MD')).toBe('markdown')
  })

  it('leaves everything else where it was', () => {
    expect(classifyMobileArtifact('src/index.ts')).toBe('other')
    expect(classifyMobileArtifact('page.html')).toBe('html')
    expect(classifyMobileArtifact('shot.png')).toBe('image')
  })
})
