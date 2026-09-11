// E2EE handshake and RPC plumbing for scripts/capture-terminal-stream.ts —
// the same nacl box scheme the app's socket session speaks.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import type WebSocket from 'ws'

export type RpcResponse = {
  id: string
  ok: boolean
  streaming?: true
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

type PendingRequest = {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export class CaptureRpc {
  readonly token: string
  private readonly sharedKey: Uint8Array
  private readonly clientPublicKeyB64: string
  private reqId = 0
  private readonly pending = new Map<string, PendingRequest>()

  constructor(userData: string) {
    const devices = readJson<Array<{ token: string }>>(join(userData, 'orca-devices.json'))
    const keypair = readJson<{ publicKeyB64: string }>(join(userData, 'orca-e2ee-keypair.json'))
    const token = devices[0]?.token
    if (!token || !keypair.publicKeyB64) {
      throw new Error(`Missing mobile token or E2EE public key in ${userData}`)
    }
    this.token = token
    const clientKeys = nacl.box.keyPair()
    this.clientPublicKeyB64 = Buffer.from(clientKeys.publicKey).toString('base64')
    this.sharedKey = nacl.box.before(
      new Uint8Array(Buffer.from(keypair.publicKeyB64, 'base64')),
      clientKeys.secretKey
    )
  }

  nextId(prefix: string): string {
    this.reqId += 1
    return `${prefix}-${this.reqId}`
  }

  encrypt(plaintext: string): string {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const ciphertext = nacl.box.after(new TextEncoder().encode(plaintext), nonce, this.sharedKey)
    const bundle = new Uint8Array(nonce.length + ciphertext.length)
    bundle.set(nonce)
    bundle.set(ciphertext, nonce.length)
    return Buffer.from(bundle).toString('base64')
  }

  decryptBytes(bundle: Uint8Array): Uint8Array | null {
    if (bundle.length < nacl.box.nonceLength + nacl.box.overheadLength) {
      return null
    }
    return nacl.box.open.after(
      bundle.subarray(nacl.box.nonceLength),
      bundle.subarray(0, nacl.box.nonceLength),
      this.sharedKey
    )
  }

  decrypt(payload: string): string | null {
    const plaintext = this.decryptBytes(new Uint8Array(Buffer.from(payload, 'base64')))
    return plaintext ? new TextDecoder().decode(plaintext) : null
  }

  sendRaw(ws: WebSocket, payload: unknown): void {
    ws.send(this.encrypt(JSON.stringify(payload)))
  }

  send(ws: WebSocket, method: string, params?: unknown): Promise<RpcResponse> {
    const id = this.nextId('capture')
    this.sendRaw(ws, { id, deviceToken: this.token, method, params })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for ${method}`))
      }, 15_000)
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timeout)
          resolve(response)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      })
    })
  }

  /** Settle the pending request this response answers; false if none. */
  settle(response: RpcResponse): boolean {
    const request = this.pending.get(response.id)
    if (!request) {
      return false
    }
    this.pending.delete(response.id)
    request.resolve(response)
    return true
  }

  async handshake(ws: WebSocket): Promise<void> {
    ws.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: this.clientPublicKeyB64 }))
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for e2ee_ready')), 5000)
      ws.once('message', (data) => {
        clearTimeout(timeout)
        const msg = JSON.parse(data.toString()) as { type?: string }
        if (msg.type !== 'e2ee_ready') {
          reject(new Error(`Unexpected handshake response: ${data.toString()}`))
          return
        }
        resolve()
      })
    })
    this.sendRaw(ws, { type: 'e2ee_auth', deviceToken: this.token })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for e2ee_authenticated')),
        5000
      )
      ws.once('message', (data) => {
        clearTimeout(timeout)
        const plaintext = this.decrypt(data.toString())
        const msg = plaintext ? (JSON.parse(plaintext) as { type?: string }) : null
        if (msg?.type !== 'e2ee_authenticated') {
          reject(new Error(`Unexpected auth response: ${data.toString()}`))
          return
        }
        resolve()
      })
    })
  }
}
