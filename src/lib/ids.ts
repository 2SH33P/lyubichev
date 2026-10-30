const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
export function randomId(len = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ALPHA[b % 36];
  return s;
}
export function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : randomId(24);
}
