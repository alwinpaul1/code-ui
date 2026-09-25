import { gzipSync as nodeGzipSync } from 'node:zlib'
import { gunzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { MOBILE_WEB_BUNDLE_RANGE_BYTES } from '../../../src/shared/mobile-web-bundle/bundle-rpc-contract'

/** Script-like and a full range long, so the host's level-6 deflate emits dynamic Huffman blocks. */
function scriptRange(): Buffer {
  const words = ['const ', 'function ', 'return ', 'export ', '=> ', '{', '}', ';\n', 'orca']
  let text = ''
  for (let index = 0; text.length < MOBILE_WEB_BUNDLE_RANGE_BYTES; index += 1) {
    text += words[(index * 7) % words.length] + String(index % 1000)
  }
  return Buffer.from(text.slice(0, MOBILE_WEB_BUNDLE_RANGE_BYTES))
}

// The host deflates with node's zlib and the phone inflates with fflate: two implementations that
// must agree on every range the host can send. Upstream drives the host's own encoder
// (src/main/runtime/rpc/methods/mobile-web-bundle-range-encoding.ts), which this fork does not
// vendor; it is node's gzip at level 6, so that is what this calls. Upstream's second case, the
// host sending identity for bytes gzip cannot shrink, tests the host's choice and stays upstream.
describe('a host-encoded range decoded by the phone', () => {
  it('inflates node gzip output with fflate to the same bytes', () => {
    const raw = scriptRange()
    const encoded = nodeGzipSync(raw, { level: 6 })

    expect(encoded.byteLength).toBeLessThan(raw.byteLength)
    const inflated = gunzipSync(new Uint8Array(encoded), {
      out: new Uint8Array(raw.byteLength + 1)
    })
    expect(Buffer.from(inflated).equals(raw)).toBe(true)
  })
})
