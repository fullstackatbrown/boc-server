import { spawn } from "child_process";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import moment from "moment";
import logger from "./logger.mjs";
import { notifyPaymentReminder, notifyUnpaidHandoff } from "./email-client/notifications.mjs";
import queries from "./queries.mjs";
const { runTrip, getUnpaidAttendance } = queries; //This also threads the model-database-sync through queries for safe db interaction
import models from "./models.mjs";
import { Op } from "sequelize";
import sequelize from "./sequelize.mjs"; //The connection itself - destroyTrip opens a transaction on it
import { tickPaymentWatcher } from "./payments/watcher.mjs";
const { Trip } = models;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "past_semesters");

// async function destroyTrip(trip) {
//     const signups = await trip.getTripSignUps();
//     let proms = signups.map((signup) => signup.destroy());
//     proms.push(trip.destroy());
//     return Promise.all(proms);
// }

async function destroyTrip(trip) {
    const t = await sequelize.transaction();
    try {
      //Grab signups
      const signups = await trip.getTripSignUps({ transaction: t });
      //Delete signups and trip sequentially - this avoids odd deadlocks
      for (const signup of signups) {
        await signup.destroy({ transaction: t });
      }
      await trip.destroy({ transaction: t });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
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
    //Sequential, not Promise.all: each destroyTrip opens its own transaction on `trips`,
    //and running them concurrently fails intermittently with MariaDB 1020 "Record has
    //changed since last read". This runs once a day over a handful of trips, so awaiting
    //each in turn costs nothing and is the difference between reliable and roughly 50/50.
    for (const trip of tripsToDelete) await destroyTrip(trip);
    for (const trip of tripsToRun) await runTrip(trip);
}

async function backupDatabase() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-indexed
    // Each run backs up the semester that just ended. The June run captures the spring of
    // the current year, but the January run captures the PREVIOUS year's fall - so it must
    // not use the new calendar year it is running in.
    const isFall = month <= 5;
    const season = isFall ? "fall" : "spring";
    const year = isFall ? now.getFullYear() - 1 : now.getFullYear();
    const backupPath = path.join(BACKUP_DIR, `${season}_${year}.sql`);

    await fs.mkdir(BACKUP_DIR, { recursive: true });

    await new Promise((resolve, reject) => {
        const dump = spawn("mariadb-dump", [
            "-h127.0.0.1",
            "-uservice",
            `-p${process.env.MARIADB_SERVICE_PASSWORD}`,
            "boc",
        ]);

        const writeStream = createWriteStream(backupPath);
        dump.stdout.pipe(writeStream);

        let stderrData = "";
        dump.stderr.on("data", (data) => { stderrData += data; });

        dump.on("error", reject);
        writeStream.on("error", reject);
        dump.on("close", (code) => {
            writeStream.end();
            if (code !== 0) {
                reject(new Error(`mariadb-dump exited with code ${code}: ${stderrData}`));
            } else {
                resolve();
            }
        });
    });

    const { size } = await fs.stat(backupPath);
    if (size === 0) throw new Error(`Backup file ${backupPath} is empty`);

    return backupPath;
}

async function semesterBackup() {
    logger.log("[SERVER DAEMON] Creating semester database backup");
    let backupPath;
    try {
        backupPath = await backupDatabase();
    } catch (error) {
        logger.log(`[SERVER DAEMON] Database backup failed: ${error.message}`);
        throw error;
    }
    logger.log(`[SERVER DAEMON] Backup successfully written to ${backupPath}`);
}

//Attended-but-unpaid participants hear from us every day for a week after the trip, then
//once more as their names go to the leaders, then never again. Stateless: which email a
//trip gets is a function of today and the trip's date, so a day the server misses is
//simply skipped. `today` is a parameter so test-helpers/remind-payments.mjs can replay days.
const REMINDER_DAYS = 7;
export async function remindPayments(today = new Date()) {
    const daysAgo = (n) => moment(today).subtract(n, "days").format("YYYY-MM-DD");
    const trips = await getUnpaidAttendance(daysAgo(REMINDER_DAYS), daysAgo(1));
    for (const { trip, unpaid } of trips) {
        const final = moment(daysAgo(0)).diff(trip.plannedEndDate ?? trip.plannedDate, "days") >= REMINDER_DAYS;
        await notifyPaymentReminder(trip, unpaid.map((p) => p.email), { final });
        if (final) await notifyUnpaidHandoff(trip, unpaid);
    }
    if (trips.length > 0) logger.log(`[SERVER DAEMON] Sent payment reminders for ${trips.length} trip(s)`);
}

function jobify(cronString, job) {
    return {
        cronString: cronString,
        job: job,
    }
}

export default [
    jobify("0 5 * * *", runTrips), //Tick status of all trips being run on a given day to Post-Trip at 5am that morning
    jobify("0 0 1 1,6 *", semesterBackup), //Back up database between semesters (ie. Jan 1st and June 1st)
    jobify("0 4 * * *", tickPaymentWatcher), //Safety net for the push-based receipt watcher: reconnect if Gmail dropped us, catch anything missed
    jobify("0 14 * * *", remindPayments), //Payment reminders at 10am Providence, when people read mail - not at 1am with the trip jobs
]