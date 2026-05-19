import { spawn } from "child_process";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./logger.mjs";
import queries from "./queries.mjs";
const { runTrip } = queries; //This also threads the model-database-sync through queries for safe db interaction
import models from "./models.mjs";
import { Op } from "sequelize";
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

async function backupDatabase() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    const season = month <= 5 ? "fall" : "spring";
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

function jobify(cronString, job) {
    return {
        cronString: cronString,
        job: job,
    }
}

export default [
    jobify("0 5 * * *", runTrips), //Tick status of all trips being run on a given day to Post-Trip at 5am that morning
    jobify("0 0 1 1,6 *", semesterBackup), //Back up database between semesters (ie. Jan 1st and June 1st)
]