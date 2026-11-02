# Cold Outreach Email App: Ready-to-Go Build Plan

Prepared 2 November 2026 · Stack: MERN on Render · Sending: Gmail API from your own mailboxes

## 0. Decisions and assumptions

- **Brevo is out for cold outreach.** Its anti-spam policy bans unsolicited email and scraped or purchased lists, and violations can mean immediate suspension. Keep Brevo (if at all) for opted-in and transactional mail on your main domain.
- **Sending method:** real mailboxes on a separate domain, sent through the Gmail API over HTTPS. This avoids Render’s SMTP port block on free services. If you use Microsoft 365, swap in Microsoft Graph `sendMail`; everything else stays the same.
- **Assumptions (change if wrong):** Google Workspace; B2B prospects; starting volume of 100 to 1,500 emails a month; one or two operators; you own your main domain.
- **No tool can guarantee inbox placement.** This plan maximizes your odds legitimately: authentication, verified and targeted lists, a slow ramp, short plain-text mail, instant opt-outs, and automatic pausing.
- **Legal:** this is not legal advice. Rules depend on where recipients are (US CAN-SPAM, EU/UK GDPR and PECR, Canada CASL, India DPDP). Section 10 builds the controls into the app; have a lawyer confirm your lawful basis.
- **Out of scope on purpose:** fake warm-up networks, rotating domains to dodge blocklists, scraped lists, hidden sender identity.

## 1. Targets and hard limits

| Metric | Target | Automatic action |
| --- | --- | --- |
| Hard bounce rate | under 2% | Pause mailbox at 3% |
| Spam complaints | 0 | Pause mailbox on any complaint; review before resuming |
| Daily sends per mailbox | 30 to 40 (ceiling 50) | Queue rolls to next day |
| Sequence length | 3 emails maximum | Stop on reply, bounce, or opt-out |
| Reply rate (benchmark) | 2% to 8% | Review copy and targeting if lower |
| Opt-out processing | immediate | Add to suppression list at once |

## 2. Week 0: do these first

1. Buy a **secondary domain** that is clearly your brand (for example getbrand.com or brandhq.com). Avoid hyphens and odd spellings.
2. Add it to Google Workspace and create **2 mailboxes** with real people’s names (firstname@).
3. Set DNS: MX (Google), SPF (`v=spf1 include:_spf.google.com ~all`), DKIM (generate in Google Admin, publish the TXT record), DMARC (`p=none` with a `rua=` reporting address).
4. Point the domain’s website to your main site, or publish a simple one-pager with contact and privacy details.
5. Register the domain in Google Postmaster Tools.
6. Start using the mailboxes normally (real conversations, replies, sign-ups) for two weeks. No outreach yet.
7. Create accounts: Render, MongoDB Atlas, GitHub, Google Cloud project (Gmail API enabled), and an email verification service (ZeroBounce, NeverBounce, or similar).
8. Write down your ideal customer profile, your offer in one sentence, and why each type of prospect is relevant. This becomes your lawful-basis record.

## 3. Architecture

| Service | Render type | Purpose |
| --- | --- | --- |
| `client` | Static Site | React UI |
| `api` | Web Service (paid instance, so it does not sleep) | Auth, campaigns, imports, webhooks, unsubscribe |
| `worker` | Background Worker | Scheduler, sender, reply and bounce poller |
| `redis` | Key Value | BullMQ queues |
| MongoDB | Atlas (external) | Data |

Flow: import contacts → verify → build sequence → pre-send gate → scheduler creates send slots → worker sends via Gmail API → poller detects replies and bounces → recipients and sequences update automatically.

## 4. Repo structure and environment variables

```
/client      React app
/server      Express API (routes, models, services)
/worker      BullMQ processors, scheduler, pollers
/shared      Template rendering, validators, constants
```

