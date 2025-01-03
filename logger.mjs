import { join } from 'path';
import { promises as fs } from "fs";
import moment from "moment";
//Create logger logging to path LOG_FILE
const LOG_FILE = './log.txt';
const logger = {
  log_file: LOG_FILE,
  async log(msg) {
    let date = new Date();
    let curr_dt = moment(date).format("MM-DD HH:mm:ss (YYYY)");
    let log_str = `${curr_dt} - ${msg}\n`;
    fs.appendFile(this.log_file, log_str);
  },
  async start() {
    try { await fs.rm(LOG_FILE); } //Refreshes log on startup
    catch (err) { 
      if (err.code === "ENOENT") {} //No file at path LOG_FILE
      else { throw err } 
    }
    this.log("Logger started");
  }
}
//Start/restart logger when first required
await logger.start();
//Export logger
export default logger;