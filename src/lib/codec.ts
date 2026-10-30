import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

export function gzipJson(obj: unknown): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(obj)), { level: 6 });
}

export function gunzipJson<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(strFromU8(gunzipSync(bytes))) as T;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? strToU8(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

// ---------- 端到端加密（PBKDF2-SHA256 + AES-256-GCM） ----------

export const KDF_ITERATIONS = 310_000;

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password: string, salt: Uint8Array, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', strToU8(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 输出格式：12 字节 IV + 密文 */
export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.subarray(0, 12);
  const ct = data.subarray(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource));
}

export interface EncryptedEnvelope {
  app: 'lyubishchev-time';
  format: 'encrypted';
  kdf: { salt: string; iterations: number };
  payload: string;
}

/** 加密导出文件 */
export async function encryptJson(obj: unknown, password: string): Promise<EncryptedEnvelope> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const payload = await encryptBytes(key, gzipJson(obj));
  return { app: 'lyubishchev-time', format: 'encrypted', kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS }, payload: toB64(payload) };
}

export async function decryptJson<T = unknown>(env: EncryptedEnvelope, password: string): Promise<T> {
  const key = await deriveKey(password, fromB64(env.kdf.salt), env.kdf.iterations);
  return gunzipJson<T>(await decryptBytes(key, fromB64(env.payload)));
}
