## Project Overview & Tech Stack
This repository serves as the backend for the Brown Outing Club's website, acting primarily as the interface between the frontend and the website's database server. The database tracks four models: user accounts (User), trips (Trip), trip signups (TripSignUp — the many-many join between users and trips), and trip pricing classes (TripClass). The web server allows for the contents of this database to be safely read and altered by the site's users.

The frontend that consumes this server lives in the sibling `project-boc/` repository (Next.js). See `../CLAUDE.md` for cross-repo context.

Tech Stack:
- Node.js - project/dependency management
- Express.js - externally-facing web server functionality
- Sequelize - bridge from web server to database
- MariaDB - database (the database is named "boc")
- Google Auth - API used for user authentication; the server validates Bearer tokens issued by Google per-request. New users with @brown.edu or @risd.edu emails are auto-created on first authenticated request.

Deployment: this server runs on a GCP VM (behind nginx, which terminates TLS and proxies to `PORT`). The frontend is deployed separately on Vercel. `certs/` and `selfcerts.sh` exist for generating self-signed certs; `server.mjs` imports `https`/`fs` but currently calls plain `app.listen` — TLS is nginx's job in production.

Annotated Abbreviated File Tree:
./
| MAIN FILES:
| - server.mjs - Express web server; root file actually run by production server on startup. Routes are organized into five groups: tripRouter (mounted at /trip/:tripId), userRouter (at /user), leaderRouter (at /leader), publicRouter (at /public, unauthenticated leader-profile routes), and general routes mounted directly on app (/trips, /leaders).
| - sequelize.mjs - Initializes Sequelize connection with database
| - models.mjs - Defines the four database tables (User, Trip, TripSignUp, TripClass) and their layout for Sequelize
| - queries.mjs - Holds methods that request handlers in server.mjs call upon to resolve database interaction behavior. Also performs the `sequelize.sync()` on import — importing this module is what threads model-database sync into any script that needs it.
| - default_insts.mjs - Recreates the local database with a standard set of test instances; run manually with `node default_insts.mjs` to reset the local database to a known state for testing
| - verify.py - Holds web server route verification methods
| - .env - private credentials for MariaDB access plus server config. `MARIADB_DATABASE` (optional, defaults to `boc`) lets tests target a throwaway database. `DEVELOPING=1` enables the test identity bypass (see below). `MAIL_TRANSPORT` selects the mail transport and defaults to `capture`. NOTE: the local `.env` currently defines only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, DEVELOPING, and MARIADB_SERVICE_PASSWORD. `PORT` and `ACCEPTED_ORIGIN` are read by server.mjs but are NOT set locally — PORT falls back to 8080, and the CORS allowlist ends up containing the literal string "undefined" alongside http://localhost:3000. That is fine for local dev (the frontend runs on :3000) but means production must set ACCEPTED_ORIGIN.
| OTHER CODE FILES:
| - email-client/ - Everything to do with outgoing mail. See "Email Notifications" below.
|   - mailer.mjs - Transport. Picks "capture" (the default everywhere) or "smtp" from
|     MAIL_TRANSPORT, derives both message bodies via render.mjs, and exposes a single
|     sendMail that never throws.
|   - notifications.mjs - The six templates plus the three senders the routes call. All
|     copy lives here and nowhere else; keep rendering logic out of it, since this is the
|     file non-programmers edit.
|   - render.mjs - Turns a template's markup into an HTML body and a plain-text
|     alternative from one source, so the two can never drift.
| - payments/ - Records trip payments from Brown Marketplace receipts. See "Payment Tracking" below.
|   - receipt.mjs - Pure parser: raw TouchNet notification -> { orderNumber, tripClass,
|     unitPrice, quantity, email, altEmail }. Throws on anything unrecognised.
|   - watcher.mjs - Holds an IMAP IDLE connection on the Gmail label BOC/Receipts, and on
|     each push parses, labels BOC/Processed, then calls queries.applyPayment. Off unless
|     PAYMENT_WATCH=1.
| - test-helpers/ - Manual helpers, not part of verify.py. run-trip.mjs forces a trip
|   transition that has no UI trigger; smtp-check.mjs authenticates against Gmail and
|   sends all six templates to the service account (never to a student); payments-check.mjs
|   parses the scrubbed receipts in test-helpers/receipts/ and checks the matching policy
|   inside a rolled-back transaction, without touching Gmail; remind-payments.mjs runs the
|   daily payment-reminder job as of a given date, which is how verify.py replays a week.
| - logger.mjs - Creates logger for live logging of server behavior; writes to ./log.txt, which is truncated on each server start (only server.mjs should call logger.start())
| - errors.mjs - Defines four custom errors used by web server: AuthError (401), NonexistenceError (404), InvalidDataError (422), IllegalOperationError (403)
| - server_jobs.mjs - Creates cron jobs run on web server for scheduled database actions: re-checks the payment watcher at 4am; runs/destroys trips daily at 5am; sends payment reminders at 14:00 UTC; backs up the database to past_semesters/ on Jan 1 and Jun 1
| - destroyer.mjs - Defines destroyTrip and destroyUser methods designed to be run *manually* by database admin (not imported elsewhere)
| - requirement.txt - Python dependencies for verify.py
| DOCUMENTATION FILES:
| - README.md - Explains local project set up and tips for interacting with it (largely irrelevant to you)
| - route_descs.txt - Defines the purpose and behavior of each route the web server responds to; treat this as the overriding source of truth for *intended* web server behavior. See "Known route_descs.txt drift" below for the places it currently disagrees with the code.
| - database_diagram.sql, pages_and_reqs.txt - both stale; models.mjs is the real schema
| OTHER FILES:
| - migrations/ - Directory where .sql database migration files are stored
| - past_semesters/ - Directory where semester database backups are written by server_jobs.mjs
| - listserv-additions.txt - append-only file of emails collected by /user/listserv-add

