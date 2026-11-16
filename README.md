<div align="center">
  <img src="https://i.imgur.com/nI2CZ2l.png" alt="VibeGrowth Agency Logo" height="88" />
  <h1>VibeGrowth Agency</h1>
  <p><strong>Hyper-local growth agency web application</strong> built for San Tan Valley &amp; Pinal County, AZ service professionals (roofing, landscaping, plumbing, HVAC, electrical, and home services).</p>
</div>

VibeGrowth combines a dark-editorial marketing frontend, a validated lead &amp; local audit intake pipeline, Google OAuth authentication, and a server-verified Stripe checkout &amp; webhook flow backed by Express and Cloud Firestore.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Quickstart](#quickstart)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Routes &amp; User Flows](#routes--user-flows)
- [Backend API (`server/app.ts`)](#backend-api-serverappts)
- [Stripe Checkout &amp; Webhook Lifecycle](#stripe-checkout--webhook-lifecycle)
- [Firebase &amp; Firestore Schema](#firebase--firestore-schema)
- [Admin Authorization Setup](#admin-authorization-setup)
- [Firebase Google Auth &amp; Authorized Domains Setup](#firebase-google-auth--authorized-domains-setup)
- [Stripe Dashboard Setup Checklist](#stripe-dashboard-setup-checklist)
- [Design System &amp; Styling](#design-system--styling)
- [Human &amp; AI Developer Guardrails](#human--ai-developer-guardrails)

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript 5.8, Vite 6 | SPA UI and component architecture |
| **Routing** | `react-router-dom` v7 | Client-side navigation + `ScrollToTop` |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite`) | Utility styling + `@theme` design tokens |
| **Motion &amp; Icons** | `motion` (`motion/react`), `lucide-react` | Scroll/enter animations and UI iconography |
| **Backend** | Express 4 + `tsx` (`server.ts`, `server/app.ts`) | Serves `/api/*` routes, Vite dev middleware, and `dist/` in production |
| **Database &amp; Auth** | Firebase v12 Client SDK + `firebase-admin` v14 | Lead/audit intake, Google Sign-In, ID token verification, server-side payments |
| **Payments** | `stripe` v20 (Node) + `@stripe/react-stripe-js` | Server-catalog `PaymentIntent`, raw-body webhook verification, `PaymentElement` |
| **Testing** | `vitest`, `supertest` | Automated API, pricing tamper, auth, webhook signature, and SPA routing tests |
| **AI SDK** | `@google/genai` | Installed for future automated audit/report workflows |

---

## Quickstart

### 1. Install dependencies
Use `npm ci` for reproducible installs from `package-lock.json` (`bun.lock` is also kept synchronized with `package.json`):
```bash
npm ci
```

### 2. Configure environment variables
Copy `.env.example` to `.env` (or configure secrets in your hosting provider's Secret Manager) and populate the required values. **Never commit `.env` or secret keys.**

### 3. Run the development server
The Express server mounts Vite in middleware mode on `process.env.PORT` (default `3000`):
```bash
npm run dev
```

### 4. Type-check, test &amp; build for production
```bash
npm run lint       # Runs tsc --noEmit
npm test           # Runs Vitest API/unit suite (audits & payment tests) with mocked SDKs
npm run test:rules # Runs Firestore Security Rules tests via pinned firebase-tools devDependency (requires Java 21+ for firebase-tools 15.x)
npm run build      # Outputs production SPA bundle to dist/
npm start          # Runs Express in production serving dist/ + SPA fallback
npm run clean      # Removes dist/
```

---

## Environment Variables

Defined in `.env.example`:

| Variable | Scope | Required | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Server (`server.ts`) | Hosting-injected | Server listen port; falls back to `3000` locally. |
| `STRIPE_SECRET_KEY` | Server | For checkout/webhooks | Stripe secret key (`sk_test_...` for testing, `sk_live_...` for live). Missing key returns HTTP `503`. |
| `STRIPE_WEBHOOK_SECRET` | Server | For webhooks | Stripe signing secret (`whsec_...`) used with the raw request body in `/api/stripe-webhook`. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Client (`Payment.tsx`) | For checkout UI | Stripe publishable key (`pk_test_...` / `pk_live_...`). Safe for browser bundle. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server (`firebaseAdmin.ts`) | When not using ADC | Inline JSON string of a Firebase service account key from secret manager. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Server | Optional alternative | File path to service account JSON (not needed if `FIREBASE_SERVICE_ACCOUNT_JSON` or Cloud Run ADC is set). |
| `FIREBASE_PROJECT_ID` | Server | Optional override | Overrides `projectId` from `firebase-applet-config.json` (defaults to `citationgenerator001`). |
| `FIREBASE_DATABASE_ID` | Server | Optional override | Overrides `firestoreDatabaseId` from `firebase-applet-config.json` (defaults to `ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e`). |
| `ADMIN_EMAIL` | Server | Optional override | Verified bootstrap admin email fallback (defaults to `jeremycodjoe@gmail.com`). |
| `GOOGLE_CLOUD_PROJECT` | Server (`auditService.ts`) | For Vertex AI drafts | GCP project ID used by `@google/genai` in Vertex AI mode via Application Default Credentials (documented project: `citationgenerator001`; draft generation stays unavailable when unset). |
| `GOOGLE_CLOUD_LOCATION` | Server (`auditService.ts`) | Optional | Vertex AI location/endpoint (defaults to `global`). |
| `GEMINI_MODEL` | Server (`auditService.ts`) | Optional | Gemini model ID on Vertex AI (defaults to `gemini-3.8-flash`). |
| `AUDIT_RATE_LIMIT_MAX_PER_IP` | Server (`firebaseAdmin.ts`) | Optional | Max audit submissions per IP per 15-minute window across instances (default `5`). |
| `AUDIT_RATE_LIMIT_MAX_PER_EMAIL` | Server (`firebaseAdmin.ts`) | Optional | Max audit submissions per normalized email per 60-minute window (default `2`). |
| `AUDIT_DAILY_AI_LIMIT` | Server (`firebaseAdmin.ts`) | Optional | Shared daily UTC cap on Vertex AI draft generations across both public intake and admin regeneration (default `100`). |
| `AUDIT_ADMIN_REGEN_MAX_PER_ADMIN` | Server (`firebaseAdmin.ts`) | Optional | Max admin draft regenerations per admin UID per 15-minute window (default `10`). |
| `AUDIT_ADMIN_REGEN_MAX_PER_AUDIT` | Server (`firebaseAdmin.ts`) | Optional | Max admin draft regenerations per audit ID per 15-minute window (default `3`). |
| `AUDIT_USAGE_RETENTION_DAYS` | Server (`firebaseAdmin.ts`) | Optional | Retention window in days for `audit_usage` daily counters (`expireAt` TTL, default `30`). |
| `AUDIT_DRAFT_TIMEOUT_MS` | Server (`auditService.ts`) | Optional | Hard timeout in ms for each Vertex AI draft call (default `12000`). |
| `AUDIT_DRAFT_MAX_OUTPUT_TOKENS` | Server (`auditService.ts`) | Optional | Output token cap per Vertex AI draft call (default `2048`). |
| `APP_URL` | Runtime | Optional | Public URL of the deployed instance. |
| `DISABLE_HMR` | Vite Dev Server | Optional | Set to `"true"` in iframe/agent environments to disable Vite HMR file watching. |

> **Security Note:** Never expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, or Vertex AI / Gemini configuration in browser code (`VITE_*`). No `GEMINI_API_KEY` is injected into the Vite bundle.

---

## Project Structure

```text
├── .env.example                 # Environment variable template (safe placeholders only)
├── DEVELOPER_REPORT.md          # Initial prototype UI documentation
├── firebase-applet-config.json  # Firebase project & Firestore DB client configuration
├── firebase-blueprint.json      # Formal JSON schema blueprint for Firestore entities
├── firebase.json                # Firebase CLI rules target (ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e) & emulator config
├── firestore.rules              # Hardened Cloud Firestore security rules
├── index.html                   # HTML shell (imports /src/main.tsx)
├── metadata.json                # App metadata
├── package.json                 # Dependencies and npm scripts (dev, start, build, lint, test, test:rules)
├── server.ts                    # Server entrypoint listening on process.env.PORT || 3000
├── tsconfig.json                # TypeScript config
├── vite.config.ts               # Vite + React + Tailwind v4 plugin config
├── shared/
│   ├── audit.ts                 # Canonical audit types, industry enums, and non-PII Gemini schema
│   └── catalog.ts               # Canonical product IDs, names, descriptions, and prices (cents)
├── server/
│   ├── app.ts                   # Express app factory (audits, admin review, webhook, checkout, SPA fallback)
│   ├── auditService.ts          # Audit validation, IP rate limiter, Vertex AI preliminary draft generator
│   ├── catalog.ts               # Server-side catalog allowlist validator & order calculator
│   └── firebaseAdmin.ts         # Firebase Admin SDK init, shared isAdminUser, FirestorePaymentStore, FirestoreAuditStore
├── tests/
│   ├── audits.test.ts           # Vitest + Supertest audit intake, Gemini privacy, rate-limit, and admin tests
│   ├── firestore.rules.test.ts  # Firebase Emulator tests for firestore.rules across all collections
│   └── payment.test.ts          # Vitest + Supertest security, webhook, and SPA routing suite
└── src/
    ├── main.tsx                 # React root mount
    ├── App.tsx                  # Router, ScrollToTop, AuditProvider, global layout
    ├── index.css                # Tailwind v4 import, @theme tokens, custom CSS utilities
    ├── firebase.ts              # Initializes client Firebase App, Firestore (db), and Auth (auth)
    ├── lib/
    │   └── firestoreError.ts    # Structured Firestore error logger
    ├── context/
    │   └── AuditContext.tsx     # Global modal state: openAuditModal / closeAuditModal
    ├── components/
    │   ├── Navbar.tsx           # Fixed glass navbar, route links, Google Auth login/logout
    │   ├── Footer.tsx           # Brand summary, navigation links, social icons, legal links
    │   └── AuditModal.tsx       # "Free Local Audit" modal -> submits to POST /api/audits
    └── pages/
        ├── Home.tsx             # Landing page: Hero, neighborhood marquee, services preview, stats
        ├── Services.tsx         # 3 core offerings + "Establish Your Presence" audit triggers
        ├── Work.tsx             # Local contractor case studies & results tags
        ├── Contact.tsx          # Contact form with validation & honeypot -> `leads`
        ├── Payment.tsx          # Google Auth gate, plan/menu selector, server-priced Stripe Elements
        ├── PaymentSuccess.tsx   # Server-verified order status screen (never trusts URL params)
        ├── AdminAudits.tsx      # Authenticated admin-only preliminary audit draft review queue
        ├── Privacy.tsx          # Privacy Policy with truthful data/AI/TTL disclosures & owner legal placeholders
        └── Terms.tsx            # Terms of Service with truthful audit-draft disclaimers & owner legal placeholders
```

---

## Routes &amp; User Flows

### Client Routes (`src/App.tsx`)

| Path | Component | Purpose |
| :--- | :--- | :--- |
| `/` | `Home` | Landing page with Hero, Pinal County marquee, Services preview, Stats, and Audit CTA |
| `/services` | `Services` | Detailed breakdown of *Established Local Presence*, *Instant Lead Landing Pages*, and *The Review Engine Kit* |
| `/work` | `Work` | Portfolio case studies for San Tan Valley / Queen Creek trades |
| `/contact` | `Contact` | Validated lead inquiry form submitting to Firestore `leads` |
| `/payment` | `Payment` | Plan selector, modular add-on builder, and Stripe `PaymentElement` |
| `/payment-success` | `PaymentSuccess` | Polls `GET /api/payments/:paymentIntentId` to verify confirmed payment status |
| `/admin/audits` | `AdminAudits` | Authenticated administrator-only queue for reviewing preliminary AI audit drafts |
| `/privacy` | `Privacy` | Privacy Policy disclosing audit intake, Vertex AI scrubbing, Stripe payments, and SHA-256/TTL retention |
| `/terms` | `Terms` | Terms of Service clarifying preliminary draft scope, checkout terms, and owner legal placeholders |
| `*` | `Home` | Catch-all fallback route |

---

## Backend API (`server/app.ts`)

### `POST /api/stripe-webhook`
Mounted **before** `express.json()` using `express.raw({ type: "application/json" })`.
- Verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET` using the exact raw `Buffer`.
- Processes `payment_intent.succeeded` and `payment_intent.payment_failed` inside a Firestore transaction:
  - Enforces **idempotency** via `/stripe_events/{eventId}` (duplicate deliveries return `200 { received: true, duplicate: true }`).
  - Validates `amount`, `amount_received` (when present), and `currency` against the server-stored pending payment record (`400` on mismatch).
  - Marks `"completed"` (setting `completedAt`) or `"failed"` (recording `failureReason`); completed payments cannot be downgraded by late failure events.

### `POST /api/create-payment-intent`
- **Auth:** Requires `Authorization: Bearer <firebaseIdToken>`, verified via Firebase Admin Auth. Returns `401` if missing or invalid.
- **Request Body:** `{ "productIds": ["activation"] }` or `{ "productIds": ["gap-report", "review-pack"] }`.
- **Server-Owned Catalog (`server/catalog.ts`):** Rejects unknown products, empty carts, duplicate IDs, non-purchasable parent IDs (`"tier1"`), and invalid plan+addon combinations (`400`). Completely ignores any `amount`, `currency`, `userId`, or `status` sent by the browser.
- **Persistence:** Creates the Stripe `PaymentIntent` and writes a `"pending"` document to `/payments/{paymentIntentId}` on the server before returning `{ clientSecret, paymentIntentId, amount, currency, planName }`.

### `GET /api/payments/:paymentIntentId`
- **Auth:** Requires `Authorization: Bearer <firebaseIdToken>`.
- **Authorization:** Only the payment owner (`payment.userId === decodedToken.uid`) or an authorized admin may read (`403` otherwise).
- **Response:** `{ paymentIntentId, status, amount, currency, planName, failureReason }`.

### `POST /api/audits`
- **Public Intake (`AuditModal.tsx`):** Stores review requests and prepares an **internal preliminary planning draft** only — the app does **not** automatically inspect live rankings, record videos, or send emails. Validates all fields, blocks embedded email addresses, phone numbers, or URLs inside free-text `businessName` / `serviceArea` fields, silently drops honeypot (`hpContact`) submissions, and persists requests via Firebase Admin SDK (`reviewStatus: "pending_review"`).
- **Shared Abuse Controls &amp; Deduplication:** Uses Firestore-backed transactional limits across server instances (`audit_rate_limits` per hashed IP and hashed email, returning `429` + `Retry-After`), a shared daily Vertex AI draft budget (`audit_usage`), and a 15-minute deduplication lock (`audit_dedup` using normalized request fingerprint + optional `Idempotency-Key` / `submissionId`) so timeout retries return `200 { duplicate: true }` without creating duplicate records or re-calling Vertex AI.
- **Private Preliminary Gemini Draft (Vertex AI ADC):** Sends `businessName`, `industry`, `serviceArea` (validated to block and defense-in-depth scrubbed of any embedded emails, phone numbers, or URLs), and `hasWebsiteLink` / `hasGoogleProfileLink` booleans to Vertex AI (`GEMINI_MODEL` defaulting to `gemini-3.8-flash`, bounded by `maxOutputTokens` and an `AbortController` timeout). Customer `email`, `phone`, and entered URLs are never sent to Gemini. Output is labeled **"PRELIMINARY RECOMMENDATIONS — NOT A VERIFIED LIVE AUDIT"** and never returned in the public HTTP response or emailed automatically.

### `GET /api/admin/audits`, `PATCH /api/admin/audits/:auditId/review`, `POST /api/admin/audits/:auditId/regenerate-draft`
- **Auth, Revocation &amp; Role Gate:** Verifies Firebase ID tokens with **revocation checking enabled** (`verifyIdToken(token, true)`), fails closed with `503` if Firestore admin verification errors, and requires verified administrator status (`403` otherwise).
- **Manual Human Review Workflow:** Strategists sign into `/admin/audits`, manually inspect the business's live Google Business Profile, website, reviews, and local rankings outside the app, update `reviewStatus` (`pending_review`, `approved`, `needs_revision`, `archived`) + `reviewerNotes`, and manually send any follow-up email or personally recorded video breakdown only after human verification.

### `GET /api/health` &amp; SPA Fallback
- `GET /api/health` returns `200 { "status": "ok" }`.
- Unknown `/api/*` routes return JSON `404`.
- In production (`NODE_ENV=production`), Express serves `dist/` and falls back all non-API GET routes to `dist/index.html` so direct browser visits or refreshes on `/services`, `/payment`, `/payment-success`, `/admin/audits`, etc. work cleanly.

---

## Stripe Checkout &amp; Webhook Lifecycle

1. **Auth Gate (`Payment.tsx`):** Selecting a plan ensures the customer is signed in with Google (`signInWithPopup`). `auth/popup-closed-by-user` cancellations fail silently.
2. **Product Selection:** Customers pick `"activation"` ($199) or one or more add-ons from `"tier1"` (`"gap-report"` $49, `"review-pack"` $29, `"local-pulse"` $29, `"site-refresh"` $39).
3. **Server Intent &amp; Pending Record:** Browser sends `{ productIds }` + Firebase ID token to `POST /api/create-payment-intent`. The server calculates the USD total, creates the Stripe `PaymentIntent`, and records `status: "pending"` in Firestore. Browser has **zero** write permission on `/payments`.
4. **Card Confirmation:** `CheckoutForm` calls `stripe.confirmPayment(..., { redirect: "if_required" })` and navigates to `/payment-success?payment_intent=<id>`.
5. **Webhook Reconciliation &amp; Verified Success Page:**
   - Stripe delivers `payment_intent.succeeded` or `payment_intent.payment_failed` to `POST /api/stripe-webhook`.
   - `PaymentSuccess.tsx` ignores URL parameters like `redirect_status=succeeded` and instead fetches `GET /api/payments/:paymentIntentId` with the user's Firebase ID token, polling briefly while `status === "pending"` and confirming only when the server returns `status === "completed"`.

---

## Firebase &amp; Firestore Schema

Initialized client-side in `src/firebase.ts` and server-side in `server/firebaseAdmin.ts` against `projectId` (`citationgenerator001`) and `firestoreDatabaseId` (`ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e`) from `firebase-applet-config.json` (with `FIREBASE_PROJECT_ID` / `FIREBASE_DATABASE_ID` env overrides).

Formal schemas live in `firebase-blueprint.json` and are enforced in `firestore.rules`:

| Collection | Read Access | Client Write Access | Validation &amp; Abuse Protections |
| :--- | :--- | :--- | :--- |
| `/audits/{auditId}` | Admin only | **Denied (`if false`)** | Submitted via server `POST /api/audits` (server-side validation, IP rate limiting, honeypot) and managed strictly via Firebase Admin SDK. |
| `/leads/{leadId}` | Admin only | Public `create` only | Required/allowed keys only, length caps (`name` 1–100, `email` 5–254, `brand` ≤120, `message` ≤2000), service enum, email regex, `createdAt == request.time`, valid doc ID regex. Client forms enforce `maxLength`, trimming, and a hidden honeypot. |
| `/payments/{paymentId}` | Owner (`userId == auth.uid`) or Admin | **Denied (`if false`)** | Created &amp; updated strictly by server via Firebase Admin SDK &amp; verified Stripe webhooks. |
| `/users/{userId}` | Owner or Admin | Verified owner only | Strict `hasAll`/`hasOnly` (`displayName`, `email`, `updatedAt`), blocks self-assigned `role`/`isAdmin` fields. |
| `/admins/{adminId}` | **Denied (`if false`)** | **Denied (`if false`)** | Managed strictly via Firebase Console or Admin SDK. |
| `/stripe_events/{eventId}` | **Denied (`if false`)** | **Denied (`if false`)** | Server-only idempotency log for processed Stripe webhook event IDs. |
| `/audit_rate_limits/{limitId}` | **Denied (`if false`)** | **Denied (`if false`)** | Server-only hashed IP/email/admin-regen rate-limit buckets with `expireAt` TTL timestamps. |
| `/audit_usage/{usageId}` | **Denied (`if false`)** | **Denied (`if false`)** | Server-only daily UTC counter capping Vertex AI draft generations (`expireAt` TTL, default 30d). |
| `/audit_dedup/{dedupId}` | **Denied (`if false`)** | **Denied (`if false`)** | Server-only 15-minute full-field deduplication locks with `expireAt` TTL timestamps. |

> **Important Abuse-Protection Note:** Firestore Security Rules validate document shape, field types, length bounds, and server timestamps, **not per-IP rate limiting**. To mitigate automated spam at scale in production, enable **Firebase App Check** (reCAPTCHA Enterprise) on Firestore or route `leads` and `audits` through a rate-limited Express endpoint behind Cloud Armor / reverse-proxy rate limiting.

---

## Admin Authorization Setup

`firestore.rules` (`isAdmin()`) and `server/firebaseAdmin.ts` (`isAdminUser()`) enforce a consistent three-tier admin policy:

1. **Custom Auth Claim (`request.auth.token.admin == true`)** — Fast, zero-read RBAC claim set via Firebase Admin SDK:
   ```ts
   await adminAuth.setCustomUserClaims(uid, { admin: true });
   ```
   *(User must sign out and back in for the new token claim to refresh.)*
2. **Admin Allowlist Collection (`/admins/{uid}`)** — Maintainable in the Firebase Console without redeploying rules:
   - Open **Firestore Database** in the Firebase Console (database `ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e`).
   - Create collection `admins` and add a document whose **Document ID** is the admin user's **Firebase Auth UID** (e.g., `{ email: "jeremycodjoe@gmail.com" }`).
   - Because `/admins` has `allow read, write: if false;` for clients, nobody can self-promote.
3. **Verified Bootstrap Owner Fallback:**
   - Case-insensitive `jeremycodjoe@gmail.com` with `email_verified == true` in both `firestore.rules` and `server/firebaseAdmin.ts`.
   - **Intentional Server-Only Difference (`ADMIN_EMAIL`):** `server/firebaseAdmin.ts` also checks an optional `ADMIN_EMAIL` env var for Express API routes, which Firestore Security Rules cannot read. To grant additional team members admin access across **both** Express APIs and Firestore Rules, use `/admins/{uid}` or custom claim `admin: true`.

---

## Firebase Google Auth &amp; Authorized Domains Setup

Before launching on your production domain:

1. **Enable Google Sign-In Provider:**
   - Open [Firebase Console](https://console.firebase.google.com/) &rarr; select project **`citationgenerator001`**.
   - Go to **Authentication &rarr; Sign-in method**.
   - Click **Add new provider &rarr; Google**, toggle **Enable**, set your **Support email**, and save.
2. **Add Production &amp; Preview Domains to Authorized Domains:**
   - Go to **Authentication &rarr; Settings &rarr; Authorized domains**.
   - Click **Add domain** and add:
     - Your production custom domain (e.g. `vibegrowth.agency` and `www.vibegrowth.agency`)
     - Any Cloud Run / preview hostname used for staging (e.g. `ais-pre-vfdbhjhxpyeab3bf4t7g3b-194977628392.us-west2.run.app`).
   - Keep `localhost` enabled for local development.
3. **Deploy Updated Firestore Rules & Enable Firestore TTL Policies:**
   - Deploy `firestore.rules` to database `ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e` using an explicit project argument (`firebase deploy --only firestore:rules --project citationgenerator001`) or the Firebase Console Rules editor before accepting live traffic. (No `.firebaserc` default project is configured so Firebase CLI commands never target production implicitly; `npm run test:rules` stays isolated to `--project demo-vibegrowth`.)
   - Enable native Firestore TTL on field `expireAt` for `audit_rate_limits`, `audit_dedup`, and `audit_usage` in database `ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e`:
     ```bash
     for col in audit_rate_limits audit_dedup audit_usage; do
       gcloud firestore fields ttls update expireAt \
         --collection-group="$col" \
         --database="ai-studio-59e233ea-2c5c-48d6-94ee-4b317d14862e" \
         --project=citationgenerator001 \
         --enable-ttl
     done
     ```
4. **Complete Legal Placeholders Before Launch:**
   - Replace all `[OWNER ACTION REQUIRED: ...]` fields in `src/pages/Privacy.tsx` and `src/pages/Terms.tsx` with your legal entity name, mailing address, jurisdiction, effective date, and contact emails.

---

## Stripe Dashboard Setup Checklist

1. **Test Mode First:** Start with Stripe **Test Mode** keys (`pk_test_...` and `sk_test_...`) in your hosting secret manager.
2. **Configure Webhook Endpoint:**
   - In Stripe Dashboard &rarr; **Developers &rarr; Webhooks &rarr; Add endpoint**.
   - Set **Endpoint URL** to `https://<your-domain>/api/stripe-webhook`.
   - Select events:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
   - Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in your hosting secret manager.
3. **Local Webhook Testing (Optional):**
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe-webhook
   ```
   Copy the CLI's temporary `whsec_...` into `.env` while testing locally.

---

## Design System &amp; Styling

Defined in `src/index.css` using Tailwind CSS v4 `@theme`:

- **Colors:**
  - `--color-brand-primary`: `#FF5C00` (Vibrant Orange)
  - `--color-brand-secondary`: `#1A1A1A` (Deep Charcoal)
  - `--color-brand-accent`: `#00F0FF` (Cyan)
  - Base `body` background: `#0A0A0A`
- **Typography:**
  - Display: `"Space Grotesk"` (`font-display`)
  - Body: `"Inter"` (`font-sans`)
- **Custom Utilities (`src/index.css`):**
  - `.glass` — Translucent card surface (`rgba(255, 255, 255, 0.03)`, `blur(12px)`, subtle white border)
  - `.text-stroke` — Transparent fill with `1px rgba(255, 255, 255, 0.3)` outline
  - `.marquee-track` — Infinite horizontal scroll animation (`30s linear infinite`)

---

## Human &amp; AI Developer Guardrails

1. **Single Server on `process.env.PORT || 3000`:** `server.ts` / `server/app.ts` serves both `/api/*` and the frontend SPA (`vite.middlewares` in dev, `dist/` in prod). Keep `/api/stripe-webhook` (`express.raw`) registered **before** `express.json()`.
2. **Never Trust Browser Totals or Query Strings:** Always add/modify products in `shared/catalog.ts` and validate via `server/catalog.ts`. Never mark payments complete from browser code or URL query strings.
3. **Iframe Compatibility:** Keep `referrerPolicy="no-referrer"` on external `<img>` tags, `redirect: "if_required"` on `stripe.confirmPayment()`, and avoid `window.alert` / `window.open`.
4. **Popup Auth Handling:** Keep the `error.code === "auth/popup-closed-by-user"` guard in `handleLogin` (`Navbar.tsx`, `Payment.tsx`, `PaymentSuccess.tsx`).
5. **Single Source of Truth for Modals:** Use `useAudit()` from `src/context/AuditContext.tsx` to trigger `AuditModal`.
6. **Verify Before Finishing:** Run `npm run lint`, `npm test`, and `npm run build` after changes.
