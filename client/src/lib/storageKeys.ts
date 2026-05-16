/**
 * Central registry of all localStorage, sessionStorage, and IndexedDB keys
 * used by the client application.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Scattered raw string literals make it impossible to know which keys exist,
 * which features own them, and which lifecycle events must clear them.
 * This registry is the single source of truth for all storage key strings.
 *
 * RULES
 * ─────
 * 1. Every localStorage / sessionStorage key MUST be declared in this file.
 * 2. Do NOT pass a raw string literal to localStorage / sessionStorage methods
 *    outside of this file. Use the exported constants / factory functions.
 * 3. Before adding a new key, decide its scope (global vs. session-scoped),
 *    pick the right cleanup hook, and add a row to the table below.
 * 4. Run `node scripts/lint-storage.mjs` to audit for unregistered key usage.
 *
 * KEY REGISTRY
 * ────────────────────────────────────────────────────────────────────────────
 * Key                               Store  Scope    Cleared on
 * ────────────────────────────────────────────────────────────────────────────
 * reel-counter-last-session         LS     global   (never — latest-visit hint)
 * reel-counter-recent-searches      LS     global   user action (clear button)
 * pdfExportQuality                  LS     global   user action (setting change)
 * offlinePlaceholderSeed            LS     global   (never — monotonic counter)
 * session-progress-collapsed        LS     global   (never — UI preference)
 * session-tab-{sid}                 LS     session  delete / permanentDelete / restore
 * scanner-results-{sid}             LS     session  delete / permanentDelete / restore / reset
 * scanner-zoom-{sid}                LS     session  delete / permanentDelete / restore / reset
 * scanner-select-{sid}              LS     session  delete / permanentDelete / restore / reset
 * scan-panel-open-{sid}             LS     session  delete / permanentDelete / restore
 * reelcounter:undo-stack:{sid}      LS     session  delete / permanentDelete / restore / reset
 * reelcounter:redo-stack:{sid}      LS     session  delete / permanentDelete / restore / reset
 * scanner-batch-{sid}               SS     session  delete / permanentDelete / restore
 * rr_cohort_{sid}                   SS     session  clearSessionKeys / clearSessionResetKeys / ReviewTab unmount
 * rr_queue_{sid}_{uid}              SS     session  clearSessionKeys / ReviewTab unmount
 * rr_pos_{sid}_{uid}                SS     session  clearSessionKeys / ReviewTab unmount
 * incomplete-banner-dismissed-{sid} SS     session  clearSessionKeys / user dismiss action
 * notes-closed-{photoId}            SS     photo    user action (toggle notes open)
 * dash:*                            SS     global   resets on every page load (no risk)
 * themeMode                         LS     global   user preference (never auto-cleared)
 * theme                             LS     global   legacy theme key; one-time migration to themeMode
 * disregarded-dups-{sid}            LS     session  clearSessionKeys; legacy key — cleared once migrated to DB
 * ────────────────────────────────────────────────────────────────────────────
 *
 * INDEXEDDB (reel-counter-offline, version 2)
 * ────────────────────────────────────────────────────────────────────────────
 * Store: photo-queue  — offline photo upload queue
 * Store: entry-queue  — offline entry creation queue
 * Both stores are scoped by item.userId. Clearing on logout is an explicit
 * product decision that is OUT OF SCOPE for this registry.
 */

// ─── Low-level helpers ────────────────────────────────────────────────────────

