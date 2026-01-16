// Created for the purpose of mannually destroying trips (and associated signups) when the need arises
// Not intended for use by the server directly - use via 
// const { default: destroyTrip } = await import("./trip_destroyer.mjs");
// in node (sudo node for proper perms)
// USE WITH CAUTION

import logger from "./logger.mjs";
import models from "./models.mjs";
import sequelize from "./sequelize.mjs";
const { Trip } = models;

//Sync with database
(async () => {
  await sequelize.sync();
  logger.log("Trip Destroyer synced models successfully with database");
})();

export default async function destroyTrip(id) {
  //Grab trip
  const trip = await Trip.findOne({
    where: { id : id }
  });
  if (!trip) { throw Error("No trip with that ID found") }
  //Grab signups
  const signups = await trip.getTripSignUps();
  //Delete trip and all signups
  let proms = signups.map((signup) => signup.destroy());
  proms.push(trip.destroy());
  logger.log(`Mannually destoryed trip with id ${id}`);
  return Promise.all(proms);
}