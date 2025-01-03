import { Sequelize } from 'sequelize';
import logger from './logger.mjs';

//Set up sequelize pool
const sequelize = new Sequelize('boc', 'service', 'test123', {
    host: 'localhost',
    dialect: 'mariadb',
    logging: false, //Suppress annoying console output
    pool: {
        max: 5,
        min: 0,
    }
});

//Test connection to database
await sequelize.authenticate();
logger.log('Connection to database successfully established');

//Export set up sequelize object
export default sequelize;