## Domain Model Notes
- Trip status is a strictly forward-moving lifecycle: `Staging -> Open -> Pre-Trip -> Post-Trip -> Complete`. Nothing reverts. Most `IllegalOperationError`s in queries.mjs are guards on this progression.
- `TripSignUp` rows carry `tripRole` of either `Leader` or `Participant`. A `beforeValidate` hook in models.mjs nulls out `status`, `needPaperwork`, `confirmed`, and `paid` for Leader rows — so leader signups have null participant fields by construction.
- A Trip's price comes from *either* `class` (a letter A-J, or Z for free, joining to TripClass) *or* `priceOverride` — never both, never neither. This is enforced by a model-level validator.
- `lotteryWeight` is never sent to the client. `getBasicUserData`/`getUserData` strip both `id` and `lotteryWeight`. Non-selected participants get `+REJECTIONBUF` (0.25) weight; selected/attended participants get reset to 1; no-shows get `-NOSHOWPENALTY` (0.25).
- A Trip's `waitlistSize` caps how many non-selected signups the lottery waitlists; the rest become Not Selected. It is nullable and optional, and **null means unlimited** — so a trip created without one behaves exactly as every trip did before the field existed, waitlisting everyone and returning an empty `notAccepted`. Nothing back-fills the waitlist afterwards: promoting off a capped waitlist shrinks it permanently rather than pulling Not Selected participants up.
- `getTrips` (the public `/trips` route) filters to the current semester window (Jan-May or Sep-Dec) and returns `[]` during summer months. This surprises people; it is deliberate.

