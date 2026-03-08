# Master Reel Counter

## Overview
Master Reel Counter is a full-stack warehouse wire reel counting application designed to track wire reels across pallet sections. It supports photo annotation, manual category entry with catalog autocomplete, and PDF/CSV export capabilities. The application aims to streamline inventory management in warehouse environments by providing a comprehensive and user-friendly solution for tracking wire reels, with features like collaborative sessions, real-time updates, and offline capabilities.

## User Preferences
- Industrial/warehouse aesthetic
- Mobile-first design
- Monospace font (JetBrains Mono) for data values
- Orange accent color (#ea580c)

## System Architecture
The application is built with a React frontend, an Express.js backend, and PostgreSQL as the database. Authentication is handled via Replit Auth (OIDC).

**UI/UX Decisions:**
- **Theme:** Copper/industrial warm tones with dark mode support. Primary hue ~18° (orange-amber), warm background tones.
- **Font:** Monospace font (JetBrains Mono) for data values.
- **Design System:** Utilizes shadcn/ui for components.
- **Mobile-first:** Designed with a mobile-first approach, including a dedicated mobile capture mode for quick photo taking.

**Technical Implementations & Feature Specifications:**
- **Session Management:** Users can create and manage counting sessions, with functionality for duplicating, moving, and organizing sessions into folders.
- **Entry Management:** Manual entry of reel data with category autocomplete for efficient data input, including auto-calculation of total footage based on catalog data. Quick Entry panel available in the Section Photo tab for creating entries without pins (collapsible, auto-fills aisle/section from current photo). Quick Entry toggle button is in the top toolbar (next to Take Photo) on both desktop and mobile.
- **Photo Management:**
    - Photo annotation with pin placement to link entries directly to visual cues on reels.
    - Background photo uploads and an offline photo queue with IndexedDB persistence for seamless operation in varying network conditions.
    - Per-photo pin scaling and notes.
    - Nearby photo viewer for contextual information.
    - Floating ReelCropPreview: `position: fixed` at viewport top (below header) while pin entry inputs are focused; spacer div preserves layout flow. Used because `position: sticky` is broken by `overflow-x-hidden` on session container.
    - All photos stored in Replit Object Storage (GCS bucket `.private/uploads/`); legacy local-disk photos served via fallback. PDF export and photo deletion also operate against object storage.
- **Collaboration:** Supports collaborative sessions with role-based permissions (owner, editor, viewer) and multiple invitation methods (username, shareable link, email). Real-time updates for collaborative sessions via WebSocket. Online presence tracking with green dot indicators. Role management (editor/viewer toggle), ownership transfer with confirmation dialog, invite link usage tracking (join count), and 7-day auto-expiry on invite links.
- **Data Export:** PDF export with redesigned cover page, clickable Table of Contents with internal links, page numbers/running footer, enhanced photo captions (aisle/section/timestamp), note wrapping with variable row heights, timezone-aware timestamps, session description display, and grand totals row. CSV export also supports user timezone. Session description field available for documenting session context.
    - **PDF Quality Picker:** When exporting PDF, a dialog opens immediately with two options — Full Quality (original resolution, default, recommended for auditing reel labels) and Standard (1600px wide, smaller file). Both versions begin generating in parallel the moment the dialog opens; the chosen blob downloads instantly on confirm. Last-used choice persists in localStorage. Standard quality exports append " (Standard Quality)" to the filename.
    - **PDF Performance:** Photos pre-loaded in a single parallel `Promise.all` batch before layout; GCS reachability probed once with 1.5s timeout before falling through to local disk. Typical export time ~2s for a 13-photo session.
    - **PDF Buffering:** PDF is fully buffered in memory (PassThrough stream) before sending with `Content-Length`; catch block can return a proper JSON 500 if generation fails mid-way.
    - **Photo Rotation Persistence:** Rotate CW/CCW buttons in Full Mode now save `rotation` (0/90/180/270°) to the database via debounced PATCH and initialize from the DB on photo navigation. PDF export applies the stored rotation on top of EXIF auto-correction so exported photos match the orientation seen in the app.
- **AI Label Scanner:** A dedicated "AI Scanner" tab in the session view that uses OpenAI Vision (gpt-4o) to read wire reel labels from photo crops. Users select a photo, preview cropped regions around pins (with adjustable zoom levels and drag-to-pan), then batch-analyze the labels. Results are matched against the wire catalog client-side using fuzzy matching, and can be reviewed/edited before applying to entries. Server-side results are cached per photo. Crops are capped at 600px square and batches are auto-split at 20 images. Supports both draft pins (creates new entries + committed pins on apply) and incomplete committed pins (updates existing entries). Pin refresh signal ensures instant sync with Section Photo mode.
    - **Photo Sync:** The current photo is synced between Section Photo and AI Scanner tabs. Switching tabs navigates to the same photo in both views via `syncedPhotoIdRef` and `lastPhotoModePhotoIdRef` in session.tsx.
    - **Receiving Pooling:** When a photo's aisle or section contains "Receiving", the AI Scanner pools active pins from multiple Receiving photos (up to 9 cards) to batch more labels per analysis call. Each card uses per-card photoUrl for correct crop preview. Analysis calls are grouped by photoId. Pooled cards from other photos show a purple badge with their source location.
    - **Batch Mode:** Toggle (Grid3X3/List icon) switches to a dense 5-column grid showing ALL active pins across the entire session (all photos with drafts or incomplete committed pins). `allSessionActivePins` memo groups `allSessionPins` by photoId once, applies orphan-filtering and incomplete-committed logic per photo. Each card shows a compact source photo badge (aisle/section). Analysis groups by photoId and sends separate API calls. The 10-card cap was removed; all session pins are shown with a summary count ("N pins across M photos").
    - **Raw AI Text:** Each card displays the literal `rawText` from the AI analysis result in a monospace "AI Raw" block above the Category input. Shows full multi-line text (break-words, pre-wrap). Shows "unreadable" in italic if rawText is null.
    - **Special Aliases:** `correctWireDetails` maps non-standard OCR results to standard catalog codes (e.g. `25001XHHWALBR` → `XHHW250BR1000`, `25001XHHWALOR` → `XHHW250OR1000`, `MHF` → `MHF40402041000`).
    - **Image Cache:** Module-level LRU cache (`imageCache`, max 20 entries) shares `HTMLImageElement` objects across all `CropCanvas` instances. `getOrLoadImage(url)` checks cache first, evicts oldest on overflow, and removes entries on load error. Pre-warm `useEffect` triggers on photo selection (and for pooled Receiving photos) so the image download starts before cards mount.
    - **Files:** `client/src/pages/session/LabelScannerTab.tsx` (tab UI), `client/src/lib/labelMatcher.ts` (catalog matching), `client/src/lib/wireReference.ts` (catalog + aliases), `server/lib/cropPhoto.ts` (sharp-based cropping utility)
    - **Real-Time Sync:** Scan results are persisted to the `scan_results` DB table and broadcast via WebSocket (`sync` entity `scan_results`). Other users in the same session automatically receive updated scan results through query invalidation, enabling multiple users to divide scanning work and see each other's results in real time. Client also caches to localStorage as a secondary fallback.
    - **API:** `POST /api/photos/:photoId/analyze-labels`, `GET /api/photos/:photoId/label-cache`, `GET /api/sessions/:id/scan-results`, `DELETE /api/sessions/:id/scan-results`
- **Undo/Redo:** Implemented for entry and pin modifications.
- **Summary Statistics:** Dashboard to display key metrics and activity logs.
- **Security:** Ownership verification on all CRUD routes and optional AES-256-GCM data encryption for sensitive entry fields.
- **In-App Feedback:** Users can submit structured feedback (bug reports, feature requests, design feedback, other) from two places: the Contact & Feedback card in Settings, and a "Send Feedback" dialog at the bottom of every Help drawer. Submissions are stored in the `feedback` DB table with topic, message, page context, and status. The agent can read and triage these via `GET /api/feedback` (owner-restricted).

**System Design Choices:**
- **Frontend Framework:** React + Vite with TanStack Query for data fetching and wouter for routing.
- **Backend Framework:** Express.js.
- **Database:** PostgreSQL managed with Drizzle ORM. Multi-step cascading operations (section/aisle sync, encryption toggle, session/photo/entry deletion) are wrapped in database transactions for atomicity.
- **API:** RESTful API for session, entry, photo, pin, collaborator, and settings management. All routes require authentication via `isAuthenticated` middleware, and session-scoped routes verify access via `verifySessionAccess`.
- **Real-time Communication:** WebSockets with session access verification on join. Only authenticated owners/collaborators can join a session's WebSocket room.
- **Data Encoding:** AES-256-GCM encryption for specific entry fields, with key wrapping and user-specific keys. Encryption toggle is transactional — entries and settings update atomically.
- **Cascade Deletion:** Session deletion cleans up all related data (photos, entries, pins, collaborators, invite links, activity logs, comments). Photo deletion clears child detail shot references and removes linked comments/entries/pins. Entry deletion unlinks associated pins and removes comments.
- **Flagged Reels Workflow:** Pins can be flagged for re-shoot/review. Dedicated "Flagged" tab shows all flagged pins with photo previews, location indicators, and resolve functionality. Flag state persists through draft-pin auto-save and committed pin creation.
- **User Settings:** Comprehensive settings stored in userSettings table with PATCH /api/settings endpoint. Settings include: Display (theme: light/dark/system, thumbnail size), Accessibility (larger touch targets, text size: small/default/large/extra-large with automatic disable during Mobile Flow), Data Entry (aisle prefix, section advance step, default unit), Photo Capture (quality compression 30-100% with Receiving quality override for close-up reel photos), Export (default format, company name, footer text), Data Encoding (AES-256-GCM toggle with collapsible limitations). Settings auto-save on change. Theme provider supports system/light/dark modes with DB-to-localStorage sync. TextSizeSyncer applies root font-size from settings; MobileCaptureView forces 16px default on mount.
- **User Profile Avatar:** Users can upload a custom profile photo from the Settings > Account section. Avatar stored in Replit Object Storage (`.private/avatars/`), key saved to `users.customAvatarKey`. Served via `GET /uploads/avatars/:filename`. Removing reverts to the Replit-sourced `profileImageUrl`. Effective avatar = `customAvatarKey || profileImageUrl`.

## External Dependencies
- **Replit Auth:** For user authentication (OpenID Connect).
- **Replit Object Storage:** For storing uploaded photos.
- **PostgreSQL:** Relational database for all application data.
- **Client-side Wire Catalog:** Approximately 180 hardcoded entries used for category lookup and autofill functionalities.