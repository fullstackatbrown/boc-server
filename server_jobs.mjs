import logger from "./logger.mjs";
import queries from "./queries.mjs";
const { runTrip } = queries; //This also threads the model-database-sync through queries for safe db interaction
import models from "./models.mjs";
import { Op } from "sequelize";
const { Trip } = models;

async function runTrips() {
    logger.log("[SERVER DAEMON] Runnning all of today's trips")
    const todaysDateonly = new Date().toISOString().slice(0, 10);
    const tripsToRun = await Trip.findAll({
        where: {
            status: "Pre-Trip",
            plannedDate: {
                [Op.lte]: todaysDateonly,
            }
        }
    });
    const tripUpdateProms = tripsToRun.map(runTrip);
    return Promise.all(tripUpdateProms);
}

async function delOldTrips() {
    logger.log("[SERVER DAEMON] Destorying all old trips");
    return Trip.destroy({
        where: {
            status: "Complete"
        }
    });
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