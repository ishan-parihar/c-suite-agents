/**
 * Dashboard authentication utilities.
 *
 * Uses Web Crypto API (crypto.subtle) — works in both Edge Runtime (middleware)
 * and Node.js Runtime (API routes).
 *
 * Auth flow:
 * 1. Password is SHA-256 hashed and stored as DASHBOARD_PASSWORD_HASH in env
 * 2. On login, submitted password is hashed and compared
 * 3. On success, an HMAC-signed token cookie is set
 * 4. Middleware verifies the cookie's HMAC signature and timestamp on every request
 */

const COOKIE_NAME = 'operant_auth';

/**
 * Compute SHA-256 hash of a string, return as hex.
 */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create an HMAC-SHA256 signature of data using the cookie secret.
 */
async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a signed auth token. Format: "<timestamp>.<hmac>".
 */
export async function createAuthToken(secret: string): Promise<string> {
  const timestamp = Date.now();
  const signature = await hmacSign(String(timestamp), secret);
  return `${timestamp}.${signature}`;
}

/**
 * Verify a signed auth token. Returns the timestamp if valid, null otherwise.
 * Tokens older than maxAgeMs are rejected.
 */
export async function verifyAuthToken(
  token: string,
  secret: string,
  maxAgeMs: number,
): Promise<number | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  // Check expiry
  if (Date.now() - timestamp > maxAgeMs) return null;

  // Verify HMAC
  const expected = await hmacSign(timestampStr, secret);
  if (expected !== signature) return null;

  return timestamp;
}

/**
 * Build a Set-Cookie header value for the auth token.
 */
export function authCookieSet(
  token: string,
  maxAgeSeconds: number,
): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

/**
 * Build a Set-Cookie header value to clear the auth cookie.
 */
export function authCookieClear(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export { COOKIE_NAME };