Environment variables: `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `APP_BASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON` (or client ID/secret if using OAuth), `TOKEN_ENCRYPTION_KEY`, `VERIFIER_API_KEY`, `UNSUBSCRIBE_SIGNING_SECRET`, `SENDER_POSTAL_ADDRESS`.

**Mailbox access.** If the mailboxes are in your own Workspace org, use a service account with domain-wide delegation (scopes `gmail.send` and `gmail.readonly`, authorized in Admin console). This avoids per-user OAuth flows and Google app verification. If you use plain OAuth instead, keep the consent screen set to Internal for your org; External apps in testing mode have short-lived refresh tokens.

## 5. Data models (MongoDB)

- **User:** email, passwordHash, role.
- **Mailbox:** address, displayName, status (`warming`, `active`, `paused`), dailyCap, sentToday, warmupStartDate, health (bounce and complaint counters), credentials reference.
- **Contact:** email, firstName, company, title, timezone, country, `variables` (object, includes `custom_opener`), source, sourceNote, lawfulBasis, verificationStatus (`valid`, `risky`, `invalid`), status (`active`, `replied`, `bounced`, `opted_out`), createdAt.
- **Suppression:** email or domain, reason (`opt_out`, `bounce`, `complaint`, `manual`), createdAt. Global, checked everywhere.
- **Sequence:** name, steps \[{ delayDays, subjectTemplate, bodyTemplate }\], sendWindow (days, hours), stopRules.
- **Campaign:** name, sequenceId, mailboxIds, contactIds, status (`draft`, `ready`, `running`, `paused`, `done`).
- **Enrollment:** campaignId, contactId, mailboxId, currentStep, nextSendAt, status, threadId, lastMessageId.
- **SendLog:** enrollmentId, step, gmailMessageId, sentAt, error.
- **Event:** type (`reply`, `bounce`, `opt_out`, `error`), enrollmentId, raw payload summary.

Indexes: `Enrollment(status, nextSendAt)`, `Contact(email unique)`, `Suppression(email)`, `SendLog(enrollmentId, step unique)`.

## 6. API endpoints

- `POST /auth/login`, `POST /auth/register` (registration disabled after the first admin)
- `GET/POST /mailboxes`, `POST /mailboxes/:id/pause`, `POST /mailboxes/:id/resume`
- `POST /contacts/import` (CSV with column mapping), `POST /contacts/verify`, `GET /contacts`
- `GET/POST /sequences`, `PUT /sequences/:id`
- `POST /campaigns`, `POST /campaigns/:id/preview` (row index), `POST /campaigns/:id/test-send`, `POST /campaigns/:id/gate-check`, `POST /campaigns/:id/start`, `/pause`, `/resume`
- `GET /campaigns/:id/stats`, `GET /replies`
- `GET /unsubscribe/:token`, `POST /unsubscribe/:token` (one-click)
- `GET/POST /suppression`

## 7. Sending engine

**Scheduler (runs every minute in the worker).** Find Enrollments where `status = active` and `nextSendAt <= now`. Skip any whose contact is suppressed, replied, or bounced. For each mailbox, stop when `sentToday` reaches `dailyCap`. Only enqueue inside the send window in the recipient’s timezone (default Tuesday to Thursday, 9:00 to 11:00; widen to Monday and Friday later).

**Pacing.** Enqueue sends with a random gap of 2 to 6 minutes per mailbox. Never burst.

**Sender job.**

1. Re-check suppression and contact status right before sending.
2. Render subject and body (Section 9). Abort and flag if any required variable is empty.
3. Build a plain-text MIME message (Nodemailer’s `MailComposer` works for this). Set `From`, `Reply-To` (same mailbox), `To`, `Subject`, `Message-ID`, `List-Unsubscribe` (mailto and HTTPS), `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
4. For follow-ups, set `In-Reply-To` and `References` to the previous message and send with the same `threadId`, so they appear in the same thread.
5. Base64url-encode and call `users.messages.send`.
6. Save `gmailMessageId` and `threadId`, write SendLog, compute the next step’s `nextSendAt`.

**Idempotency.** `SendLog(enrollmentId, step)` is unique. A retry or worker restart can never send the same step twice.

