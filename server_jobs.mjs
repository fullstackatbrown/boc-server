import logger from "./logger.mjs";
import queries from "./queries.mjs";
const { runTrip } = queries; //This also threads the model-database-sync through queries for safe db interaction
import models from "./models.mjs";
import { Op } from "sequelize";
const { Trip } = models;

async function destroyTrip(trip) {
    const signups = await trip.getTripSignUps();
    let proms = signups.map((signup) => signup.destroy());
    proms.push(trip.destroy());
    return Promise.all(proms);
}

async function runTrips() {
    logger.log("[SERVER DAEMON] Runnning all of today's trips");
    //Check if there are any open trips whose planned date is today/has passed and delete them
    const todaysDateonly = new Date().toISOString().slice(0, 10);
    const tripsToDelete = await Trip.findAll({
        where: {
            status: "Open",
            plannedDate: {
                [Op.lte]: todaysDateonly,
            }
        }
    });
    if (tripsToDelete.length > 0) logger.log(`[SERVER DAEMON] Destroyed ${tripsToDelete.length} trips for being open on or past planned date`);
    let proms = tripsToDelete.map(destroyTrip);
    //Run trips that are due to be run
    const tripsToRun = await Trip.findAll({
        where: {
            status: "Pre-Trip",
            plannedDate: {
                [Op.lte]: todaysDateonly,
            }
        }
    });
    if (tripsToRun.length > 0) logger.log(`[SERVER DAEMON] Ran ${tripsToRun.length} trip(s)!`);
    const tripUpdateProms = tripsToRun.map(runTrip);
    proms.concat(tripUpdateProms);
    return Promise.all(proms);
}

async function delOldTrips() {
    logger.log("[SERVER DAEMON] Destorying all old trips");
    const oldTrips = await Trip.findAll({
        where: {
            status: "Complete"
        }
    });
    logger.log(`[SERVER DAEMON] Destroyed ${oldTrips.length} trip(s)`);
    return Promise.all(oldTrips.map(destroyTrip));
}

function jobify(cronString, job) {
    return {
        cronString: cronString,
        job: job,
    }
}

export default [
    jobify("0 5 * * *", runTrips), //Tick status of all trips being run on a given day to Post-Trip at 5am that morning
    jobify("0 0 1 1,6 *", delOldTrips), //Delete all old trips between semesters (ie. Jan 1st and June 1st)
]