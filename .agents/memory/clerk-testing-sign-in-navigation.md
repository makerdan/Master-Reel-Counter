---
name: Clerk testing sign-in navigation
description: Distinguishing programmatic Clerk test sign-in from user-facing form navigation.
---

The Clerk Playwright testing helper activates a session directly. It does not submit the sign-in form or trigger that form's fallback redirect. A session active while the browser remains on the sign-in route is therefore not by itself an application redirect defect. Release checks using this helper should verify the session first, navigate explicitly to protected content, and verify local authorization independently. They must not claim they proved the automatic form redirect.

**Why:** A browser regression expecting the helper to follow a safe return URL remained on the sign-in route even after an active session appeared. Another form attempt stopped at Clerk's new-device challenge without activating a session; a challenge that removes its controls after accepting input can also make an unnecessary follow-up click look like a sign-in failure.

**How to apply:** When testing automatic post-login navigation, use a fixture that can complete the real form and any client-trust challenge. Check session activation, route transition, and protected-page authorization separately. If no real-form fixture is available, report UI redirect behavior as unverified rather than changing production routing or relaxing authorization checks.