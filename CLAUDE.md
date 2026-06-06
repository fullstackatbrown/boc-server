## Project Overview & Tech Stack
This repository serves as the backend for the Brown Outing Club's website, acting primarily as the interface between the frontend and the website's database server. The database tracks four models: user accounts (User), trips (Trip), trip signups (TripSignUp — the many-many join between users and trips), and trip pricing classes (TripClass). The web server allows for the contents of this database to be safely read and altered by the site's users.

Tech Stack:
- Node.js - project/dependency management
- Express.js - externally-facing web server functionality
- Sequelize - bridge from web server to database
- MariaDB - database (the database is named "boc")
- Google Auth - API used for user authentication; the server validates Bearer tokens issued by Google per-request. New users with @brown.edu or @risd.edu emails are auto-created on first authenticated request.

Annotated Abbreviated File Tree:
./
| MAIN FILES:
| - server.mjs - Express web server; root file actually run by production server on startup. Routes are organized into four groups: tripRouter (mounted at /trip/:tripId), userRouter (at /user), leaderRouter (at /leader), and general routes mounted directly on app.
| - sequelize.mjs - Initializes Sequelize connection with database
| - models.mjs - Defines the four database tables (User, Trip, TripSignUp, TripClass) and their layout for Sequelize
| - queries.mjs - Holds methods that request handlers in server.mjs call upon to resolve database interaction behavior
| - default_insts.mjs - Recreates the local database with a standard set of test instances; run manually with `node default_insts.mjs` to reset the local database to a known state for testing
| - verify.py - Holds web server route verification methods
| - .env - private credentials for MariaDB access plus server config (PORT, ACCEPTED_ORIGIN, MARIADB_SERVICE_PASSWORD)
| OTHER CODE FILES:
| - logger.mjs - Creates logger for live logging of server behavior
| - errors.mjs - Defines four custom errors used by web server: AuthError (401), NonexistenceError (404), InvalidDataError (422), IllegalOperationError (403)
| - server_jobs.mjs - Creates cron jobs run on web server for scheduled database actions: runs/destroys trips daily at 5am; backs up the database to past_semesters/ on Jan 1 and Jun 1
| - destroyer.mjs - Defines destroyTrip and destroyUser methods designed to be run *manually* by database admin (not imported elsewhere)
| - requirement.txt - Python dependencies for verify.py
| DOCUMENTATION FILES:
| - README.md - Explains local project set up and tips for interacting with it (largely irrelevant to you)
| - route_descs.txt - Defines the purpose and behavior of each route the web server responds to; treat this as the overriding source of truth for intended web server behavior. Note: some entries are marked TODO (not yet implemented) and at least one entry (/auth/) is stale and no longer reflects the server's actual behavior.
| OTHER FILES:
| - migrations/ - Directory where .sql database migration files are stored
| - past_semesters/ - Directory where semester database backups are written by server_jobs.mjs

## Codebase Modifications
Generally, new feature/route implementation on the webserver should adhere to the following loop:
1. Write an entry for the new route in route_descs.txt (and describe any associated JSONs)
2. Write 1-3 tests based off of this description in verify.py, adding default model instances to default_insts.mjs as required to support these tests
3. Implement route under the appropriate router in server.mjs (tripRouter for /trip/:tripId/* routes, userRouter for /user/* routes, leaderRouter for /leader/* routes, or directly on app for unauthenticated public routes), putting the core querying functionality in queries.mjs and importing it
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

### Running verify.py
Note the prerequisites described at the top of verify.py - these prequesites must be attained before running the script. If authentication must be changed in phonyAuth in order to run verify.py, be sure to change it back to standard authentication afterwards. 

## Claude Best Practice Reminders
- For local testing without a real Google login, swap `app.use(authenticate)` for `app.use(phonyAuth)` in server.mjs. The `phonyAuth` middleware sets req.userId to the `TESTID` constant defined near the top of the file; change TESTID to test as different users.
- When checking whether a route is fully implemented, verify it in both places: mounted under the correct router in server.mjs AND backed by an exported function in queries.mjs. route_descs.txt describes intended behavior but is not always in sync with what's actually implemented.
