import { Sequelize } from 'sequelize';
import logger from './logger.mjs';
import "dotenv/config";

//Set up sequelize pool - sets up connection to database
//MARIADB_DATABASE lets automated tests point at a throwaway database (eg. boc_test) so
//that running them doesn't wipe the local development database
const DATABASE = process.env.MARIADB_DATABASE || 'boc';
const sequelize = new Sequelize(DATABASE, 'service', process.env.MARIADB_SERVICE_PASSWORD, {
    host: '127.0.0.1',
    dialect: 'mariadb',
    logging: false, //Suppress annoying console output
    pool: {
        max: 5,
        min: 0,
    }
});

//Test connection to database
await sequelize.authenticate();
logger.log(`Connection to database '${DATABASE}' successfully established`);

//Export set up sequelize object
export default sequelize;
