import { DataTypes, Model } from 'sequelize';
import sequelize from './sequelize.mjs';
import logger from './logger.mjs';

//
// USER MODEL
//

class User extends Model {
    //Custom methods go here
}

User.init(
    { // FIELDS
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        firstName: {
            type: DataTypes.STRING(35),
            allowNull: false,
        },
        lastName: {
            type: DataTypes.STRING(70),
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false,
            isEmail: true,
        },
        phone: {
            type: DataTypes.STRING(15),
        },
        role: {
            type: DataTypes.ENUM('Admin','Leader','Participant'),
            allowNull: false,
        },
        lotteryWeight: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 1,
        },
        hasWaiver: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        tripsLead: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        tripsParticipated: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        }
    },
    { // OPTIONS
        sequelize,
        //Preserves snake_case notation
        tableName: 'users',
        underscored: true,

    }
);

//
// TRIP MODEL
//

class Trip extends Model {
    //Custom methods go here
}

//Create default planning checklist
const NUM_TASKS = 15; //By my rough count
const taskObj = {
    responsible: null,
    done: false,
};
const defaultPlanningChecklist = Array.from(
    { length: NUM_TASKS }, 
    () => ({...taskObj})
);

Trip.init(
    { // FIELDS
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        tripName: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        plannedDate: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        public: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false, //Created trips start out private
        },
        maxSize: {
            type: DataTypes.INTEGER,
        },
        class: {
            type: DataTypes.STRING(1),
            validate: { //Ensures only class or priceOverride is defined, not both
                classXorPriceOverride(val) {
                    if (!(!val ^ !this.priceOverride)) { //nots coerce to booleans lol
                        throw new Error('Either both class and priceOverride are null or both are not null');
                    }
                }
            }
        },
        priceOverride: {
            type: DataTypes.FLOAT,
        },
        paperworkLinks: {
            type: DataTypes.JSON,
        },
        imageLinks: {
            type: DataTypes.JSON,
        },
        sentenceDesc: {
            type: DataTypes.STRING(100),
        },
        blurb: {
            type: DataTypes.TEXT,
        },
        planningChecklist: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: JSON.stringify(defaultPlanningChecklist),
        }
    },
    { // OPTIONS
        sequelize,
        indexes: [{ //Combination of trip_name and planned_date must be unique
            unique: true,
            fields: ['trip_name', 'planned_date'],
        }],
        //Preserves snake_case notation
        tableName: 'trips',
        underscored: true,
    }
);

//
// TRIP_USER_MAP MODEL
//

class TripUserMap extends Model {
    //Custom methods go here
}

TripUserMap.init(
    { // FIELDS
        tripId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
        },
        tripRole: {
            type: DataTypes.ENUM('Leader','Participant'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('Signed Up','Selected','Not Selected','Attended','No Show'),
            defaultValue: 'Signed Up',
        },
        needPaperwork: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        confirmed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    { // OPTIONS
        sequelize,
        //Preserves snake_case notation
        tableName: 'trip_user_map',
        underscored: true,
    }
);

//Overrides default values of status, needPaperwork, and confirmed to null for leaders
TripUserMap.beforeValidate((inst) => {
    if (inst.tripRole === 'Leader') {
        inst.status = null;
        inst.needPaperwork = null;
        inst.confirmed = null;
    }
});

//
// TRIP_CLASS MODEL
//

class TripClass extends Model {
    //Custom methods go here
}

TripClass.init(
    { // FIELDS
        tripClass: {
            type: DataTypes.STRING(1),
            allowNull: false,
            primaryKey: true,
        },
        link: {
            type: DataTypes.STRING,
        },
        price: {
            type: DataTypes.FLOAT,
            allowNull: false,
        },
    },
    { // OPTIONS
        sequelize,
        //Preserves snake_case notation
        tableName: 'trip_classes',
        underscored: true,
    }
);

//
// ASSOCIATIONS AND SYNCHRONIZATION
//

//trip_classes and trips association
TripClass.hasMany(Trip, { foreignKey: 'class' });
Trip.belongsTo(TripClass, { foreignKey: 'class' });

//users and trips association
User.belongsToMany(Trip, { through: TripUserMap, foreignKey: 'userId' });
Trip.belongsToMany(User, { through: TripUserMap, foreignKey: 'tripId' });

//Sync models with database
await sequelize.sync();
logger.log('Models successfully synced with database');

export default { User, Trip, TripUserMap, TripClass };