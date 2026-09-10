---
name: Owner account-management failures
description: Owner-only account-management requests must preserve typed failure state for retryable UI recovery.
---

Owner account-management loads should distinguish intentional non-owner denial from owner-side transport or server failures. A failed rejected-user count must stay unavailable until a successful response; treating it as zero can make destructive confirmations inaccurate.

**Why:** The settings UI previously converted failed admin-user loads into denial and failed rejected-count loads into zero data, hiding recoverable failures and misleading owners.

**How to apply:** Keep owner identity server-authoritative, expose retryable query errors to owners, hide 403 denials from non-owners, and invalidate the rejected-count query after approval/rejection mutations.