**Errors.** Retry only temporary errors (429, 5xx) with exponential backoff, maximum 3 tries. Never retry invalid-address errors; mark the contact bounced and suppress.

**Circuit breaker.** After each bounce or error event, recompute the mailbox’s rolling 7-day bounce rate. If it passes 3%, or a complaint is recorded, set mailbox status to `paused` and alert you by email.

## 8. Reply and bounce detection

- Every 3 to 5 minutes, poll each mailbox with `users.messages.list` (query `in:inbox newer_than:2d`), then fetch new messages by thread ID.
- A message in a known thread from the prospect means a **reply**: set the enrollment to `replied`, cancel future steps, and show it in the Replies screen.
- Messages from `mailer-daemon` or `postmaster` mean a **bounce**: parse the failed address, mark the contact bounced, add to Suppression.
- Auto-replies (out of office) should not count as replies. Detect them with the `Auto-Submitted` header and common subject patterns, and delay the next step instead of cancelling it.
- Replies containing opt-out language (“unsubscribe”, “remove me”, “stop”, “not interested”) are flagged for one-click suppression, and the contact is paused until you review it.

## 9. Personalization

- Use Handlebars-style variables: `{{first_name}}`, `{{company}}`, `{{custom_opener}}`, with fallbacks such as `{{default first_name "there"}}`.
- **`custom_opener` is required** for every contact. It is one or two sentences you wrote from real research about that prospect. This is what makes the email read as personal, and it is the main difference between outreach and spam.
- Before sending, validate that every variable used in the template resolves for every contact. Block the campaign or show the exact rows that fail.
- **Sanitize all variable values.** Strip line breaks and control characters from anything that goes into headers, to prevent header injection. Plain text only, so there is no HTML injection risk.
- Preview any row exactly as it will be sent, and send a test to yourself.

## 10. Compliance controls

- **Global suppression list**, checked at import, at queue time, and again at send time.
- **Region flags:** each contact has a country. Regions you have not cleared (for example EU/UK individuals, Canada) are blocked by default and need an explicit override with a recorded lawful basis.
- **Required footer fields** in every email: real sender name, company, physical address, and an opt-out line.
- **Opt-out within one business day**, ideally immediately through the unsubscribe link or a reply keyword.
- **Record per contact:** source, why they are relevant, lawful basis, and date added.
- **Deletion on request:** an admin action that removes a contact’s data and keeps only a hashed entry in Suppression, so they are not re-added.
- **Import rule:** no purchased or bulk-scraped lists. The import screen requires the operator to confirm how the list was sourced.

## 11. Message playbook (starter sequence)

**Email 1** (day 0) Subject: Quick question about {{company}}

Hi {{first\_name}},

{{custom\_opener}}

I help {{target\_role\_plural}} with {{one\_line\_value}}. Would a short chat be worth it to see if it’s relevant for {{company}}?

If not, just reply “no thanks” and I won’t follow up.

{{sender\_name}} {{sender\_title}}, {{sender\_company}} {{sender\_address}}

**Email 2** (day 4, same thread) Hi {{first\_name}}, following up in case my note got buried. {{follow\_up\_angle}} I’m happy to send details by email if that’s easier. A quick “not now” is welcome too.

**Email 3** (day 9, same thread) Hi {{first\_name}}, last note from me. If {{topic}} isn’t a priority right now, no problem at all. If it becomes one, you know where to find me.

Rules: 50 to 120 words, no images, no tracking pixels, no links in email 1 (or one link to your own domain at most), honest subject, no fake “Re:” or urgency.

## 12. Frontend screens

1. Login
2. Mailboxes (status, daily cap, today’s sends, health, pause and resume)
3. Contacts (import wizard, column mapping, verification results, source and consent fields)
4. Sequence editor (steps, delays, variable picker, live preview)
5. Campaign wizard (select sequence, mailboxes, contacts, gate check, test send, start)
6. Campaign dashboard (sent, replied, bounced, opted out, per-mailbox health)
7. Replies inbox (thread view, mark interested or not, one-click suppress)
8. Suppression list manager

## 13. Security

