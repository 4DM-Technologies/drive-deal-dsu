const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

/**
 * `crypto.randomUUID()` is exposed only in secure contexts, so it is `undefined`
 * whenever the app is served over plain HTTP instead of HTTPS or localhost. Calling
 * it unguarded threw a TypeError during AdvisorScreen's mount effect and the root
 * error boundary replaced the page with "Something didn't load correctly".
 */
export function createId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = randomBytes(16);
  // Read into locals first: the two expressions above narrow the element type but
  // not the indexed access, so writing them in place trips noUncheckedIndexedAccess.
  const version = (bytes[6] ?? 0) & 0x0f;
  const variant = (bytes[8] ?? 0) & 0x3f;
  bytes[6] = version | 0x40;
  bytes[8] = variant | 0x80;
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}