/**
 * Input validation and sanitization module.
 *
 * Inspired by edict's _sanitize_text pattern, this module provides
 * defensive sanitization for all user and agent input before database
 * insertion. It strips code blocks, URLs, system metadata, and normalizes
 * whitespace to prevent garbage data from entering the database.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Standard result type for validation operations.
 * - `{ ok: true; value: string }` — input passed validation and was cleaned.
 * - `{ ok: false; error: string }` — input failed validation with a reason.
 */
export type Result =
  | { ok: true; value: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Set of common junk title values that indicate meaningless input.
 * Checked case-insensitively (caller must toLowerCase before lookup).
 * Covers English, Chinese, and placeholder strings.
 */
export const JUNK_TITLES: ReadonlySet<string> = new Set([
  '?',
  'ok',
  'yes',
  'no',
  'test',
  'testing',
  '...',
  'foo',
  'bar',
  'asdf',
  '好的',
  '好',
]);

// ---------------------------------------------------------------------------
// Core sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize a raw input string by applying a sequence of defensive transforms.
 *
 * Why each step:
 * 1. **Trim** — remove accidental leading/trailing whitespace from copy-paste.
 * 2. **Strip code blocks** — LLM agent outputs often embed ``` blocks with
 *    internal metadata; we want only the prose portion.
 * 3. **Strip URLs** — URLs are noise in titles and descriptions and can be
 *    extremely long or contain tracking parameters.
 * 4. **Strip system metadata** — patterns like `message_id=abc` or
 *    `session_id=xyz` are internal identifiers that leak into agent output.
 * 5. **Normalize whitespace** — collapse runs of spaces, tabs, and newlines
 *    into a single space for consistent storage.
 * 6. **Truncate** — enforce a hard length limit with an ellipsis suffix so
 *    the database never receives oversized values.
 *
 * @param raw - The untrusted input string to sanitize.
 * @param maxLen - Maximum allowed length after sanitization (default 200).
 * @returns The cleaned string, safe for database insertion.
 */
export function sanitizeInput(raw: string, maxLen = 200): string {
  let t = raw.trim();

  // Strip code blocks — everything from the first ``` onward.
  const codeBlockIndex = t.indexOf('```');
  if (codeBlockIndex !== -1) {
    t = t.slice(0, codeBlockIndex).trim();
  }

  // Strip URLs — remove http:// and https:// links to avoid noise.
  t = t.replace(/https?:\/\/\S+/g, '');

  // Strip system metadata patterns — internal IDs that leak into agent output.
  t = t.replace(
    /(message_id|session_id|chat_id|open_id)\s*[:=]\s*\S+/g,
    '',
  );

  // Normalize whitespace — collapse any run of whitespace into a single space.
  t = t.replace(/\s+/g, ' ').trim();

  // Truncate with ellipsis suffix if the result exceeds the limit.
  if (t.length > maxLen) {
    t = t.slice(0, maxLen) + '\u2026';
  }

  return t;
}

// ---------------------------------------------------------------------------
// Title validation
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a meaningful title.
 *
 * A valid title must:
 * - Not be empty after sanitization.
 * - Be at least 3 characters long after sanitization.
 * - Not be a known junk value (case-insensitive).
 *
 * @param title - The raw title string to validate.
 * @returns A Result with the cleaned title on success, or an error message.
 */
export function isValidTitle(title: string): Result {
  const cleaned = sanitizeInput(title, 200);

  if (cleaned.length === 0) {
    return { ok: false, error: 'Title is empty after sanitization' };
  }

  if (cleaned.length < 3) {
    return { ok: false, error: 'Title too short (minimum 3 characters)' };
  }

  if (JUNK_TITLES.has(cleaned.toLowerCase())) {
    return { ok: false, error: 'Title is invalid (common junk value)' };
  }

  return { ok: true, value: cleaned };
}

// ---------------------------------------------------------------------------
// Description sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize a description string with a generous length limit of 2000.
 *
 * Descriptions are expected to be longer than titles but still need the
 * same defensive cleaning — code blocks, URLs, and metadata must be
 * stripped before database insertion.
 *
 * @param raw - The untrusted description string to sanitize.
 * @returns The cleaned description, safe for database insertion.
 */
export function sanitizeDescription(raw: string): string {
  return sanitizeInput(raw, 2000);
}
