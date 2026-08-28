// Forces a single trip through the Pre-Trip -> Post-Trip transition.
//
// That transition has no UI trigger and no route: it happens only in the 5am cron
// (see server_jobs.mjs), which an automated test can neither wait for nor invoke.
// Rather than expose a test-only route on the server, tests shell out to this.
//
// Usage:  node test-helpers/run-trip.mjs <tripId>
//
// The trip must be in Pre-Trip status with a plannedDate of today or earlier, which
// are the same preconditions the cron enforces - this takes no shortcuts around
// runTrip's own guards.

import sequelize from "../sequelize.mjs";
import models from "../models.mjs";
import queries from "../queries.mjs";

const { Trip } = models;
const { runTrip } = queries;

const tripId = Number(process.argv[2]);
if (!Number.isInteger(tripId)) {
  console.error("Usage: node test-helpers/run-trip.mjs <tripId>");
  process.exit(1);
}

let exitCode = 0;
try {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw new Error(`No trip with id ${tripId}`);
  await runTrip(trip);
  await trip.reload();
  console.log(`Trip ${tripId} ("${trip.tripName}") is now ${trip.status}`);
} catch (err) {
  console.error(`Failed to run trip ${tripId}: ${err.message}`);
  exitCode = 1;
}

// Exit rather than sequelize.close(): importing queries.mjs kicks off a fire-and-forget
// sequelize.sync(), and closing the pool out from under it throws "getConnection was
// called after the connection manager was closed". The work above is already committed.
process.exit(exitCode);
