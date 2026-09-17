import { inflateSync } from 'node:zlib'

// Why: no PNG library is installed, and the asset ratchets in
// app-logo-assets.test.ts need actual pixels, not file sizes: whether the
// notification icon is white-only is invisible to everything else in the
// gate. Handles what rsvg-convert and sips write, 8-bit non-interlaced
// grey/RGB/RGBA with or without alpha, and refuses the rest loudly.

export type DecodedPng = {
  width: number
  height: number
  /** Row-major RGBA, 4 bytes per pixel, alpha 255 where the file had none. */
  rgba: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  }
  return pb <= pc ? b : c
}

export function decodePng(file: Buffer): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (file[i] !== SIGNATURE[i]) {
      throw new Error('not a PNG: bad signature')
    }
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  let offset = 8
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('latin1', offset + 4, offset + 8)
    const data = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'tRNS') {
      // Why refuse rather than apply it: for colour types 0 and 2 this decoder
      // fabricates alpha 255, so a tRNS image would decode as fully opaque. The
      // icon assertion reads "no alpha anywhere" off exactly that value, and an
      // instrument that cannot see the failure it guards is worse than none.
      throw new Error('unsupported PNG: tRNS transparency is not decoded')
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = CHANNELS[colorType]
  if (bitDepth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(
      `unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`
    )
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    const line = new Uint8Array(raw.subarray(rowStart + 1, rowStart + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      switch (filter) {
        case 0:
          break
        case 1:
          line[i] += left
          break
        case 2:
          line[i] += up
          break
        case 3:
          line[i] += (left + up) >> 1
          break
        case 4:
          line[i] += paeth(left, up, upLeft)
          break
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${y}`)
      }
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4
      const src = x * channels
      switch (colorType) {
        case 0:
          rgba[out] = rgba[out + 1] = rgba[out + 2] = line[src]
          rgba[out + 3] = 255
          break
        case 2:
          rgba[out] = line[src]
          rgba[out + 1] = line[src + 1]
          rgba[out + 2] = line[src + 2]
          rgba[out + 3] = 255
          break
        case 4:
          rgba[out] = rgba[out + 1] = rgba[out + 2] = line[src]
          rgba[out + 3] = line[src + 1]
          break
        case 6:
          rgba.set(line.subarray(src, src + 4), out)
          break
        default:
          throw new Error(`unsupported PNG colour type ${colorType}`)
      }
    }
    previous = line
  }
  return { width, height, rgba }
}

function countColours(png: DecodedPng, include: (alpha: number) => boolean): Map<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < png.rgba.length; i += 4) {
    if (!include(png.rgba[i + 3])) {
      continue
    }
    const key = `${png.rgba[i]},${png.rgba[i + 1]},${png.rgba[i + 2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Distinct RGB triples among pixels with any coverage (alpha > 0), with
 *  counts. Anti-aliased edges count too, which is the point for a white
 *  silhouette: a red edge on a "white" icon is exactly the defect this exists
 *  to catch, and white survives premultiplied-alpha rounding exactly. */
export function visibleColours(png: DecodedPng): Map<string, number> {
  return countColours(png, (alpha) => alpha > 0)
}

/** Distinct RGB triples among fully opaque pixels only. For a coloured mark
 *  this is the right instrument: un-premultiplying a rasteriser's edge pixel
 *  at alpha 1 or 2 rounds (241, 25, 36) to things like (255, 0, 0), which is
 *  noise, not a second colour. */
export function opaqueColours(png: DecodedPng): Map<string, number> {
  return countColours(png, (alpha) => alpha === 255)
}

export function alphaRange(png: DecodedPng): { min: number; max: number } {
  let min = 255
  let max = 0
  for (let i = 3; i < png.rgba.length; i += 4) {
    const alpha = png.rgba[i]
    if (alpha < min) {
      min = alpha
    }
    if (alpha > max) {
      max = alpha
    }
  }
  return { min, max }
}
