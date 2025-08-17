import { Sequelize } from 'sequelize';
import logger from './logger.mjs';

//Set up sequelize pool - sets up connection to database
const sequelize = new Sequelize('boc', 'service', 'test123', {
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
logger.log('Connection to database successfully established');

//Export set up sequelize object
export default sequelize;
