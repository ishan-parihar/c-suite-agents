const STORAGE_KEY = 'operant_recently_viewed_notes';
const MAX_ENTRIES = 20;

interface RecentlyViewedEntry {
  id: string;
  name: string;
  viewedAt: number;
}

/**
 * Add a note to the recently viewed list.
 * If the note already exists, removes the old entry first (LRU update).
 * New entries are added at the beginning of the list.
 * List is trimmed to MAX_ENTRIES.
 */
export function addToRecentlyViewed(noteId: string, noteName: string): void {
  if (typeof window === 'undefined') return;

  const entries = getEntries();

  const filtered = entries.filter((entry) => entry.id !== noteId);

  filtered.unshift({
    id: noteId,
    name: noteName,
    viewedAt: Date.now(),
  });

  const trimmed = filtered.slice(0, MAX_ENTRIES);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore write failures
  }
}

/**
 * Get the recently viewed notes list in LRU order (most recent first).
 * Returns max 20 entries.
 */
export function getRecentlyViewed(): RecentlyViewedEntry[] {
  if (typeof window === 'undefined') return [];

  return getEntries();
}

/**
 * Clear all recently viewed notes.
 */
export function clearRecentlyViewed(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fail silently
  }
}

function getEntries(): RecentlyViewedEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is RecentlyViewedEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RecentlyViewedEntry).id === 'string' &&
        typeof (entry as RecentlyViewedEntry).name === 'string' &&
        typeof (entry as RecentlyViewedEntry).viewedAt === 'number'
    );
  } catch {
    return [];
  }
}
