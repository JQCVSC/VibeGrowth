<div align="center">
  <img src="https://i.imgur.com/nI2CZ2l.png" alt="VibeGrowth Agency Logo" height="88" />
  <h1>VibeGrowth Agency</h1>
  <p><strong>Hyper-local growth agency web application</strong> built for San Tan Valley &amp; Pinal County, AZ service professionals (roofing, landscaping, plumbing, HVAC, electrical, and home services).</p>
</div>

VibeGrowth combines a dark-editorial marketing frontend, a free local audit intake pipeline, Google OAuth authentication, and a modular Stripe checkout flow backed by Express and Cloud Firestore.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Quickstart](#quickstart)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Routes & User Flows](#routes--user-flows)
- [Backend API (`server.ts`)](#backend-api-serverts)
- [Stripe Checkout Lifecycle](#stripe-checkout-lifecycle)
- [Firebase & Firestore Schema](#firebase--firestore-schema)
- [Design System & Styling](#design-system--styling)
- [Human & AI Developer Guardrails](#human--ai-developer-guardrails)

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript 5.8, Vite 6 | SPA UI and component architecture |
| **Routing** | `react-router-dom` v7 | Client-side navigation + `ScrollToTop` |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite`) | Utility styling + `@theme` design tokens |
| **Motion & Icons** | `motion` (`motion/react`), `lucide-react` | Scroll/enter animations and UI iconography |
| **Backend** | Express 4 + `tsx` (`server.ts`) | Serves `/api/*` routes, Vite dev middleware, and `dist/` in prod |
| **Database & Auth** | Firebase v12 (Firestore + Google Auth) | Lead/audit/payment persistence and user sign-in |
| **Payments** | `stripe` (Node) + `@stripe/react-stripe-js` | Server-side `PaymentIntent` + embedded `PaymentElement` |
| **AI SDK** | `@google/genai` | Installed for future automated audit/report workflows |

---

## Quickstart

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env` (or configure secrets in your hosting environment) and populate the keys listed below.

### 3. Run the development server
The Express server mounts Vite in middleware mode on **port `3000`**:
```bash
npm run dev
```

### 4. Type-check & build for production
```bash
npm run lint     # Runs tsc --noEmit
npm run build    # Outputs production bundle to dist/
npm run clean    # Removes dist/
```

---

## Environment Variables

Defined in `.env.example`:

| Variable | Scope | Required | Description |
| :--- | :--- | :--- | :--- |
| `STRIPE_SECRET_KEY` | Server (`server.ts`) | For live/test payments | Stripe secret key (`sk_test_...` / `sk_live_...`). Missing key returns HTTP `503` gracefully. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Client (`Payment.tsx`) | For live/test payments | Stripe publishable key (`pk_test_...` / `pk_live_...`). Missing key shows a "Payment Setup Required" dev notice instead of crashing. |
| `GEMINI_API_KEY` | Server / Build (`vite.config.ts`) | Optional | Gemini API key injected via secrets for future AI features. |
| `APP_URL` | Runtime | Optional | Public URL of the deployed Cloud Run / preview instance. |
| `DISABLE_HMR` | Vite Dev Server | Optional | Set to `"true"` in iframe/agent environments to disable Vite HMR file watching. |

> **Security Note:** Never expose `STRIPE_SECRET_KEY` with a `VITE_` prefix. Only `VITE_*` variables are bundled into client code.

---

## Project Structure

```text
├── .env.example                 # Environment variable template
├── DEVELOPER_REPORT.md          # Earlier visual/prototype design summary
├── firebase-applet-config.json  # Firebase project & Firestore DB configuration
├── firebase-blueprint.json      # Formal JSON schema blueprint for Firestore entities
├── firestore.rules              # Cloud Firestore security rules
├── index.html                   # HTML shell (imports /src/main.tsx)
├── metadata.json                # App metadata (name, description, permissions)
├── package.json                 # Dependencies and npm scripts
├── server.ts                    # Express server (port 3000): API routes + Vite/static serving
├── tsconfig.json                # TypeScript config (ES2022, bundler resolution, @/* alias)
├── vite.config.ts               # Vite + React + Tailwind v4 plugin config
└── src/
    ├── main.tsx                 # React root mount
    ├── App.tsx                  # Router, ScrollToTop, AuditProvider, global layout
    ├── index.css                # Tailwind v4 import, @theme tokens, .glass/.text-stroke/.marquee-track
    ├── firebase.ts              # Initializes Firebase App, Firestore (db), and Auth (auth)
    ├── context/
    │   └── AuditContext.tsx     # Global modal state: { isAuditModalOpen, openAuditModal, closeAuditModal }
    ├── components/
    │   ├── Navbar.tsx           # Fixed glass navbar, route links, Google Auth login/logout
    │   ├── Footer.tsx           # Brand summary, navigation links, social icons, legal links
    │   └── AuditModal.tsx       # "Free Local Audit" modal -> writes to Firestore `audits`
    └── pages/
        ├── Home.tsx             # Hero, neighborhood marquee, services preview, stats, audit CTA
        ├── Services.tsx         # 3 core offerings + "Establish Your Presence" audit triggers
        ├── Work.tsx             # Local contractor case studies & results tags
        ├── Contact.tsx          # Contact form -> writes to Firestore `leads`
        ├── Payment.tsx          # 3-step pricing/menu/Stripe Elements checkout flow
        └── PaymentSuccess.tsx   # Confirms payment & updates Firestore `payments` status -> "completed"
```

---

## Routes & User Flows

### Client Routes (`src/App.tsx`)

| Path | Component | Purpose |
| :--- | :--- | :--- |
| `/` | `Home` | Landing page with Hero, Pinal County marquee, Services preview, Stats, and Audit CTA |
| `/services` | `Services` | Detailed breakdown of *Established Local Presence*, *Instant Lead Landing Pages*, and *The Review Engine Kit* |
| `/work` | `Work` | Portfolio case studies for San Tan Valley / Queen Creek trades |
| `/contact` | `Contact` | Lead inquiry form submitting directly to Firestore `leads` |
| `/payment` | `Payment` | Plan selector, modular add-on builder, and embedded Stripe `PaymentElement` |
| `/payment-success` | `PaymentSuccess` | Confirmation screen reconciling `payment_intent` status in Firestore |
| `*` | `Home` | Catch-all fallback route |

### Global Audit Modal Flow
1. Any CTA calling `openAuditModal()` (from `useAudit()` in `src/context/AuditContext.tsx`) opens `AuditModal`.
2. Submitting the form writes `{ businessName, industry, email, phone, createdAt: serverTimestamp() }` to the Firestore `audits` collection.
3. Displays a 24-hour personalized video audit confirmation state.

---

## Backend API (`server.ts`)

The backend runs on **Express 4** (`PORT = 3000`, bound to `0.0.0.0`).

### `POST /api/create-payment-intent`
Creates a Stripe `PaymentIntent` for the client checkout session.

- **Request Body:**
  ```json
  {
    "amount": 19900,
    "currency": "usd"
  }
  ```
  *`amount` is in cents (e.g., `19900` = `$199.00`). `currency` defaults to `"usd"`.*
- **Success Response (`200 OK`):**
  ```json
  {
    "clientSecret": "pi_3..._secret_..."
  }
  ```
- **Missing Configuration (`503 Service Unavailable`):**
  Returned when `STRIPE_SECRET_KEY` is unset so the server stays healthy in dev/preview mode.
- **Stripe Error (`500 Internal Server Error`):**
  Returns `{ "error": "<stripe error message>" }`.

### Static / Dev Middleware
- `NODE_ENV !== "production"`: Attaches `vite.middlewares` in SPA mode.
- `NODE_ENV === "production"`: Serves static assets from `dist/` and falls back to `dist/index.html` for client-side routing.

---

## Stripe Checkout Lifecycle

Implemented across `src/pages/Payment.tsx`, `server.ts`, and `src/pages/PaymentSuccess.tsx`:

1. **Auth Gate:** Selecting a plan on `/payment` checks `auth.currentUser`. Unauthenticated users are prompted with `signInWithPopup(auth, new GoogleAuthProvider())`. Popup cancellation (`auth/popup-closed-by-user`) is silently ignored.
2. **Plan / Menu Selection (`step: "plans" | "selection"`):**
   - **The Activation (`activation`):** `$199` one-time setup (`19900` cents) proceeds straight to checkout.
   - **On-Demand Growth Menu (`tier1`):** Opens a multi-select sub-menu (`gap-report` `$49`, `review-pack` `$29`, `local-pulse` `$29`, `site-refresh` `$39`) and dynamically calculates the total in cents.
3. **Intent Initialization (`step: "checkout"`):**
   - Calls `POST /api/create-payment-intent` with the calculated `amount`.
   - Mounts `<Elements stripe={stripePromise} options={{ clientSecret, appearance }}>` using a custom Stripe `night` theme matched to `#FF5C00` and `#1A1A1A`.
4. **Submission & Firestore Pre-Record:**
   - Before confirming the card, `CheckoutForm` writes a `"pending"` document to Firestore `payments` containing `userId`, `amount`, `planName`, `status: "pending"`, `createdAt`, and `stripePaymentIntentId`.
   - Calls `stripe.confirmPayment({ elements, confirmParams: { return_url }, redirect: 'if_required' })`.
   - Using `redirect: 'if_required'` keeps payment confirmation inside the SPA/iframe and navigates manually on success to `/payment-success?payment_intent=<id>&redirect_status=succeeded`.
5. **Reconciliation (`PaymentSuccess.tsx`):**
   - Queries Firestore `payments` where `stripePaymentIntentId == paymentIntentId` and `userId == auth.currentUser.uid`, then updates `status` to `"completed"`.

> **Roadmap Note:** Client-side status updates on `/payment-success` work in standard flows, but adding a server-side Stripe webhook (`/api/webhook`) is recommended before high-volume production launch so payments reconcile even if a customer closes the tab immediately after submitting.

---

## Firebase & Firestore Schema

Initialized in `src/firebase.ts` using `firebase-applet-config.json` (which sets `firestoreDatabaseId` explicitly on `getFirestore(app, firebaseConfig.firestoreDatabaseId)`).

Formal entity definitions live in `firebase-blueprint.json`, enforced by `firestore.rules`:

### Collections

#### 1. `/audits/{auditId}`
Stores free local visibility audit requests (`AuditModal.tsx`).
- **Fields:** `businessName` *(string, req)*, `industry` *(string, req)*, `email` *(string, req)*, `phone` *(string, opt)*, `createdAt` *(timestamp, req)*
- **Rules:** `create: if true` (public intake); `read, update, delete: if isAdmin()`

#### 2. `/leads/{leadId}`
Stores general contact form submissions (`Contact.tsx`).
- **Fields:** `name` *(string, req)*, `email` *(string, req)*, `brand` *(string, opt)*, `service` *(string, req)*, `message` *(string, opt)*, `createdAt` *(timestamp, req)*
- **Rules:** `create: if true` (public intake); `read, update, delete: if isAdmin()`

#### 3. `/payments/{paymentId}`
Tracks Stripe checkout attempts and completed purchases (`Payment.tsx`, `PaymentSuccess.tsx`).
- **Fields:** `userId` *(string, req)*, `amount` *(number in cents, req)*, `planName` *(string, opt/code)*, `status` *(`"pending" | "completed" | "failed"`, req)*, `stripePaymentIntentId` *(string)*, `createdAt` *(timestamp, req)*
- **Rules:**
  - `read`: authenticated owner (`request.auth.uid == resource.data.userId`) or admin
  - `create`: authenticated owner (`request.resource.data.userId == request.auth.uid`)
  - `update, delete`: admin only *(note: check `firestore.rules` if client-side `PaymentSuccess.tsx` updates require user-level update permissions or a server-side webhook)*

#### 4. `/users/{userId}`
Reserved for per-user profile documents.
- **Rules:** `read, write: if isAuthenticated() && (request.auth.uid == userId || isAdmin())`

> **Admin Check:** `isAdmin()` in `firestore.rules` is tied to `request.auth.token.email == "jeremycodjoe@gmail.com"`.

---

## Design System & Styling

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

## Human & AI Developer Guardrails

If you (or an AI coding agent) are extending this repo, keep these codebase-specific rules in mind:

1. **Always Run on Port 3000 (`server.ts`):** Do not separate Vite and Express onto different ports—`server.ts` serves both `/api/*` and the frontend SPA from port `3000`.
2. **Iframe Compatibility:**
   - External images (`<img>`) use `referrerPolicy="no-referrer"` so third-party CDNs load cleanly inside embedded preview iframes.
   - Stripe checkout uses `redirect: 'if_required'` + React Router navigation instead of hard full-page redirects.
   - Avoid `window.alert` or `window.open`.
3. **Firebase Rules vs. Client Updates:** Notice in `firestore.rules` that `/payments/{paymentId}` currently sets `allow update, delete: if isAdmin();`, while `PaymentSuccess.tsx` attempts a client-side `updateDoc` as the logged-in user. Non-admin test accounts will hit a Firestore permission error on `updateDoc` unless you either add a Stripe webhook (recommended) or allow owner status updates in `firestore.rules`.
4. **Popup Auth Handling:** Keep the `error.code === 'auth/popup-closed-by-user'` guard in `handleLogin` (`Navbar.tsx` and `Payment.tsx`) so closing the Google sign-in modal doesn't surface false errors.
5. **Single Source of Truth for Modals:** Do not duplicate modal state in pages—use `useAudit()` from `src/context/AuditContext.tsx` to trigger `AuditModal`.
6. **Verify Before Finishing:** Run `npm run lint` and `npm run build` after any TypeScript or component changes.
