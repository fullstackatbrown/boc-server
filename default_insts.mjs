import sequelize from './sequelize.mjs';
import models from './models.mjs';
const { User, Trip, TripUserMap, TripClass } = models;

//Set up trip classes
const tripClasses = [
    { tripClass: 'A', price: 5 },
    { tripClass: 'B', price: 10 },
    { tripClass: 'C', price: 15 },
    { tripClass: 'D', price: 20 },
    { tripClass: 'E', price: 25 },
    { tripClass: 'F', price: 30 },
    { tripClass: 'G', price: 35 },
    { tripClass: 'H', price: 40 },
    { tripClass: 'I', price: 45 },
    { tripClass: 'J', price: 50 },
    { tripClass: 'Z', price: 0 },
];
TripClass.bulkCreate(tripClasses, {
    updateOnDuplicate: ['link', 'price'],
});

//Set up test examples of each other class
let user = User.upsert({
    firstName: 'William',
    lastName: 'Stone',
    email: 'william_l_stone@brown.edu',
    role: 'Admin',
});
let trip = Trip.upsert({
    id: 1, //Will create endless copies if this is not set to 1
    tripName: 'Willy\'s Wild Adventure',
    plannedDate: new Date(),
    public: true,
    class: 'Z',
    sentenceDesc: 'Come and do some awesome wacky stuff with mwah',
});
await user, trip;
await TripUserMap.upsert({
    tripId: 1,
    userId: 1,
    tripRole: 'Leader',
});

//Close connection so as not to leave hanging connections
sequelize.close();