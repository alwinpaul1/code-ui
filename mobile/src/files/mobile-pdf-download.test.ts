import { describe, expect, it, vi } from 'vitest'
import { downloadMobilePdf, type MobilePdfDownloadDeps } from './mobile-pdf-download'

function deps(overrides: Partial<MobilePdfDownloadDeps> = {}): MobilePdfDownloadDeps {
  return {
    createDocument: vi.fn(async () => 'content://downloads/42'),
    readBase64: vi.fn(async () => 'JVBERi0xLjQK'),
    writeBase64: vi.fn(async () => {}),
    ...overrides
  }
}

describe('downloading a previewed PDF', () => {
  it('offers the file under its own name and writes the cached bytes where the user picked', async () => {
    const d = deps()
    const outcome = await downloadMobilePdf(
      { uri: 'file:///cache/orca-pdf-1a2b.pdf', fileName: 'thesis-draft.pdf' },
      d
    )
    expect(outcome).toBe('saved')
    expect(d.createDocument).toHaveBeenCalledWith('thesis-draft.pdf')
    expect(d.readBase64).toHaveBeenCalledWith('file:///cache/orca-pdf-1a2b.pdf')
    expect(d.writeBase64).toHaveBeenCalledWith('content://downloads/42', 'JVBERi0xLjQK')
  })

  it('reports cancelled, and writes nothing, when the picker is dismissed', async () => {
    const d = deps({ createDocument: vi.fn(async () => null) })
    expect(await downloadMobilePdf({ uri: 'file:///c.pdf', fileName: 'a.pdf' }, d)).toBe('cancelled')
    expect(d.writeBase64).not.toHaveBeenCalled()
  })

  it('saves a PDF the viewer only holds as a data URI without reading any file', async () => {
    const d = deps()
    const outcome = await downloadMobilePdf(
      { uri: 'data:application/pdf;base64,JVBERi0xLjQK', fileName: 'inline.pdf' },
      d
    )
    expect(outcome).toBe('saved')
    expect(d.readBase64).not.toHaveBeenCalled()
    expect(d.writeBase64).toHaveBeenCalledWith('content://downloads/42', 'JVBERi0xLjQK')
  })

  it('always suggests a .pdf name, even for a path with no extension', async () => {
    const d = deps()
    await downloadMobilePdf({ uri: 'file:///c.pdf', fileName: 'report' }, d)
    expect(d.createDocument).toHaveBeenCalledWith('report.pdf')
    await downloadMobilePdf({ uri: 'file:///c.pdf', fileName: 'docs/out/Report.PDF' }, d)
    expect(d.createDocument).toHaveBeenLastCalledWith('Report.PDF')
  })

  it('reports failed when the write throws', async () => {
    const d = deps({ writeBase64: vi.fn(async () => { throw new Error('EACCES') }) })
    expect(await downloadMobilePdf({ uri: 'file:///c.pdf', fileName: 'a.pdf' }, d)).toBe('failed')
  })
})
