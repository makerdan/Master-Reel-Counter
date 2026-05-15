# Future Plans

This document captures ideas and features that have been explored but intentionally deferred. Use it as a reference when deciding what to build next.

---

## Native Mobile Companion App

**Status:** Deferred — current solution is sufficient  
**Revisit when:** Workers experience real friction with camera quality, upload reliability, or team onboarding in the field

### Background
A dedicated native mobile app was explored as a companion to the main web application. The concept was a minimal photo-capture-only frontend for warehouse field workers that sends photos directly to an active session, while the desktop/tablet operator handles data entry, pinning, review, and exports.

### Why it was deferred
The existing Mobile Flow combined with PWA support already covers the photo capture use case effectively. Workers can add the app to their home screen and use it offline with the sync queue. A native app would only provide incremental improvements.

### What a native app would add
- Better native camera control (exposure settings, RAW capture, faster shutter response)
- Background uploads — continues uploading even when the worker switches apps
- Push notifications — e.g., the desktop operator can request a re-shoot from the field
- App store distribution — easier team rollout than explaining PWA installation
- More persistent offline storage compared to IndexedDB on some devices

### Architecture if built
- New separate Replit project for the mobile frontend (React Native / Expo)
- Connects to the same deployed Express backend — no backend changes needed
- Uses the existing photo upload API endpoints and WebSocket collaboration
- Workers log in, pick an active session (or scan a QR code), and capture photos
- Photos appear in real-time on the desktop via the existing WebSocket broadcast
