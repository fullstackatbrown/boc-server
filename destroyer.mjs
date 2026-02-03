// Created for the purpose of mannually destroying trips or users (and associated signups) when the need arises
// Not intended for use by the server directly - use via 
// const { destroyTrip, destroyUser } = await import("./destroyer.mjs");
// in node (sudo node for proper perms)
// USE WITH CAUTION

import logger from "./logger.mjs";
import models from "./models.mjs";
import sequelize from "./sequelize.mjs";
const { Trip, User } = models;

//Sync with database
(async () => {
  await sequelize.sync();
  logger.log("Destroyer synced models successfully with database");
})();

//NOTE: These following functions would be simpler if we had onDelete: 'CASCADE' for the models
//but I'm currently not feeling like adding that because we would have to migrate that to the production DB
export async function destroyTrip(id) {
  const t = await sequelize.transaction();
  try {
    //Grab user
    const trip = await Trip.findOne({ where: { id }, transaction: t });
    if (!trip) throw Error("No user with that ID found");
    //Grab signups
    const signups = await trip.getTripSignUps({ transaction: t });
    //Delete signups and user sequentially - this avoids odd deadlocks
    for (const signup of signups) {
      await signup.destroy({ transaction: t });
    }
    await trip.destroy({ transaction: t });
    await t.commit();
    logger.log(`Manually destroyed trip with id ${id}`);
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

export async function destroyUser(id) {
  const t = await sequelize.transaction();
  try {
    //Grab user
    const user = await User.findOne({ where: { id }, transaction: t });
    if (!user) throw Error("No user with that ID found");
    //Grab signups
    const signups = await user.getTripSignUps({ transaction: t });
    //Delete signups and user sequentially - this avoids odd deadlocks
    for (const signup of signups) {
      await signup.destroy({ transaction: t });
    }
    await user.destroy({ transaction: t });
    await t.commit();
    logger.log(`Manually destroyed user with id ${id}`);
  } catch (error) {
    await t.rollback();
    throw error;
  }
}