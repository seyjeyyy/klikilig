# Klikilig

A private two-person photo booth built with Next.js App Router, TypeScript, Supabase Auth/Postgres/Realtime, WebRTC and Three.js. Photos, note drafts and PNGs stay in browser memory until an explicit download or eligible device save. The sample pictures were generated for this project. Credits are in `public/asset-credits.txt`.

## Run locally

Use Node 24.x, npm, the Supabase CLI and a running Docker-compatible runtime. From the repository root:

```sh
npm ci
supabase start
```

The CLI applies the versioned migrations to its disposable local database. Copy the local API URL and publishable key (or legacy local anon key) into `.env.local`. The CLI's key output is private to your terminal. Never copy the service-role key into a public variable. Use `cp .env.example .env.local` on Unix or `Copy-Item .env.example .env.local` in PowerShell. Set `APP_ORIGIN=http://localhost:3000` for this setup.

```sh
npm run dev
```

Open the configured origin. Two browser profiles can use two different email/password accounts. The checked-in local configuration accepts signup immediately. To test email confirmation locally, enable confirmations in `supabase/config.toml`, restart the local stack and open the test inbox at port 54324. Use the confirmation template below. Never use personal photos in tests.

| Variable | Value and scope |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | The matching environment's Supabase API URL, available in the browser |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public project key with RLS enforced |
| APP_ORIGIN | Exact trusted app origin, including scheme and optional local port |
| TURN_URL | Comma-separated TURN UDP/TCP/TLS URLs for a TURN REST shared-secret issuer |
| TURN_SECRET | TURN REST shared secret, server only |
| ADULT_PRIVATE_ENABLED | Server feature gate, defaults to false |
| ELIGIBILITY_WEBHOOK_SECRET | Server-only HMAC key shared with an approved assurance gateway |
| SUPABASE_SERVICE_ROLE_KEY | Server-only credential for eligibility results. Standard sessions do not use it |

Vercel supplies `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. Preview invitations use that deployment's own HTTPS URL. Production uses `APP_ORIGIN` or the configured production URL. Origin checking rejects cross-origin API submissions. Local HTTP is accepted only on loopback.

## Accounts and email

Enable email/password under Supabase Authentication → Providers. Enable confirmation for hosted environments, configure SMTP, and configure the Site URL plus exact allowed callback destination for each deployment. Examples below use `<origin>` for that environment's trusted HTTPS origin.

- Confirmation callback: `<origin>/auth/callback`
- Recovery callback: `<origin>/auth/callback?flow=recovery`
- Confirmation email template link: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=signup`
- Recovery email template link: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`

For Klikilig production, set **Site URL** to `https://klikilig.vercel.app` and include `https://klikilig.vercel.app/auth/callback` and `https://klikilig.vercel.app/auth/callback?flow=recovery` in **Redirect URLs**. The **Confirm signup** template body is versioned in `supabase/templates/confirmation.html`. The previous team-alias-only allowlist sent the hosted verification endpoint to the public Site URL.

The callback verifies the emailed token with Supabase and writes the SSR session cookies. A second request consumes a single-use, five-minute database receipt and checks which account the browser actually authenticated. The receipt grants no session or room access. An unavailable session gets a verified-login screen. A valid session resumes the signup intent. The invitation continuation stays in an HTTP-only cookie, and only an explicit Join claims the guest seat.
Use generic email subjects such as “Confirm your Klikilig account” and “Reset your Klikilig password.” The app also accepts PKCE code callbacks in the initiating browser. Token-hash templates support finishing verification in a different browser. Without the original continuation, the confirmation page tells the guest to reopen the original invitation. Redirects accept only the in-app destinations in `safeNext`.

## Rooms and media

The invitation fragment is removed after the server exchanges its digest for a one-hour continuation in an HTTP-only cookie. The database retains the digest, and only the host's browser receives the original link cookie, limited to 24 hours. On another device the host may replace an unused invitation. Previewing reads room status. Joining locks the room and claims its unique guest seat. Accounts can return to their own seat. Blocks apply to later admission.

