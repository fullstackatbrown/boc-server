import sequelize from './sequelize.mjs';
import models from './models.mjs';
const { User, Trip, TripSignUp, TripClass } = models;

(async () => {
    await sequelize.sync({ force: true });

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
    let user2 = User.upsert({
        firstName: 'Alan',
        lastName: 'Wang',
        email: 'alan_wang2@brown.edu',
        role: 'Admin',
    });
    let user3 = User.upsert({
        firstName: 'Test',
        lastName: 'Dude',
        email: 'test@du.de',
        role: 'Participant',
    })

    let trip = Trip.upsert({
        id: 1, //Will create endless copies if this is not set to 1
        tripName: 'Willy\'s Wild Waltz',
        plannedDate: new Date(),
        status: 'Open',
        maxSize: 20,
        class: 'Z',
        sentenceDesc: 'Come and do some cool stuff with mwah',
    });
    let trip2 = Trip.upsert({
        id: 2,
        tripName: 'Alan\'s Awesome Adventure',
        plannedDate: new Date(),
        status: 'Open',
        maxSize: 10,
        class: 'J',
        blurb: `Join me for an adventure into the wonderful world of quantitative finance! 
      We\'ll talk about like Markov Chains and Fourier Transforms and stuff, 
      solve quant interview questions, do trading game challenges, and figure out 
      everyone\'s average score by starting with a secret random number, 
      having everyone privately add their individual scores to it, subtracting the starting number, 
      and averaging! Prepare for a day\'s (and night\'s, we will probably need to pull 
      an all-nighter to do all this) worth of fun and a life\'s worth of money by 
      signing up for this trip!` 
    }) 
    let trip3 = Trip.upsert({
        id: 3,
        tripName: 'Willy\'s 2nd Wild Waltz',
        plannedDate: new Date("2028-10-10T14:48:00"),
        status: 'Open',
        maxSize: 20,
        class: 'Z',
        sentenceDesc: 'Come and do some cool stuff with mwah',
    });
    let trip4 = Trip.upsert({
        id: 4,
        tripName: 'Trip with Long Description',
        plannedDate: new Date("2025-07-14T14:48:00"),
        status: 'Open',
        maxSize: 10,
        class: 'Z',
        sentenceDesc: `Gonna be the best trip of all time! We're gonna do all kinds of cool things,
         and it's gonna be really really fun! You should really join the trip cuz it's gonna be really awesome
         and you don't wanna miss out! Now c'mon - click on this and hit that sign up button; you know you want to! 
         It'll be the best choice you ever made!`,
    });
    let trip5 = Trip.upsert({
        id: 5,
        tripName: 'Some Other Trip',
        plannedDate: new Date("2025-07-14T14:48:00"),
        status: 'Open',
        maxSize: 10,
        class: 'Z',
        sentenceDesc: `Yeah, this is just some other trip *shrug*.`,
    })
    await Promise.all([user, user2, user3, trip, trip2, trip3, trip4, trip5]);

    //Close connection so as not to leave hanging connections
    sequelize.close();
})();
