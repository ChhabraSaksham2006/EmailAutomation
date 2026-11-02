# OutreachGuard — Cold Outreach Email App (MERN + BullMQ + Gmail API)

Built according to the **Cold Outreach Email App: Ready-to-Go Build Plan**.

## Architecture & Monorepo Structure

```
/client      React + Vite + Tailwind UI (8 operator screens + public one-click unsubscribe)
/server      Express API, Mongoose models, Gmail API MIME composer, pre-send gate, circuit breaker
/worker      BullMQ background worker, 1-minute scheduler, paced sender, 4-minute reply & bounce poller
/shared      Handlebars-style template renderer, header sanitizer, HMAC & AES-256-GCM crypto, timezone windows
render.yaml  Render Blueprint for client Static Site, api Web Service, worker Background Worker, and Redis
```

## Key Safeguards & Hard Limits Built In

| Safeguard | Enforcement |
| --- | --- |
| **Hard bounce rate** | Target < 2%; **Circuit breaker automatically pauses mailbox at >= 3% rolling 7-day bounce rate** |
| **Spam complaints** | Target 0; **Any complaint immediately pauses the mailbox** and requires operator review before resuming |
| **Daily sends per mailbox** | Recommended 30–40, **hard ceiling 50/day**; remaining queue rolls to next day |
| **Sequence length** | **Maximum 3 steps**; automatically stops on reply, bounce, or opt-out |
| **Pacing & send windows** | Random **2 to 6 minute gap** per mailbox; sends only inside recipient local timezone window (default Tue–Thu, 09:00–11:00) |
| **Idempotency** | Unique index on `SendLog(enrollmentId, step)` ensures worker restarts or retries never send the same step twice |
| **Personalization** | `{{custom_opener}}` required for every contact; headers sanitized against CRLF injection; plain-text MIME only |
| **Compliance** | Global suppression checked at import, queue, and send time; RFC 8058 `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; region clearance flags; GDPR erase-to-SHA256-hash |

## Quick Start (Local Development)

1. Copy `.env.example` to `.env` and set `MONGO_URI` (and optional `REDIS_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`):
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Start the API server (includes optional embedded scheduler/poller when `ENABLE_EMBEDDED_WORKER=true`) and React client:
   ```bash
   npm run dev:server
   npm run dev:client
   ```
   Or run the standalone BullMQ worker in a separate terminal:
   ```bash
   npm run dev:worker
   ```
