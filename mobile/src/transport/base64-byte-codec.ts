// A multiple of three keeps padding confined to the final chunk.
//
// Each chunk is turned into a binary string with ONE String.fromCharCode call and encoded on its
// own, so no string the size of the payload is ever built (the heap peak on a multi-megabyte
// frame). Not one byte per call: on an engine without a JIT, which Hermes is, a per-byte
// `binary += String.fromCharCode(byte)` loop measured 6-7x slower than this (1 MB: 34 ms against
// 5.5 ms; 4 MB: 126 ms against 17 ms, V8 --jitless). 8190 bytes is far inside the argument count
// `apply` can take.
const BASE64_BINARY_CHUNK_BYTES = 8190

export function encodeBase64Bytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return ''
  }
  // Where the engine has the native encoder (Uint8Array.prototype.toBase64), it encodes the view
  // in place with no binary string at all; the chunked loop below is the fallback.
  if ('toBase64' in bytes && typeof bytes.toBase64 === 'function') {
    return bytes.toBase64()
  }
  const encoded: string[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_BINARY_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_BINARY_CHUNK_BYTES, bytes.byteLength)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `apply` accepts any array-like of numbers, and a Uint8Array is one.
    const chunk = bytes.subarray(offset, end) as unknown as number[]
    encoded.push(btoa(String.fromCharCode.apply(null, chunk)))
  }
  return encoded.join('')
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
