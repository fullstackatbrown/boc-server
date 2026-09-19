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

    //Set up test examples of each other class. Ids are pinned, as the trips below are:
    //these upserts all run concurrently, so without them MariaDB assigns auto-increment
    //ids in whatever order the inserts land, and the userId references further down (plus
    //verify.py's assumption that user 1 is William) break on a reshuffle.
    let user = User.upsert({
        id: 1,
        firstName: 'William',
        lastName: 'Stone',
        email: 'william_l_stone@brown.edu',
        role: 'Admin',
    });
    let user2 = User.upsert({
        id: 2,
        firstName: 'Alan',
        lastName: 'Wang',
        email: 'alan_wang2@brown.edu',
        role: 'Admin',
    });
    let user3 = User.upsert({
        id: 3,
        firstName: 'Test',
        lastName: 'Dude',
        email: 'test@du.de',
        role: 'Participant',
    });
    let user4 = User.upsert({
        id: 4,
        firstName: 'Test',
        lastName: 'Dude2',
        email: 'test2@du.de',
        role: 'Participant',
    });

    //Cast for lifecycle testing (Playwright's e2e walk, and manual multi-user testing).
    //A trip needs a leader plus a good handful of participants to exercise the lottery,
    //waitlist, removal and attendance paths, so there are deliberately more here than any
    //single test uses. Names are real so participant lists render legibly.
    let user5 = User.upsert({
        id: 5,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.lovelace@brown.edu',
        role: 'Participant',
    });
    let user6 = User.upsert({
        id: 6,
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace.hopper@brown.edu',
        role: 'Participant',
    });
    let user7 = User.upsert({
        id: 7,
        firstName: 'Alan',
        lastName: 'Turing',
        email: 'alan.turing@brown.edu',
        role: 'Participant',
    });
    let user8 = User.upsert({
        id: 8,
        firstName: 'Katherine',
        lastName: 'Johnson',
        email: 'katherine.johnson@brown.edu',
        role: 'Participant',
    });
    let user9 = User.upsert({
        id: 9,
        firstName: 'Barbara',
        lastName: 'Liskov',
        email: 'barbara.liskov@brown.edu',
        role: 'Participant',
    });
    let user10 = User.upsert({
        id: 10,
        firstName: 'Donald',
        lastName: 'Knuth',
        email: 'donald.knuth@brown.edu',
        role: 'Participant',
    });
    //RISD account, and the one deliberately left off every trip - used to test taking
    //attendance for somebody who never signed up in the first place
    let user11 = User.upsert({
        id: 11,
        firstName: 'Margaret',
        lastName: 'Hamilton',
        email: 'margaret.hamilton@risd.edu',
        role: 'Participant',
    });
    //A plain Leader (not an Admin) - every other leader in this seed is an Admin, which
    //means leader-vs-admin behaviour would otherwise never get exercised
    let user12 = User.upsert({
        id: 12,
        firstName: 'Radia',
        lastName: 'Perlman',
        email: 'radia.perlman@brown.edu',
        role: 'Leader',
    });

    let trip = Trip.upsert({
        id: 1, //Will create endless copies if this is not set to 1
        tripName: 'Willy\'s Wild Waltz',
        plannedDate: new Date(),
        category: 'Hiking',
        status: 'Open',
        maxSize: 20,
        class: 'Z',
        sentenceDesc: 'Come and do some cool stuff with mwah',
    });
    let trip2 = Trip.upsert({
        id: 2,
        tripName: 'Alan\'s Awesome Adventure',
        plannedDate: new Date(),
        category: 'Skiing',
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
        category: 'Exploration',
        sentenceDesc: 'Come and do some cool stuff with mwah',
    });
    let trip4 = Trip.upsert({
        id: 4,
        tripName: 'Trip with Long Description',
        plannedDate: new Date("2026-07-14T14:48:00"),
        status: 'Open',
        category: 'Backpacking',
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
        plannedDate: new Date("2026-07-14T14:48:00"),
        status: 'Open',
        category: 'Climbing',
        maxSize: 10,
        class: 'Z',
        sentenceDesc: `Yeah, this is just some other trip *shrug*.`,
    })
    let trip6 = Trip.upsert({
        id: 6,
        tripName: 'Small Trip',
        category: 'Water',
        plannedDate: new Date("2025-12-25T14:48:00"),
        status: 'Open',
        maxSize: 1,
        class: 'Z',
        sentenceDesc: `Very small trip.`,
    })
    // trip7: Staging, no blurb/sentenceDesc — for /lead/task, /lead/alter, /lead/open tests
    let trip7 = Trip.upsert({
        id: 7,
        tripName: 'Staging Test Trip',
        plannedDate: new Date("2026-10-15"),
        category: 'Hiking',
        status: 'Staging',
        maxSize: 10,
        class: 'Z',
    })
    // trip8: Pre-Trip — for /lead/participants, /lead/add-participant, /lead/remove-participant tests
    let trip8 = Trip.upsert({
        id: 8,
        tripName: 'Pre-Trip Test Trip',
        plannedDate: new Date("2026-10-20"),
        category: 'Camping',
        status: 'Pre-Trip',
        maxSize: 2,
        class: 'Z',
        sentenceDesc: 'A test trip for integration testing',
    })
    // trip9: Post-Trip, past date — for /lead/attendance test
    let trip9 = Trip.upsert({
        id: 9,
        tripName: 'Post-Trip Test Trip',
        plannedDate: new Date("2026-05-01"),
        category: 'Backpacking',
        status: 'Post-Trip',
        maxSize: 5,
        class: 'Z',
        sentenceDesc: 'A past trip for integration testing',
    })
    // trip10: Open, waitlist capped at 1 — lottery must fill all three buckets
    let trip10 = Trip.upsert({
        id: 10,
        tripName: 'Capped Waitlist Trip',
        plannedDate: new Date("2026-11-05"),
        category: 'Climbing',
        status: 'Open',
        maxSize: 1,
        waitlistSize: 1,
        class: 'Z',
        sentenceDesc: 'A trip whose waitlist only holds one person',
    })
    // trip11: Open, waitlist disabled — everyone not selected is rejected outright
    let trip11 = Trip.upsert({
        id: 11,
        tripName: 'No Waitlist Trip',
        plannedDate: new Date("2026-11-06"),
        category: 'Running',
        status: 'Open',
        maxSize: 1,
        waitlistSize: 0,
        class: 'Z',
        sentenceDesc: 'A trip with no waitlist at all',
    })
    //Signups come from verify.py, which auto-creates well over a mailer batch of
    //participants to prove the lottery mail is split under Gmail's recipient cap
    let trip12 = Trip.upsert({
        id: 12,
        tripName: 'Big Trip',
        plannedDate: new Date("2026-11-07"),
        category: 'Event',
        status: 'Open',
        maxSize: 2,
        class: 'Z',
        sentenceDesc: 'A trip with more signups than fit in one email',
    })
    //A trip that ran and took attendance, with fees still owed - the payment reminder job
    //(test-helpers/remind-payments.mjs) is replayed against it on chosen dates
    let trip13 = Trip.upsert({
        id: 13,
        tripName: 'Unpaid Test Trip',
        plannedDate: "2026-04-20", //A string, so no timezone shifts the day the reminders count from
        category: 'Hiking',
        status: 'Complete',
        maxSize: 5,
        class: 'C',
        sentenceDesc: 'Attended, and two of three attendees have not paid',
    })
    await Promise.all([user, user2, user3, user4, user5, user6, user7, user8, user9, user10, user11, user12,
        trip, trip2, trip3, trip4, trip5, trip6, trip7, trip8, trip9, trip10, trip11, trip12, trip13]);

    let ts1 = TripSignUp.create({
        userId: 1,
        tripId: 6,
        tripRole: "Leader",
    });
    let ts2 = TripSignUp.create({
        userId: 2,
        tripId: 6,
        tripRole: "Participant",
        confirmed: 1,
    });
    let ts3 = TripSignUp.create({
        userId: 3,
        tripId: 6,
        tripRole: "Participant",
        confirmed: 1,
    });
    let ts4 = TripSignUp.create({
        userId: 4,
        tripId: 6,
        tripRole: "Participant",
        confirmed: 1,
    });
    await Promise.all([ts1, ts2, ts3, ts4]);

    // Additional signups for trips 7-9 and User 1 as participant on trip 3
    let ts5  = TripSignUp.create({ userId: 1, tripId: 7, tripRole: "Leader" });
    let ts6  = TripSignUp.create({ userId: 1, tripId: 8, tripRole: "Leader" });
    let ts7  = TripSignUp.create({ userId: 2, tripId: 8, tripRole: "Participant", status: "Selected",   confirmed: 1 });
    let ts8  = TripSignUp.create({ userId: 3, tripId: 8, tripRole: "Participant", status: "Waitlisted", confirmed: 1 });
    let ts9  = TripSignUp.create({ userId: 1, tripId: 9, tripRole: "Leader" });
    let ts10 = TripSignUp.create({ userId: 2, tripId: 9, tripRole: "Participant", status: "Selected",   confirmed: 1, paid: 1 });
    let ts11 = TripSignUp.create({ userId: 1, tripId: 3, tripRole: "Participant", status: "Signed Up" });
    await Promise.all([ts5, ts6, ts7, ts8, ts9, ts10, ts11]);

    // Signups for the waitlist-size trips: 3 participants each, so a maxSize of 1
    // leaves 2 for the waitlist cap to split
    let ts12 = TripSignUp.create({ userId: 1, tripId: 10, tripRole: "Leader" });
    let ts13 = TripSignUp.create({ userId: 5, tripId: 10, tripRole: "Participant" });
    let ts14 = TripSignUp.create({ userId: 6, tripId: 10, tripRole: "Participant" });
    let ts15 = TripSignUp.create({ userId: 7, tripId: 10, tripRole: "Participant" });
    let ts16 = TripSignUp.create({ userId: 1, tripId: 11, tripRole: "Leader" });
    let ts17 = TripSignUp.create({ userId: 8, tripId: 11, tripRole: "Participant" });
    let ts18 = TripSignUp.create({ userId: 9, tripId: 11, tripRole: "Participant" });
    let ts19 = TripSignUp.create({ userId: 10, tripId: 11, tripRole: "Participant" });
    let ts20 = TripSignUp.create({ userId: 1, tripId: 12, tripRole: "Leader" });
    let ts21 = TripSignUp.create({ userId: 1, tripId: 13, tripRole: "Leader" });
    let ts22 = TripSignUp.create({ userId: 5, tripId: 13, tripRole: "Participant", status: "Attended", confirmed: 1 });
    let ts23 = TripSignUp.create({ userId: 6, tripId: 13, tripRole: "Participant", status: "Attended", confirmed: 1 });
    let ts24 = TripSignUp.create({ userId: 7, tripId: 13, tripRole: "Participant", status: "Attended", confirmed: 1, paid: 1 });
    let ts25 = TripSignUp.create({ userId: 8, tripId: 13, tripRole: "Participant", status: "No Show",  confirmed: 1 });
    await Promise.all([ts12, ts13, ts14, ts15, ts16, ts17, ts18, ts19, ts20, ts21, ts22, ts23, ts24, ts25]);

    //Close connection so as not to leave hanging connections
    sequelize.close();
})();