/** Read a value from localStorage; returns null on any error. */
export function readKey(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Write a value to localStorage; silently ignores quota / security errors. */
export function writeKey(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

/** Remove a key from localStorage; silently ignores errors. */
export function clearKey(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

/** Read a value from sessionStorage; returns null on any error. */
export function readSessionKey(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

/** Write a value to sessionStorage; silently ignores quota / security errors. */
export function writeSessionKey(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch {}
}

/** Remove a key from sessionStorage; silently ignores errors. */
export function clearSessionKey(key: string): void {
  try { sessionStorage.removeItem(key); } catch {}
}

// ─── Global (non-session-scoped) keys ─────────────────────────────────────────

/** ID of the most recently visited session. Used to display a resume link. */
export const LAST_SESSION_KEY = "reel-counter-last-session";

/** MRU list of recent search terms displayed in the dashboard search dropdown. */
export const RECENT_SEARCHES_KEY = "reel-counter-recent-searches";

/** User-chosen PDF export quality preference ("full" | "standard"). */
export const PDF_EXPORT_QUALITY_KEY = "pdfExportQuality";

/**
 * Monotonically increasing counter for offline placeholder entry IDs.
 * Persisted so IDs remain unique across page reloads. Never intentionally cleared.
 */
export const OFFLINE_PLACEHOLDER_SEED_KEY = "offlinePlaceholderSeed";

/** Whether the Session Progress card on the session page is collapsed. */
export const SESSION_PROGRESS_COLLAPSED_KEY = "session-progress-collapsed";

/**
 * Active theme — persisted so the CSS class is restored on page load.
 * THEME_LEGACY_KEY was used before themeMode; kept for one-time migration.
 */
export const THEME_LEGACY_KEY = "theme";
export const THEME_MODE_KEY = "themeMode";

// ─── Session-scoped localStorage key factories ────────────────────────────────

/** Currently active tab within the session page. */
export const sessionTabKey = (sid: number) => `session-tab-${sid}`;

/** Persisted AI scanner results for a session (JSON array, 24-hour TTL). */
export const scannerResultsKey = (sid: number) => `scanner-results-${sid}`;

/** Per-pin crop zoom levels saved in the AI scanner panel. */
export const scannerZoomKey = (sid: number) => `scanner-zoom-${sid}`;

/** Per-pin "include in analysis" checkbox states in the AI scanner panel. */
export const scannerSelectKey = (sid: number) => `scanner-select-${sid}`;

/** Whether the inline AI scanner panel is expanded in Photo mode. */
export const scanPanelOpenKey = (sid: number) => `scan-panel-open-${sid}`;

/** Undo action stack for a session. */
export const undoStackKey = (sid: number) => `reelcounter:undo-stack:${sid}`;
/** Key prefix used by pruneStaleSessionKeys to sweep all undo stacks. */
export const UNDO_STACK_KEY_PREFIX = "reelcounter:undo-stack:";

/** Redo action stack for a session. */
export const redoStackKey = (sid: number) => `reelcounter:redo-stack:${sid}`;
/** Key prefix used by pruneStaleSessionKeys to sweep all redo stacks. */
export const REDO_STACK_KEY_PREFIX = "reelcounter:redo-stack:";

/**
 * Legacy localStorage key used to store dismissed-duplicate pin keys before
 * they were migrated to the database. The key is removed by FlaggedReels.tsx
 * once migration has run for a session.
 */
export const disregardedDupsKey = (sid: number) => `disregarded-dups-${sid}`;

// ─── Session-scoped sessionStorage key factories ──────────────────────────────

/** Whether the AI scanner is in batch (session-wide) mode for a session. */
export const scannerBatchKey = (sid: number) => `scanner-batch-${sid}`;

/**
 * Timestamp of the most recent incomplete-entry banner dismissal.
 * Managed by EntryTable.tsx; cleared as part of session lifecycle.
 */
export const incompleteBannerDismissedKey = (sid: number) => `incomplete-banner-dismissed-${sid}`;

// ─── Photo-scoped sessionStorage key factories ────────────────────────────────

/** Whether the photo notes panel was closed by the user (value "1" = closed). */
export const photoNotesDismissedKey = (photoId: number) => `notes-closed-${photoId}`;

/**
 * The following keys are managed entirely within ReviewTab.tsx and are cleared
 * by that component on unmount. Exported here for documentation and for use
 * in clearSessionKeys if ever needed.
 */
export const reviewCohortKey = (sid: number) => `rr_cohort_${sid}`;
export const reviewQueueKey = (sid: number, uid: string) => `rr_queue_${sid}_${uid}`;
export const reviewPosKey = (sid: number, uid: string) => `rr_pos_${sid}_${uid}`;

// ─── Lifecycle bulk-clear helpers ─────────────────────────────────────────────

/**
 * Remove every session-scoped localStorage and sessionStorage key for `sid`.
 *
 * Call this in `onSuccess` of:
 *   - deleteSession        (move to trash)
 *   - permanentDeleteSession
 *   - restoreSession       (clears stale pre-trash state)
 */
export function clearSessionKeys(sid: number): void {
  clearKey(sessionTabKey(sid));
  clearKey(scannerResultsKey(sid));
  clearKey(scannerZoomKey(sid));
  clearKey(scannerSelectKey(sid));
  clearKey(scanPanelOpenKey(sid));
  clearKey(undoStackKey(sid));
  clearKey(redoStackKey(sid));
  clearSessionKey(scannerBatchKey(sid));
  clearSessionKey(reviewCohortKey(sid));
  clearKey(disregardedDupsKey(sid));
  clearSessionKey(incompleteBannerDismissedKey(sid));
  // rr_queue_{sid}_{uid} and rr_pos_{sid}_{uid} carry per-user suffixes;
  // sweep sessionStorage for all keys matching either prefix.
  try {
    const qPrefix = `rr_queue_${sid}_`;
    const pPrefix = `rr_pos_${sid}_`;
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(qPrefix) || k.startsWith(pPrefix))) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

/**
 * Remove only the session-scoped keys that must be cleared when the session
 * data is reset to photos-only.
 *
 * This is a subset of `clearSessionKeys`: the active tab and scan-panel-open
 * preferences are intentionally preserved so the UI returns to the same view
 * after a reset.
 */
export function clearSessionResetKeys(sid: number): void {
  clearKey(scannerResultsKey(sid));
  clearKey(scannerZoomKey(sid));
  clearKey(scannerSelectKey(sid));
  clearKey(undoStackKey(sid));
  clearKey(redoStackKey(sid));
  clearSessionKey(reviewCohortKey(sid));
}
