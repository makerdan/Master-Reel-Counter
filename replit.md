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
- **Entry Management:** Manual entry of reel data with category autocomplete for efficient data input, including auto-calculation of total footage based on catalog data.
- **Photo Management:**
    - Photo annotation with pin placement to link entries directly to visual cues on reels.
    - Background photo uploads and an offline photo queue with IndexedDB persistence for seamless operation in varying network conditions.
    - Per-photo pin scaling and notes.
    - Nearby photo viewer for contextual information.
- **Collaboration:** Supports collaborative sessions with role-based permissions (owner, editor, viewer) and multiple invitation methods (username, shareable link, email). Real-time updates for collaborative sessions via WebSocket. Online presence tracking with green dot indicators. Role management (editor/viewer toggle), ownership transfer with confirmation dialog, invite link usage tracking (join count), and 7-day auto-expiry on invite links.
- **Data Export:** Capabilities to export session data as PDF or CSV.
- **Undo/Redo:** Implemented for entry and pin modifications.
- **Summary Statistics:** Dashboard to display key metrics and activity logs.
- **Security:** Ownership verification on all CRUD routes and optional AES-256-GCM data encryption for sensitive entry fields.

**System Design Choices:**
- **Frontend Framework:** React + Vite with TanStack Query for data fetching and wouter for routing.
- **Backend Framework:** Express.js.
- **Database:** PostgreSQL managed with Drizzle ORM.
- **API:** RESTful API for session, entry, photo, pin, collaborator, and settings management.
- **Real-time Communication:** WebSockets for real-time synchronization of session changes, comments, and activity logs.
- **Data Encoding:** AES-256-GCM encryption for specific entry fields, with key wrapping and user-specific keys.
- **Flagged Reels Workflow:** Pins can be flagged for re-shoot/review. Dedicated "Flagged" tab shows all flagged pins with photo previews, location indicators, and resolve functionality. Flag state persists through draft-pin auto-save and committed pin creation.
- **User Settings:** Comprehensive settings stored in userSettings table with PATCH /api/settings endpoint. Settings include: Display (theme: light/dark/system, thumbnail size), Accessibility (larger touch targets), Data Entry (aisle prefix, section advance step, default unit), Photo Capture (quality compression 30-100% with Receiving quality override for close-up reel photos), Export (default format, company name, footer text), Data Encoding (AES-256-GCM toggle with collapsible limitations). Settings auto-save on change. Theme provider supports system/light/dark modes with DB-to-localStorage sync.

## External Dependencies
- **Replit Auth:** For user authentication (OpenID Connect).
- **Replit Object Storage:** For storing uploaded photos.
- **PostgreSQL:** Relational database for all application data.
- **Client-side Wire Catalog:** Approximately 180 hardcoded entries used for category lookup and autofill functionalities.