## Codebase Modifications
Generally, new feature/route implementation on the webserver should adhere to the following loop:
1. Write an entry for the new route in route_descs.txt (and describe any associated JSONs)
2. Write 1-3 tests based off of this description in verify.py, adding default model instances to default_insts.mjs as required to support these tests
3. Implement route under the appropriate router in server.mjs (tripRouter for /trip/:tripId/* routes, userRouter for /user/* routes, leaderRouter for /leader/* routes, publicRouter for unauthenticated /public/* routes, or directly on app for other unauthenticated public routes), putting the core querying functionality in queries.mjs and importing it
4. Run associated tests in verify.py to ensure correctness

Editing existing routes should follow a similar verification loop, where route descriptions and tests are first edited, edits implemented, and finally, tests are rerun.

Edits to the structure of the database should adhere to the following loop:
1. Alter models.mjs to adhere to the new database schema
2. Write .sql database migration file (place in migrations/) to apply to production database to safely migrate database to new structure
3. Test migration file on local mariadb - on error, revert database (run `node default_insts.mjs`) and repeat step 2 and 3 until success
4. Run ALL tests in verify.py
5. Analyze failures to determine if a given failure lies in improper database migration or in a webserver route's functionality needing to change - if a route needs to change, update route_descs.txt description (if needed), route handling functionality, and associated tests in verify.py accordingly
6. Repeat steps 4 and 5 until all tests pass 
7. Update default_insts.mjs, if needed, to reflect the structure of the new database, keeping values in these default instances diverse for robust testing
8. Recreate the database (`node default_insts.mjs`) and run all tests in verify.py again, ensuring correctness with respect to these new default instances

Any new features to be added with the modified database structure should only be implemented AFTER the above database change loop has been executed.

If a route change alters a response shape the frontend reads, flag it — the corresponding TypeScript interfaces live in `../project-boc/src/models/models.tsx` and will need to be updated in lockstep.

### Running verify.py
1. Ensure `DEVELOPING=1` is set in `.env` (it is by default). The check is a strict
   comparison against `"1"` — `DEVELOPING=0` or `DEVELOPING=true` both read as off.
2. `node default_insts.mjs` to reset the database
3. `node server.mjs` to start the server
4. `python3 verify.py`

No source edits or middleware swaps are needed — verify.py authenticates via the test identity bypass below. Tests are numbered and share database state, so they must be run as a full ordered suite, not individually, unless the database is reset first.

To act as somebody else for a few requests, use the `as_user` context manager:
```python
with as_user("alan_wang2@brown.edu"):
    r = post("/trip/6/signup")
```
Passing `None` sends no credentials at all, for testing that a route is properly protected.

## Test Identity Bypass
Multi-user flows (lottery -> waitlist -> attendance) need several distinct Brown/RISD accounts acting within a single run. That is impossible against real Google auth, and `phonyAuth` can't do it either — it pins one user id at module scope, so switching identity means editing source and restarting.

So: while enabled, a request may authenticate as any user by sending

```
Authorization: Bearer e2e:<email>
```

`authenticate` short-circuits the Google userinfo call and builds an equivalent profile. Everything downstream is unchanged — including auto-creation, which still only happens for @brown.edu / @risd.edu addresses. A display name is derived from the address (`ada.lovelace@brown.edu` -> Ada Lovelace).

**This is an impersonation bypass.** It is gated on two independent conditions and is inert unless BOTH hold:
- `DEVELOPING` is exactly `"1"` (a strict comparison, because `Boolean("0")` is `true`
  and a stale `DEVELOPING=0` sat in the production `.env` until 2026-08-31), AND
- `NODE_ENV !== "production"`

When active, the server prints a loud warning to stderr and the log on startup. Never set `DEVELOPING` in a production environment. Tests `test_43` through `test_46` cover both gates and the domain restriction.

`phonyAuth` still exists but is superseded; prefer the bypass for anything new.

## Email Notifications
`/lead/lottery`, `/lead/add-participant`, and `/lead/attendance` send mail as a side
effect, and the daily `remindPayments` job chases unpaid fees. Per-route triggers and the
CC/BCC contract live in route_descs.txt; what follows is only what the code and that file
can't tell you.

- **Payment reminders are stateless.** `remindPayments(today)` in server_jobs.mjs asks
  `getUnpaidAttendance` for Complete trips that ended 1-7 days ago with Attended-but-unpaid
  participants, and which email a trip gets is purely a function of the day count: days
  1-6 the passive daily reminder, day 7 the "handed to the leaders" notice plus a list to
  the leaders, day 8+ nothing. No column records what was sent, so a day the server misses
  is skipped rather than made up - including day 7, in which case the leaders never get
  the list and must read `paid` off the trip page. Free trips, No Shows, Waitlisted and
  Selected-but-not-attended signups never hear. `today` is a parameter so
  `test-helpers/remind-payments.mjs <date>` can replay any day against seed trip 13.
- **The reminder's "what to buy" wording mirrors the frontend's Pay popup** (`purchase()`
  in notifications.mjs vs `SignupButton.tsx`), including the Marketplace URL. Change one,
  change the other; nothing checks they agree.
- **The leaders' handoff is the one message with no BCC** - it goes To the leaders, so
  test_50's privacy check skips messages with an empty BCC list.

- **Sending is the caller's responsibility, and a caller need not be a route.** The three
  query functions return who was affected (`runLottery`'s three lists, `addParticipant`'s
  `added`, `doAttendance`'s `{attended, noShow}`); the route handler passes that to
  notifications.mjs. Keeping it out of queries.mjs is what lets scripts and cron call those
  functions without mailing anyone — but a cron job *may* legitimately want to notify, so
  don't read this as "routes only". `server_jobs.mjs` has two candidates today: `runTrip`
  drops every remaining waitlister to Not Selected at 5am, and `destroyTrip` deletes Open
  trips past their date along with their signups. Neither tells anyone.
- **Recipient lists come from the query function, never re-derived from `req.body`.**
  `doAttendance` deletes excused absences and filters walk-ons who were already selected;
  anything recomputing that from the request will disagree with the database.
- **Transport** is `capture` (append to `sent_mail.jsonl`, send nothing) or `smtp`, chosen by
  `MAIL_TRANSPORT`. It defaults to **capture everywhere** — sending requires setting
  `MAIL_TRANSPORT=smtp` explicitly, which only production does. A development box that
  mails real students is unrecoverable; a production box that doesn't is not, and
  `server.mjs` prints a loud startup warning when `NODE_ENV=production` and the transport
  isn't `smtp`.
- **The capture file is JSONL, not a JSON array**, because a trip transition sends several
  messages concurrently and read-modify-write on a shared file loses all but the last.
- `FRONTEND_URL` builds links back into the site, and notifications.mjs hardcodes
  **project-boc's route shape** (`/trips/view?id=<tripId>`). A rename there silently sends
  students dead links; nothing typechecks this.
- **BCC is batched at `MAX_RECIPIENTS` (90, counting To and CC).** Gmail refuses every
  recipient past 100 per message, and nodemailer resolves anyway as long as one was
  accepted, so before this an oversized list silently lost its tail (48 waitlisters on
  2026-09-17). Batches send sequentially and log as `[MAIL] smtp "<subject>" [i/n]`. The
  count on that line is what the transport **accepted**; anything refused gets its own
  `[MAIL] REJECTED` line. `test_65` signs 120 users onto trip 12 to prove the split.
- **A daily quota guard drops, never queues.** Gmail allows a consumer account roughly
  500 recipients per rolling 24 hours; `mailer.mjs` keeps an in-memory ledger of what this
  process sent and refuses any BCC'd message that would take the total past
  `DAILY_RECIPIENT_LIMIT` (475), whole rather than in part - half a lottery hearing is
  worse than none. `sendMail` resolves false, logs `[MAIL] QUOTA`, and the four
  route-triggered senders then mail the trip's leaders a `NOT SENT:` notice saying the
  action went through but the email didn't and won't be retried. Messages with no BCC
  (that notice, the day-seven handoff) bypass the guard - the 25 of headroom is for them.
  The ledger dies with the process: a restart on a heavy day under-counts, accepted.
  `test-helpers/mail-quota-check.mjs` primes the ledger and proves all of this in capture
  mode. The lottery, not the reminders, is what gets near the limit: a 100-signup trip is
  ~100 recipients in one action.
- **Bounces are not watched.** Gmail's outbound spam filter can refuse a message after
  SMTP accepted it (see the next bullet); the only evidence is a Delivery Status
  Notification in the service inbox. A watcher that logged those was tried and removed on
  2026-09-19 - a log line nobody reads is no better than the inbox - so after a large
  lottery, look in the inbox. Gmail-IMAP lessons from that work, kept because payments/
  relies on them: appends de-duplicate by Message-ID and hand back the previous copy,
  labels and all; the only delete that sticks is a move to Trash then a delete from Trash.
- **Gmail also rejects mail it thinks is phishing, after accepting it at SMTP.** The old
  SELECTED wording ("[ACTION REQUIRED]", "Congratulations, you were selected", "click
  Confirm", "you might lose it") was bounced for every recipient of a real lottery; the
  bounces only show up as Delivery Status Notifications in the service inbox. `selected` and `promoted` are now written in a plain register with one
  link - keep them that way, and never sign a template with urgency or capitals. A
  single-recipient test send does *not* reproduce the block; only a real fan-out does.
- The "not selected" template only goes out for trips with a `waitlistSize` set (see the
  lottery note under Domain Model Notes); trips without one still waitlist everybody.
- **All copy lives in notifications.mjs**, and rendering machinery must stay out of that
  file — the club edits it. Templates are plain text with exactly two pieces of markup,
  `*bold*` and `[label](url)`; blank lines separate paragraphs and a single newline is a
  line break (that is what keeps the two-line signoff intact). `render.mjs` derives *both*
  the HTML body and the plain-text alternative from that one source so they cannot drift,
  and `mailer.mjs` calls it — templates never build HTML themselves. Escaping runs before
  markup expands, so an `&` in a trip name survives as `&amp;`.
- Link colour is `#4A7A2E`, deliberately **not** the site's brand green `#5B913A`, which
  measures 3.78:1 against white and fails WCAG AA for body text. This is 5.10:1.
- **Subject lines are asserted in verify.py** via the `SUBJ_*` constants at the top of that
  file; editing a subject means editing those too. They are collected in one place so the
  failure points at the wording rather than at five scattered tests. `test_51` fails if any
  message would go out with markup unconverted — the failure mode that would otherwise
  reach students as literal `*asterisks*` in Gmail.
- To preview without sending, leave `MAIL_TRANSPORT` unset and read `sent_mail.jsonl`. To
  send for real, `MAIL_TRANSPORT=smtp node test-helpers/smtp-check.mjs` puts all six
  templates in the service account's own inbox and can never reach a student. **verify.py
  only exercises five of the six** — "no show" never fires in the seeded flow, so check
  that one by hand after editing it.

## Payment Tracking
Participants pay through the Brown Marketplace (TouchNet), a store the site doesn't control.
The only signal the club gets is a "product ordered" notification emailed to
outing@brown.edu, which forwards to the service Gmail account. `payments/` turns those into
`paid = true` on signups. The "Pay" button in the frontend only opens the store; the old
`/participate/pay` self-report route is gone.

- **What a receipt says, and doesn't.** Buyer's checkout email, an order number, and a
  per-item unit price. Never a trip. So matching is: the buyer's Participant signups that
  are Selected or Attended, unpaid, on a trip costing exactly that unit price (class price
  or `priceOverride`), oldest trip first. Nearly always that is one signup; when two exist,
  the buyer owes for both anyway and which is marked first is immaterial. Anything else -
  unknown email, no signup at that price - is **disregarded**, logged, and never retried:
  the participant paid from an address the site doesn't know, which the Pay popup told them
  not to do, and an admin fixes it by hand (`UPDATE trip_signups SET paid = 1 WHERE ...`).
- **Use item prices, never the charged total.** 89 of the first 131 orders used a financial-aid
  promo code, most bringing the total to $0.00.
- **One notification per product, not per order.** A cart with two trip classes produces two
  emails (same order number, each listing the whole cart). Trips priced above any single
  item are bought as two items in one cart, so a multi-item cart is first tried as one
  payment of the cart total; failing that, the email is one payment for the item in its
  subject. The second email of such a cart finds nothing unpaid at the cart total and falls
  through harmlessly. A product with notifications switched off in the store produces
  none - **Class G was in that state as of 2026-09**, so Class G payments are invisible
  until someone enables it in the Marketplace store settings.
- **Matching relies on the TripClass prices in the database agreeing with the store's item
  prices.** Change one, change the other.
- **Push, not polling.** One IMAP connection sits in IDLE on the Gmail label `BOC/Receipts`
  (applied by a Gmail filter on `from:campuspayments@touchnet.com`), so a receipt is
  recorded within seconds of arrival. Processed receipts get the label `BOC/Processed` and
  are excluded from every later search, which is the only state there is: no table, no
  cursor. The daily 4am job in server_jobs.mjs reconnects if Gmail dropped the connection
  and re-runs the search. Parse-then-label-then-apply is deliberate: a parse failure leaves
  the message unlabelled for a fixed parser to pick up, and labelling before applying means
  a crash loses a receipt rather than applying it twice.
- **Trust comes from Gmail's DKIM verdict**, not the From header: receipt.mjs requires an
  `Authentication-Results: mx.google.com; ... dkim=pass ... header.i=@touchnet.com` header.
  A message that fails that is logged as a parse failure, never applied.
- **Off by default, like mail.** `PAYMENT_WATCH=1` enables it and `PAYMENT_WATCH_SINCE`
  (a date; receipts before it are never touched) is required alongside. A development box
  that processes real receipts labels them and production then never sees them; the same
  App Password (`SMTP_USER` / `SMTP_PASS`) grants IMAP access, so there is no separate
  credential to leave unset. Production without `PAYMENT_WATCH` gets a startup warning.
- **Testing.** `node test-helpers/payments-check.mjs` covers the parser (four real receipts
  with every personal detail replaced by the seeded test users: both TouchNet templates, a
  promo order, a two-item cart, a product without form fields) and the matching policy.
  To exercise the live push, IMAP-APPEND a fixture into `BOC/Receipts` with
  `PAYMENT_WATCH_SINCE` set to today, then delete it from All Mail *and* Trash. The
  fixtures carry synthetic Message-IDs for exactly this reason: Gmail de-duplicates an
  APPEND whose Message-ID it already has, and "deleting" the result strips labels from
  the real receipt.
- **The parser is deliberately strict.** When TouchNet changes its template (it did in
  Sept 2026), the log fills with `NOT PROCESSED, parse failed` lines; that means the parser
  needs updating, not that nobody paid. Fix it, redeploy, and the stuck receipts process on
  the next push or the 4am tick.

## Known route_descs.txt drift
route_descs.txt is the source of truth for *intent*, but it is not perfectly in sync with the code. Currently:
- `/admin/alter-user` is documented but **not implemented**. The backing function `alterRole` exists in queries.mjs but is unexported, unrouted, and contains a bug (it returns `userToElevate.save()` while the variable is named `userToAlter`).
- `/trip/<tripId>/lead/all-possible-participants` **is** implemented and is actively used by the frontend's attendance form, but has no entry in route_descs.txt.
- Entries prefixed TODO (`/lead/quit`, `/cancel`) are not implemented.
When you touch either of these, fix the drift rather than working around it.

## Claude Best Practice Reminders
- For local testing without a real Google login, send an `e2e:<email>` bearer token (see Test Identity Bypass). Do NOT reach for `phonyAuth` — it needs a source edit plus a restart and cannot switch users mid-run.
- When checking whether a route is fully implemented, verify it in both places: mounted under the correct router in server.mjs AND backed by an exported function in queries.mjs. route_descs.txt describes intended behavior but is not always in sync with what's actually implemented.
- `authenticate` never throws on failure — it silently calls `next()` with no `req.userId`. Authorization is enforced downstream by `loggedIn`, `tripLeaderCheck`, and `leaderPlusCheck`. A route that forgets one of those guards is silently public.
- All async route handlers must be wrapped in `asyncHandler`, and async middleware too, or thrown errors will not reach the error handler.
- Do not run `node default_insts.mjs` against anything but a local database — it calls `sequelize.sync({ force: true })`, which drops every table.
- `destroyer.mjs` is intentionally manual and destructive. Never import it from server code.
