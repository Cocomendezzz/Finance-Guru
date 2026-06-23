// AES-256-GCM encryption via Web Crypto API.
// No external dependencies. All operations happen in browser memory; nothing touches a server.

const ITERATIONS = 250000   // PBKDF2 rounds — high enough to slow brute-force
const KEY_BITS   = 256
const ENC        = new TextEncoder()
const DEC        = new TextDecoder()

const toB64   = bytes => btoa(String.fromCharCode(...bytes))
const fromB64 = b64   => new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)))

// Derive an AES-GCM key from a PIN string + stored salt
export async function deriveKey(pin, saltB64) {
  const salt  = fromB64(saltB64)
  const raw   = await crypto.subtle.importKey('raw', ENC.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt any JS value → base64 string (iv prepended)
export async function encryptVault(key, data) {
  const iv     = crypto.getRandomValues(new Uint8Array(12))
  const plain  = ENC.encode(JSON.stringify(data))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const out    = new Uint8Array(12 + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), 12)
  return toB64(out)
}

// Decrypt base64 string → JS value. Throws if key is wrong.
export async function decryptVault(key, b64) {
  const buf    = fromB64(b64)
  const iv     = buf.slice(0, 12)
  const cipher = buf.slice(12)
  const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return JSON.parse(DEC.decode(plain))
}

// Generate a random 128-bit salt, base64-encoded
export function newSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(16)))
}