- Hash passwords (bcrypt or argon2), short-lived JWTs, per-user ownership checks on every query.
- Encrypt mailbox credentials at rest with `TOKEN_ENCRYPTION_KEY`; never log tokens or message bodies.
- Rate-limit the API, cap upload size and row counts, validate CSV MIME type.
- Sign unsubscribe tokens (HMAC) so links cannot be forged.
- Keep all secrets in Render environment variables, never in the repo.
- Enable 2FA on Google Workspace, Render, Atlas, and your DNS provider.

## 14. Deployment steps on Render

1. Push the monorepo to GitHub.
2. Create the Key Value instance and copy its internal URL.
3. Create the `api` Web Service (root `/server`, paid instance so it does not sleep) and set environment variables.
4. Create the `worker` Background Worker (root `/worker`, start command runs the scheduler and processors).
5. Create the `client` Static Site with a rewrite rule to `index.html` and the API base URL in its environment.
6. Allow Render’s outbound IPs in Atlas network access (or use the Atlas setting your plan supports).
7. Verify with a test email from each mailbox to your own Gmail and Outlook accounts, and check “Show original” for SPF, DKIM, and DMARC pass.

Check Render’s current pricing for the worker and API instances before you commit.

## 15. Eight-week timeline

| Week | Build | Deliverability |
| --- | --- | --- |
| 1 | Repo, auth, Mongo models, Render services, mailbox connection, first test send | Domain, mailboxes, DNS, Postmaster; start natural use |
| 2 | Contact import, verification, sequences, template engine, preview | Natural mailbox use continues |
| 3 | Scheduler, BullMQ, sender job, idempotency, caps, pacing | Begin 5 to 10 sends per day to hand-picked, verified prospects |
| 4 | Reply and bounce poller, suppression, stop rules | 10 to 20 per day |
| 5 | Unsubscribe page and headers, compliance controls, region flags | 20 to 30 per day if metrics healthy |
| 6 | Pre-send gate, circuit breaker, alerts, dashboard | Move DMARC toward `p=quarantine` after reviewing reports |
| 7 | Replies inbox, polish, error handling, load test with test addresses | 30 to 40 per day per mailbox |
| 8 | Security review, backups, documentation | Review all metrics; decide whether to add a mailbox |

## 16. Go-live checklist

- [ ] Domain authentication passes in Gmail “Show original” (SPF, DKIM, DMARC)
- [ ] Mailboxes used naturally for at least two weeks
- [ ] First list is small (50 to 100), hand-researched, and verified
- [ ] Every contact has `custom_opener`, source, and lawful basis
- [ ] Suppression list empty but working (test it with your own address)
- [ ] Unsubscribe link and header tested end to end
- [ ] Region flags configured for countries you are cleared to contact
- [ ] Circuit breaker and alert email tested with a simulated bounce
- [ ] Test sends landed in inbox (not spam) on Gmail and Outlook
- [ ] Physical address and sender identity in every template

## 17. Weekly routine after launch

- Review bounce, complaint, and reply rates per mailbox.
- Read replies and clean up suppression and opt-outs.
- Check Postmaster Tools, DMARC reports, and blocklist status.
- Retire weak copy; test one change at a time.
- Raise caps only if the last 7 days were clean. If not, lower volume and send only to your best-fit prospects.
- Add a mailbox only when current ones are healthy at their cap, never to escape a damaged reputation.

## 18. Risks and responses

| Risk | Response |
| --- | --- |
| Emails landing in spam | Check authentication, shorten and simplify copy, cut volume, send only to best-fit contacts, review list quality |
| Spam trap or blocklist hit | Pause the mailbox, audit the list source, remove the segment, request delisting only after fixing the cause |
| Google or Microsoft account warning | Stop sending, review their acceptable-use terms, reduce volume and re-warm |
| Legal complaint | Suppress at once, delete data if requested, keep your lawful-basis records |
| Worker crash mid-campaign | Jobs are idempotent and rebuilt from Enrollment state on restart |
| Low replies | Tighten the target list and the custom opener before changing anything else |
