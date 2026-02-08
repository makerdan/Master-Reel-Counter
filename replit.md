# Master Reel Counter

## Overview
A full-stack warehouse wire reel counting application built with React, Express, PostgreSQL, and Replit integrations. Tracks wire reels across pallet sections with photo annotation, AI-powered tag reading, and PDF/CSV export capabilities.

## Recent Changes
- 2026-02-08: Initial full build - schema, storage, routes, all frontend pages
- 2026-02-08: Security hardening - added ownership verification on all CRUD routes (photo/entry/pin verify session ownership chain), fixed cascading delete with proper `inArray`, limited external API data exposure
- Database schema: counting_sessions, photos, entries, pins tables
- Auth via Replit Auth (OpenID Connect)
- Object Storage for photo uploads
- OpenAI Vision for AI Assist tag reading (reads from object storage via base64 encoding)

## Architecture
- **Frontend**: React + Vite, shadcn/ui, TanStack Query, wouter routing
- **Backend**: Express.js with PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC) with session cookies
- **Storage**: Replit Object Storage for photos
- **AI**: OpenAI Vision (gpt-4o) via Replit AI Integrations

### Key Pages
- `/` - Landing (unauthenticated) or Dashboard (authenticated)
- `/session/:id` - Session workspace with photo mode and single entry mode

### Data Flow
1. User logs in via Replit Auth
2. Creates counting sessions
3. In a session: uploads photos or adds entries manually
4. Photo mode: place pins on photos, set reel counts, batch create entries
5. AI Assist: analyze photos for reel tags
6. Export as CSV or PDF

### API Routes
- `GET/POST /api/sessions` - Session CRUD
- `GET/POST /api/sessions/:id/entries` - Entry CRUD
- `GET/POST /api/sessions/:id/photos` - Photo CRUD
- `POST /api/photos/:id/pins` - Pin CRUD
- `PATCH/DELETE /api/entries/:id`, `/api/photos/:id`, `/api/pins/:id`
- `POST /api/ai/analyze` - AI Vision analysis
- `GET /api/sessions/:id/export` - Full session export
- `GET /api/external/sessions/:id` - External API for Power Apps

### Theme
Copper/industrial warm tones with dark mode support. Primary hue ~18° (orange-amber), warm background tones.

## User Preferences
- Industrial/warehouse aesthetic
- Mobile-first design
- Monospace font (JetBrains Mono) for data values
- Orange accent color (#ea580c)
