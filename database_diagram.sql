-- Use DBML to define your database structure
-- Docs: https://dbml.dbdiagram.io/docs

Table users {
  -- Firebase cloud storage uses id_first_last
  id integer [primary key, increment]
  first_name varchar
  last_name varchar
  email varchar [unique]
  phone varchar
  role enum('Admin','Participant','Leader') [not null]
  lottery_weight float [default: 1]
  has_waiver boolean [default: false]
  trips_lead integer [default: 0]
  trips_participated integer [default: 0]
}

Table trips {
  // Firebase cloud storage uses id_trip_name
  id integer [primary key, increment]
  trip_name varchar [not null] -- Combination of trip_name and planned_date must be unique
  planned_date datetime [not null]
  max_size integer
  class varchar(1)      -- Either class or
  price_override float  -- price_overrid will be NULL but not both
  paperwork_links json -- Array of links to paperwork documents
  image_links json -- Array of links to images
  sentence_desc varchar(100)
  blurb text
  planning_checklist json -- Planning tasks, completion status, and whos responsible
}

Table trip_classes {
  trip_class varchar(1) [primary key]
  link varchar
  price float [not null]
}

Table trip_user_map {
  trip_id integer [not null] -- Combination of trip_id and
  user_id integer [not null] -- user_id will function as primary key
  trip_role enum('Leader','Participant') [not null]
  -- Following are NULL for Leaders and have defaults for Participants
  status enum('Signed Up','Selected','Not Selected','Attended','No Show')
  need_paperwork boolean
  confirmed boolean
}

-- Multiple users/trips get mapped to eachother
Ref: trip_user_map.trip_id > trips.id
Ref: trip_user_map.user_id > users.id

Ref: trip_classes.trip_class < trips.class

/* Old schema
Table users {
  -- Firebase cloud storage uses id_first_last
  id integer [primary key]
  first_name varchar
  last_name varchar
  email varchar
  phone varchar
  role_id integer
}

Table web_roles {
  -- Participant, trip leader, or admin
  id integer [primary key]
  role_name varchar
}

Table trip_user {
  -- This includes both leader and user instances
  instance_id integer [primary key]
  trip_id integer
  user_id integer

  trip_role integer
}

Table trip_roles {
  id integer [primary key]
  role_name varchar
}

Table trips {
  -- Firebase cloud storage uses id_trip_name
  id integer [primary key]
  trip_name varchar unique
  planned_date datetime -- Editable before trip happens
  
  class varchar(1)
  price_override float
}

Table trip_classes {
  trip_class varchar(1) [primary key]
  link varchar
  price float
}

-- Each user has a role
Ref: users.role_id > web_roles.id
Ref: trip_user.trip_role > trip_roles.id

-- Multiple users/trips get mapped to eachother
Ref: trip_user.trip_id > trips.id
Ref: trip_user.user_id > users.id

Ref: trip_classes.trip_class < trips.class
*/