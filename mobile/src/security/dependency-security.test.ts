import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const expo = createRequire(require.resolve('expo/metro-config'))
const config = createRequire(expo.resolve('@expo/metro-config'))
const metro = createRequire(config.resolve('metro'))
const router = createRequire(require.resolve('expo-router/package.json'))
const imageSize = metro.resolve('image-size')
const expoPackage = createRequire(require.resolve('expo/package.json'))
const cli = createRequire(expoPackage.resolve('@expo/cli/package.json'))
const plistRequire = createRequire(cli.resolve('@expo/plist'))

// Run hostile inputs in a disposable process: a regressed infinite loop must not
// hang the test runner or allocate memory indefinitely in the CI worker.
function dimensions(buffer: Buffer) {
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=64',
      '-e',
      `
    const size = require(process.argv[1]);
    try {
      console.log(JSON.stringify({ size: size.imageSize(Buffer.from(process.argv[2], 'base64')) }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  `,
      imageSize,
      buffer.toString('base64')
    ],
    { timeout: 1500, encoding: 'utf8' }
  )
  expect(result.error, 'image parser must terminate').toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

function icnsEntry(type: string, size: number) {
  const header = Buffer.alloc(8)
  header.write(type, 0, 'ascii')
  header.writeUInt32BE(size, 4)
  return header
}

function box(type: string, size: number, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(size)
  header.write(type, 4, 'ascii')
  return Buffer.concat([header, payload])
}

it.each([0, 1, 7])('rejects ICNS entries shorter than their header (%i)', (length) => {
  const buffer = Buffer.concat([
    icnsEntry('icns', 24),
    icnsEntry('icp4', 8),
    icnsEntry('icp5', length)
  ])
  expect(dimensions(buffer).error).toBeTruthy()
})

it('rejects a zero-length first ICNS entry', () => {
  expect(
    dimensions(Buffer.concat([icnsEntry('icns', 16), icnsEntry('icp4', 0)])).error
  ).toBeTruthy()
})

it('preserves valid multi-image ICNS dimensions', () => {
  expect(
    dimensions(Buffer.concat([icnsEntry('icns', 24), icnsEntry('icp4', 8), icnsEntry('icp5', 8)]))
      .size
  ).toMatchObject({
    width: 32,
    height: 32,
    images: [
      { width: 16, height: 16 },
      { width: 32, height: 32 }
    ]
  })
})

it('terminates on a zero-length matching JXL partial-stream box', () => {
  const signature = box('JXL ', 12, Buffer.from([13, 10, 135, 10]))
  const ftyp = box('ftyp', 12, Buffer.from('jxl '))
  expect(
    dimensions(Buffer.concat([signature, ftyp, box('jxlp', 0, Buffer.alloc(4))])).error
  ).toBeTruthy()
})

it('terminates on malformed HEIF boxes', () => {
  const ftyp = box('ftyp', 12, Buffer.from('heic'))
  expect(dimensions(Buffer.concat([ftyp, box('free', 0)])).error).toBeTruthy()
})

it('preserves PNG asset dimensions used by Metro', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
    'base64'
  )
  expect(dimensions(png).size).toMatchObject({ width: 1, height: 1, type: 'png' })
})

it('keeps Expo Router query decoding compatible with the fixed decoder', () => {
  const query = router('query-string').default
  expect(query.parse('message=hello%20world&name=%E2%9C%93&repeat=1&repeat=2')).toEqual({
    message: 'hello world',
    name: '✓',
    repeat: ['1', '2']
  })
  expect(query.parse(query.stringify({ text: 'a + b & c', path: '/some/file.png' }))).toEqual({
    text: 'a + b & c',
    path: '/some/file.png'
  })
})

it('decodes a large malformed URI without blocking', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const query = require(process.argv[1]).default;
    const input = '%C2'.repeat(10000);
    const decoded = query.parse('value=' + input);
    if (typeof decoded.value !== 'string') process.exit(1);
  `,
      router.resolve('query-string')
    ],
    { timeout: 1500, encoding: 'utf8' }
  )
  expect(result.error, 'malformed URI must not block').toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
})

it('keeps Expo plist serialization and parsing compatible with latest xmldom', () => {
  const plist = cli('@expo/plist').default
  const value = { CFBundleName: 'Code UI', enabled: true, count: 27, names: ['a', 'b'] }
  expect(plist.parse(plist.build(value))).toEqual(value)
})

it('rejects injected XML entity reference names during well-formed serialization', () => {
  const { DOMImplementation, XMLSerializer } = plistRequire('@xmldom/xmldom')
  const document = new DOMImplementation().createDocument(null, 'root', null)
  const entity = document.createEntityReference('safe')
  entity.nodeName = 'bad;<injected/>&bad'
  expect(() => new XMLSerializer().serializeToString(entity, { requireWellFormed: true })).toThrow()
})

it.each([20, 0])('reads HEIF dimensions with an ispe box size of %i without looping', (size) => {
  const dimensionsPayload = Buffer.alloc(12)
  dimensionsPayload.writeUInt32BE(640, 4)
  dimensionsPayload.writeUInt32BE(480, 8)
  const ispe = box('ispe', size, dimensionsPayload)
  const ipco = box('ipco', 8 + ispe.length, ispe)
  const iprp = box('iprp', 8 + ipco.length, ipco)
  const meta = box('meta', 12 + iprp.length, Buffer.concat([Buffer.alloc(4), iprp]))
  const ftyp = box('ftyp', 12, Buffer.from('heic'))
  expect(dimensions(Buffer.concat([ftyp, meta])).size).toMatchObject({ width: 640, height: 480 })
})