Private coordination tables are in the unexposed `booth` schema. Public RPCs derive the actor from `auth.uid()`. Enable **private-only channels** by disabling “Allow public access” in Supabase Realtime settings. The migration installs membership policies on `realtime.messages`. The private broadcast topic carries WebRTC signaling. Each peer reloads the SQL snapshot after reconnection, with polling as a fallback for readiness and room status. Configure Realtime and Postgres for the same project.

The countdown freezes each participant's filter settings and one shared effect. Frames are centered, square and mirrored, and the host stays on the left. The reliable channel chunks transfers, verifies SHA-256 and acknowledges receipt. Connected peers exchange sealed note text only after mutual reveal. The host renders each approved download once and transfers it. Saved Standard strips are account-scoped IndexedDB entries on this device. Refreshing the booth discards volatile frames and draft notes.

| Layout | Paired shots | Front PNG |
| --- | --- | --- |
| 3-shot strip | 3 | 1200 × 2220 |
| 4-shot strip | 4 | 1200 × 2810 |
| Polaroid | 1 | 1200 × 1400 |
| Square collage | 4 | 1600 × 1600 |

Each photo slot center-crops each seat separately. The two-sided export doubles the width. Overlays use normalized coordinates. The postcard renderer waits for local fonts and wraps text.

Run `select booth.cleanup();` hourly using a privileged Supabase Cron job. Rooms expire after 24 hours and ended rooms are eligible for immediate cleanup. Their invitations, capture metadata, and membership cascade. Continuations expire after one hour, eligibility is capped at 30 days, and reports are retained for 90 days. Blocks survive room cleanup. Do not enable HTTP body logging for Auth, the app API, the eligibility gateway or Realtime. Do not install analytics or session replay on private routes.

## Adult private launch gate

Leave this mode disabled in hosted environments until the operator selects a launch region and an age-assurance provider, verifies the provider, TURN and hosting terms for the intended use, establishes moderation and reporting operations, and completes physical-device consent tests. No region or provider account was supplied. A production provider onboarding and identity-check journey is still required.

There are two gates: set the server flag and enable the database's privileged singleton only on the intended deployment. Both accounts must have unexpired eligibility. Keep `booth.config.adult_enabled` false for ordinary deployments. Never allow client writes to eligibility, config or consent records.

The provider integration boundary is `POST /api/eligibility`. The operator's trusted gateway must verify the provider's signed result, bind the verified subject to the authenticated account and translate it into exactly `{"user_id":"<uuid>","eligible":true,"expires":"<ISO timestamp>"}`. Sign the exact raw body prefixed with the Unix timestamp and a dot using HMAC-SHA256. Send hex signature in `x-klikilig-signature` and timestamp in `x-klikilig-timestamp`. The endpoint allows three minutes of clock skew. Send a false result for revocation. No identity-document fields are accepted. The gateway must also submit a signed {"available":true} heartbeat once per minute after a successful upstream availability check, or {"available":false} on failure. The database rejects adult access after two minutes without a successful heartbeat.

For disposable local tests only, enable the SQL flag with `update booth.config set adult_enabled=true;` as the local administrator, enable the server flag, set `KLIKILIG_LOCAL_TEST=1`, and run `node --env-file=.env.local scripts/local-eligibility.mjs <test-user-uuid>` for each synthetic account. Run the last invocation with --watch during the test to supply local health heartbeats. This adapter rejects remote URLs, production and Vercel. Reset both gates immediately after testing.

Adult membership, consent to live sharing, readiness for the intended shot/attempt, and exact revision approvals are separate. Stop sharing stops local tracks before making any network request. A standard room cannot change its session type. A partner can still take screenshots or record their screen. A downloaded file is under the recipient's control. The app cannot control a modified peer client.

## GitHub and Vercel

The repository starts on `main`. To create an owner-selected private repository, run `gh auth login`, then `gh repo create OWNER/REPOSITORY --private --source . --remote origin --push`. To connect an existing empty remote, run `git remote add origin <your-git-url>` then `git push -u origin main`. Verify the remote with `git remote -v`. The GitHub workflow installs the lockfile, starts a disposable Supabase stack, checks types and lint, tests migrations, builds Next.js, then runs Chromium with simulated cameras.

