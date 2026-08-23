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
| - .env - private credentials for MariaDB access plus server config. NOTE: the local `.env` currently defines only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, DEVELOPING, and MARIADB_SERVICE_PASSWORD. `PORT` and `ACCEPTED_ORIGIN` are read by server.mjs but are NOT set locally — PORT falls back to 8080, and the CORS allowlist ends up containing the literal string "undefined" alongside http://localhost:3000. That is fine for local dev (the frontend runs on :3000) but means production must set ACCEPTED_ORIGIN.
| OTHER CODE FILES:
| - logger.mjs - Creates logger for live logging of server behavior; writes to ./log.txt, which is truncated on each server start (only server.mjs should call logger.start())
| - errors.mjs - Defines four custom errors used by web server: AuthError (401), NonexistenceError (404), InvalidDataError (422), IllegalOperationError (403)
| - server_jobs.mjs - Creates cron jobs run on web server for scheduled database actions: runs/destroys trips daily at 5am; backs up the database to past_semesters/ on Jan 1 and Jun 1
| - destroyer.mjs - Defines destroyTrip and destroyUser methods designed to be run *manually* by database admin (not imported elsewhere)
| - requirement.txt - Python dependencies for verify.py
| DOCUMENTATION FILES:
| - README.md - Explains local project set up and tips for interacting with it (largely irrelevant to you)
| - route_descs.txt - Defines the purpose and behavior of each route the web server responds to; treat this as the overriding source of truth for *intended* web server behavior. See "Known route_descs.txt drift" below for the places it currently disagrees with the code.
| - database_diagram.sql, pages_and_reqs.txt - both stale; models.mjs is the real schema
| OTHER FILES:
| - migrations/ - Directory where .sql database migration files are stored (currently empty)
| - past_semesters/ - Directory where semester database backups are written by server_jobs.mjs
| - listserv-additions.txt - append-only file of emails collected by /user/listserv-add

## Domain Model Notes
- Trip status is a strictly forward-moving lifecycle: `Staging -> Open -> Pre-Trip -> Post-Trip -> Complete`. Nothing reverts. Most `IllegalOperationError`s in queries.mjs are guards on this progression.
- `TripSignUp` rows carry `tripRole` of either `Leader` or `Participant`. A `beforeValidate` hook in models.mjs nulls out `status`, `needPaperwork`, `confirmed`, and `paid` for Leader rows — so leader signups have null participant fields by construction.
- A Trip's price comes from *either* `class` (a letter A-J, or Z for free, joining to TripClass) *or* `priceOverride` — never both, never neither. This is enforced by a model-level validator.
- `lotteryWeight` is never sent to the client. `getBasicUserData`/`getUserData` strip both `id` and `lotteryWeight`. Non-selected participants get `+REJECTIONBUF` (0.25) weight; selected/attended participants get reset to 1; no-shows get `-NOSHOWPENALTY` (0.25).
- The lottery currently places *all* non-selected signups on the waitlist, so the `notAccepted` list it returns is always empty.
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
Note the prerequisites described at the top of verify.py - these prerequisites must be attained before running the script:
1. `phonyAuth` must be swapped in for `authenticate` in server.mjs, with `TESTID = 1` (User 1: William Stone, Admin)
2. `node default_insts.mjs` to reset the database
3. `node server.mjs` to start the server

Tests are numbered and share database state — they must be run as a full ordered suite, not individually, unless the database is reset first. **If authentication is changed in order to run verify.py, be sure to change it back to standard authentication afterwards.**

## Known route_descs.txt drift
route_descs.txt is the source of truth for *intent*, but it is not perfectly in sync with the code. Currently:
- `/admin/alter-user` is documented but **not implemented**. The backing function `alterRole` exists in queries.mjs but is unexported, unrouted, and contains a bug (it returns `userToElevate.save()` while the variable is named `userToAlter`).
- `/trip/<tripId>/lead/all-possible-participants` **is** implemented and is actively used by the frontend's attendance form, but has no entry in route_descs.txt.
- Entries prefixed TODO (`/trip/<tripId>/lead/cancel`, `/lead/quit`, `/cancel`) are not implemented.
When you touch either of these, fix the drift rather than working around it.

## Claude Best Practice Reminders
- For local testing without a real Google login, swap `app.use(authenticate)` for `app.use(phonyAuth)` in server.mjs. The `phonyAuth` middleware sets req.userId to the `TESTID` constant defined near the top of the file; change TESTID to test as different users.
- When checking whether a route is fully implemented, verify it in both places: mounted under the correct router in server.mjs AND backed by an exported function in queries.mjs. route_descs.txt describes intended behavior but is not always in sync with what's actually implemented.
- `authenticate` never throws on failure — it silently calls `next()` with no `req.userId`. Authorization is enforced downstream by `loggedIn`, `tripLeaderCheck`, and `leaderPlusCheck`. A route that forgets one of those guards is silently public.
- All async route handlers must be wrapped in `asyncHandler`, and async middleware too, or thrown errors will not reach the error handler.
- Do not run `node default_insts.mjs` against anything but a local database — it calls `sequelize.sync({ force: true })`, which drops every table.
- `destroyer.mjs` is intentionally manual and destructive. Never import it from server code.
