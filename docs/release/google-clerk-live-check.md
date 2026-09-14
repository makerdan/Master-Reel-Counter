# Google-backed Clerk live verification

This checklist is the one-time live verification for the Google Admin/User
release check. It is
deliberately separate from the repeatable release spec because Google CAPTCHA,
MFA, consent, and device-trust steps must remain human-controlled.

## Safety contract

- Use only the explicitly configured HTTPS release target in
  `PRODUCTION_BASE_URL`.
- Use a dedicated approved Admin account and a dedicated approved User account,
  or document which role is unavailable and run the repeatable release spec for
  that role instead.
- Enter credentials only in the Google/Clerk UI or through the workspace's
  secret handling. Never add passwords, OAuth codes, cookies, browser storage,
  access tokens, or identity-bearing response bodies to the repository.
- Do not change Google/Clerk provider settings, redirect URIs, secrets, account
  policy, or production records during this check.

## Admin checklist

1. Open the release target's `/sign-in` page.
2. Confirm the Google provider button is visible.
3. Choose Google and complete the approved account's normal sign-in, consent,
   MFA, CAPTCHA, or device-trust steps manually if requested.
4. Confirm the OAuth callback returns to the application and reaches the
   dashboard without a redirect loop, `/sign-in/client-trust` hang, or generic
   authorization error.
5. Open `/settings` and confirm the persisted Admin experience is visible,
   including the Admin tab. Open one protected destination such as `/stats`.
6. Sign out and confirm the signed-out landing page appears and
   `/api/auth/user` returns `401`.

## User checklist

Repeat the same steps with the approved User account. Confirm `/settings` and a
protected destination load, the Admin tab is absent, and sign-out returns to the
signed-out landing page with `/api/auth/user` returning `401`.

## Redacted evidence

Record only:

- HTTPS release origin.
- Final route and the last bounded route sequence.
- Provider/callback route and status context.
- Whether the Admin and User role assertions passed.
- Whether logout returned to the signed-out state.

If the provider or account is unavailable, record that as a provider/account
configuration result rather than weakening the deterministic release
assertions. Do not record the provider response body or any credential-bearing
URL/query string.

## Verification record

Recorded 2026-09-14 against the published HTTPS origin
`https://master-reel-counter-ai.replit.app`.

- Deployment metadata reported a public deployment with a successful build.
- `GET /sign-in` returned `200`, but the page resolved to the application's
  redacted `404 Page Not Found` view rather than the Clerk sign-in experience.
- The unauthenticated browser check therefore found no Google provider control;
  no Google account, OAuth callback, client-trust step, or role assertion was
  attempted.
- `GET /api/auth/user` returned `401` while signed out.
- Admin live verification: unavailable because the published target does not
  expose the expected sign-in route. The repeatable Admin role-mapping
  assertions remain in `tests/release/google-clerk-auth.spec.ts`.
- User live verification: unavailable for the same provider/target
  configuration result. The repeatable User role-mapping assertions remain in
  `tests/release/google-clerk-auth.spec.ts`.
- The workspace also has no `PRODUCTION_BASE_URL`; the release spec correctly
  refuses to target an implicit deployment. No credentials, OAuth codes,
  cookies, tokens, or identity-bearing response bodies were recorded.