Create separate Supabase projects for development, preview and production. For each hosted target, verify its project ref, then run `supabase link --project-ref <intended-ref>`, `supabase migration list`, `supabase db push --dry-run`, and `supabase db push`. Apply migrations for preview only to the preview project. Review grants and configure auth email templates, redirect URLs, private Realtime, TURN and the cleanup job before release.

Import the GitHub repository into Vercel. Use the Next.js preset, repository root, Node 24.x, `npm ci`, `npm run build`, and production branch `main`. Add variables to the correct Vercel environment and redeploy after changes to public keys. Use the production HTTPS domain in both Vercel and Supabase. Allowlist each trusted preview callback in the isolated preview Auth project. Vercel deployment protection may block a partner before the app opens. Test on an accessible deployment or grant that tester access to the preview.

## Checks and release checklist

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
npm start
```

The e2e runner starts the production build on port 3000, or reuses an existing local server. For two-account testing against disposable local Supabase, use `KLIKILIG_INTEGRATION=1 npm run e2e` on Unix or `$env:KLIKILIG_INTEGRATION='1'; npm run e2e` in PowerShell. Also set `KLIKILIG_MEDIA_TEST=1` to exercise live signaling and fake-camera capture. The migration tests use in-memory PostgreSQL with test identities. Browser rendering tests use generated color charts and sample photos.

- Verify confirmation in another browser, reopen the original invitation, and explicitly join. Confirm a crawler or link preview never claims a seat. Check signup, recovery, resend, logout and safe returns.
- Share from a laptop on Wi-Fi to a phone on mobile data using native share, copy, QR and manual selection. Cancel a share, deny camera and microphone, rotate an unused invite, race two guests and rejoin the winner.
- Test 360px, 390px, tablet and desktop; keyboard dialogs and reduced motion; in-app browser reopening; camera switching and microphone refusal.
- Test two cameras, separate readiness, withdrawal, one countdown, retake, backgrounding, network loss and refresh. For relay-only testing append `?relay=1` to **both room URLs**, with valid TURN configured. Inspect WebRTC internals for a selected relay candidate pair over separate networks.
- Complete a full strip, edit captions and decorations, seal both notes, mutually reveal, approve and download. Verify the SHA-256 of both downloaded PNGs. Save one Standard strip locally and confirm the partner's storage remains empty.
- Use synthetic color bars for Adult private. Test disabled gates, expiry, denied live consent, consent withdrawal, backgrounding, disconnection, stop sharing during transfer, edit/retake invalidation, block/report and the absence of device saves. Verify the deployment's actual provider before enabling.


## Verified locally

The isolated Windows test stack used PostgreSQL 18, Supabase Auth, PostgREST and Supabase Realtime. All five migration files were exercised from an empty test schema; their resulting definitions were also installed on the local services. The release CI configuration uses the Supabase CLI stack on Linux.

Lint, TypeScript, the database suite, the production build and six Chromium tests passed. Two separate accounts created and accepted an invitation, connected with fake cameras, completed a three-shot strip, retook its middle photo while preserving both outer photos pixel-for-pixel, mutually revealed their notes and downloaded postcard PNGs with matching SHA-256 hashes. Separate probes checked overlapping guest claims and private-channel rejection for an outsider. Confirmation and recovery were tested in fresh browser contexts with Auth-generated links. Email delivery remains a hosted release check.

The adult-mode browser test used synthetic camera frames and short-lived local eligibility. It verified independent live consent, capture, two-person export approval, absence of My Strips, and stopping both cameras even when the initiating browser's stop request failed. The database flag was restored to off after testing.

To reproduce the extra email and adult browser checks, provide a **local test-only** service-role credential in KLIKILIG_TEST_ADMIN_KEY. Enable KLIKILIG_ADULT_TEST=1 and ADULT_PRIVATE_ENABLED=true only for the disposable test run, temporarily enable booth.config.adult_enabled in that local database, then restore it to false. The GitHub workflow automates this against its ephemeral test stack.

The GitHub remote, Vercel deployment, hosted Supabase migrations, real SMTP delivery, production assurance provider, and cross-network TURN/phone test require operator configuration. Only the text brief was attached. The live booth layout follows its camera, shutter, filter tray and strip-editor specifications.
