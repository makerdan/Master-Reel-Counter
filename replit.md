# Master Reel Counter

## Overview
A full-stack warehouse wire reel counting application built with React, Express, PostgreSQL, and Replit integrations. Tracks wire reels across pallet sections with photo annotation, manual category entry with catalog autocomplete, and PDF/CSV export capabilities.

## Recent Changes
- 2026-02-13: Mobile capture mode — simplified mobile view for quick photo capture with aisle/section/notes only, toggle button to switch between Capture and Full mode
- 2026-02-13: Conductors field — optional "Conductors:" input on entry forms, auto-fills from catalog category name patterns (TRIPLEX→3, dash-separated sizes counted, etc.)
- 2026-02-13: Table View photo preview — Eye icon button on each entry row opens associated photo in a dialog; photo also shown in edit modal
- 2026-02-13: Receiving area formatting — Table View grouping shows "Receiving Area - Section Unknown" instead of "Aisle Receiving - Section 000"
- 2026-02-13: Pin size controls — plus/minus buttons in photo overlay toolbar scale pin markers from 0.5x to 3x via CSS --pin-scale variable, ideal for close-up shots
- 2026-02-13: Centered photo navigation — top and bottom nav bars center prev/next buttons with typeable photo number input for direct jump
- 2026-02-13: Photo deletion — trash button in bottom nav bar with confirmation dialog, cascades pin removal
- 2026-02-13: Single Entry photo-to-pin-mode — photos captured in Single Entry mode now switch to Section Photo mode's full pin-placing interface (zoom/pan/rotate, pin placement, category autocomplete) for that photo
- 2026-02-11: Collaborative session sharing — team members can work together with role-based permissions (owner/editor/viewer)
- 2026-02-11: Three invite methods — invite by username, shareable link (token-based), or email (mailto: with auto-generated invite link)
- 2026-02-11: Shared sessions dashboard — "Shared with me" section shows sessions from other users with role badges
- 2026-02-11: Team management dialog — owners can view/add/remove collaborators and manage invite links
- 2026-02-11: Join page — /join/:token route for accepting invite links with success/error states
- 2026-02-11: Authorization refactor — verifySessionAccess replaces verifySessionOwnership for role-based route protection
- 2026-02-10: Removed AI Assist (OpenAI Vision) — replaced with manual category entry using catalog autocomplete
- 2026-02-10: Added category autocomplete — type a catalog code, get dropdown suggestions, auto-fills vendor code, footage, wire type, and wire size
- 2026-02-10: Added nearby photos viewer — horizontal thumbnail strip showing ±3 adjacent photos for viewing other angles of same rack area
- 2026-02-10: Enhanced wireReference.ts with ParsedCatalogEntry, parseCatalogEntry(), PARSED_CATALOG, and lookupCategory() for structured catalog lookup
- 2026-02-10: Per-photo notes — textarea to document issues (obstructed reels, hard-to-read tags) with auto-save
- 2026-02-10: Detail shot linking — mark photos as close-up detail shots, link to parent overview photo
- 2026-02-10: Pin drift fix — wrapped image + pins in shared transform container so pins stay locked during zoom/pan/rotate
- 2026-02-09: Session times now derived from first/last photo timestamps (not session creation time) for auditable time tracking
- 2026-02-08: Initial full build - schema, storage, routes, all frontend pages
- 2026-02-08: Security hardening - added ownership verification on all CRUD routes
- 2026-02-08: Added per-user Settings page with data encoding (AES-256-GCM encryption) toggle
- Database schema: counting_sessions, photos, entries, pins, user_settings, users, sessions tables
- Auth via Replit Auth (OpenID Connect)
- Object Storage for photo uploads

## Architecture
- **Frontend**: React + Vite, shadcn/ui, TanStack Query, wouter routing
- **Backend**: Express.js with PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC) with session cookies
- **Storage**: Replit Object Storage for photos
- **Catalog Lookup**: Client-side wire catalog with ~180 entries, parsed for auto-fill (wireReference.ts)
- **Encryption**: AES-256-GCM with PBKDF2-derived KEK from SESSION_SECRET, random DEK per user (key-wrapping pattern)

### Key Pages
- `/` - Landing (unauthenticated) or Dashboard (authenticated, includes "Shared with me" section)
- `/session/:id` - Session workspace with photo mode, single entry mode, and team management (owner only)
- `/join/:token` - Accept invite link and join a shared session
- `/settings` - User settings with data encoding toggle and limitations

### Data Flow
1. User logs in via Replit Auth
2. Creates counting sessions
3. In a session: uploads photos or adds entries manually
4. Photo mode: place pins on photos, type category name with autocomplete, auto-fills vendor/footage/wire details
5. View nearby photos to check other angles of same reel
6. Export as CSV or PDF
7. Settings: toggle data encoding on/off (encrypts/decrypts all existing entries)

### API Routes
- `GET/POST /api/sessions` - Session CRUD (returns role + collaboratorCount)
- `GET /api/sessions/shared` - Get sessions shared with current user
- `GET/POST /api/sessions/:id/entries` - Entry CRUD (auto-encrypt/decrypt when encoding enabled)
- `GET/POST /api/sessions/:id/photos` - Photo CRUD
- `POST /api/photos/:id/pins` - Pin CRUD
- `PATCH/DELETE /api/entries/:id`, `/api/photos/:id`, `/api/pins/:id`
- `GET/POST /api/sessions/:id/collaborators` - Team member management (owner only for POST)
- `DELETE /api/sessions/:id/collaborators/:collabId` - Remove collaborator (owner only)
- `GET/POST /api/sessions/:id/invite-links` - Invite link management (owner only)
- `DELETE /api/invite-links/:id` - Revoke invite link (owner only)
- `POST /api/join/:token` - Accept invite link and join session
- `GET /api/sessions/:id/export` - Full session export (decrypted)
- `GET /api/external/sessions/:id` - External API for Power Apps (limited fields, may be encrypted)
- `GET /api/settings` - User settings
- `POST /api/settings/encoding` - Toggle data encoding

### Collaboration
- Database tables: session_collaborators (userId, role, username), session_invite_links (token, isActive, expiresAt)
- Roles: owner (full control), editor (add/edit data), viewer (read-only)
- Authorization: verifySessionAccess checks ownership + collaborator table, returns { session, role }
- Invite methods: by username (direct add), share link (token-based URL), email (mailto: with generated link)
- Cascade delete: deleting a session removes all collaborators and invite links

### Encoding Details
- Encoded fields: reelTag, wireType, gauge, color, manufacturer, notes, palletId, position, conductors
- Unencoded (for functionality): aisle, section, footage, session names, photo metadata
- Key management: Random DEK wrapped with KEK derived from SESSION_SECRET + per-user salt
- Migration: All existing entries are encrypted/decrypted when toggling

### Theme
Copper/industrial warm tones with dark mode support. Primary hue ~18° (orange-amber), warm background tones.

## User Preferences
- Industrial/warehouse aesthetic
- Mobile-first design
- Monospace font (JetBrains Mono) for data values
- Orange accent color (#ea580c)
