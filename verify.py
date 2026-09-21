"""
Integration tests for the BOC web server.

PREREQUISITES:
  1. DEVELOPING must be set in .env (it enables the test identity bypass in
     server.mjs). No source edits or middleware swaps are needed.
  2. Reset the database before running:
       node default_insts.mjs
  3. Start the server:
       node server.mjs

Requests authenticate by sending an `e2e:<email>` bearer token, which the server
accepts in place of a real Google token while DEVELOPING is set. Tests act as
User 1 (William Stone, Admin) by default; use the as_user() context manager to
act as somebody else for a few requests:

    with as_user("alan_wang2@brown.edu"):
        r = post("/trip/6/signup")

Tests are numbered (test_01_, test_02_, ...) and run in that order.
They share database state, so do not run individual tests in isolation
without resetting the database first.
"""

import json
import os
import requests
import subprocess
import unittest
from contextlib import contextmanager
from datetime import date

BASE_URL = "http://localhost:8080"

# The account requests act as. Changed only via as_user().
DEFAULT_USER = "william_l_stone@brown.edu"
_current_user = DEFAULT_USER


@contextmanager
def as_user(email):
    """Act as `email` for the duration of the block, then restore the previous
    identity. Pass None to send requests with no credentials at all."""
    global _current_user
    previous = _current_user
    _current_user = email
    try:
        yield
    finally:
        _current_user = previous


def _headers():
    if _current_user is None:
        return {}
    return {"Authorization": f"Bearer e2e:{_current_user}"}


def get(path):
    return requests.get(f"{BASE_URL}{path}", headers=_headers())

def post(path, body=None):
    return requests.post(f"{BASE_URL}{path}", json=body, headers=_headers())


# Mail is captured to a file rather than sent while DEVELOPING is set (see mailer.mjs).
# The email tests at the end of the suite assert against what earlier tests produced.
SENT_MAIL_FILE = "./sent_mail.jsonl"

# Subject lines are copy, and copy lives in email-client/notifications.mjs. These are the
# only assertions tied to wording, so they are collected here: if the club edits a subject
# the email tests fail pointing at this block, rather than in five scattered places.
SUBJ_SELECTED = "SELECTED - "
SUBJ_PROMOTED = "You have a spot on "
SUBJ_WAITLISTED = "WAITLISTED - "
SUBJ_NOT_SELECTED = "Status Update: "
SUBJ_THANKS = "Thanks for coming on "
SUBJ_NO_SHOW = "We missed you on "
SUBJ_CANCELLED = "CANCELLED - "
SUBJ_PAYMENT_DUE = "Payment reminder - "
SUBJ_PAYMENT_OVERDUE = "[ACTION REQUIRED] Payment overdue - "
SUBJ_UNPAID_HANDOFF = "Unpaid participants - "


def all_sent_mail():
    """Every captured message, one JSON object per line."""
    try:
        with open(SENT_MAIL_FILE) as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def sent_mail(subject_prefix):
    """Every captured message whose subject starts with subject_prefix."""
    return [m for m in all_sent_mail() if m["subject"].startswith(subject_prefix)]


class ServerTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Clear captured mail so the email tests only see this run's messages."""
        if os.path.exists(SENT_MAIL_FILE):
            os.remove(SENT_MAIL_FILE)

    # =========================================================================
    # / OR <undefined_route>
    # =========================================================================

    def test_01_undefined_route_returns_404(self):
        r = get("/this-route-does-not-exist")
        self.assertEqual(r.status_code, 404)

    # =========================================================================
    # /trips
    # =========================================================================

    def test_02_trips_returns_200_and_array(self):
        r = get("/trips")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_03_trips_excludes_staging_trips(self):
        """Trip 7 is Staging and must never appear in /trips."""
        r = get("/trips")
        trip_ids = [t["id"] for t in r.json()]
        self.assertNotIn(7, trip_ids)

    def test_04_trips_semester_filtering(self):
        """During summer (Jun-Aug) /trips returns []; during semesters it includes
        non-Staging trips whose plannedDate falls in the current semester window."""
        month = date.today().month
        r = get("/trips")
        data = r.json()
        if month in [6, 7, 8]:
            self.assertEqual(data, [], "Expected [] during summer months")
        else:
            self.assertGreater(len(data), 0,
                "Expected non-empty during semester months — ensure default data "
                "contains non-Staging trips with dates in the current semester")

    # =========================================================================
    # /leaders
    # =========================================================================

    def test_05_leaders_includes_admin_users(self):
        r = get("/leaders")
        self.assertEqual(r.status_code, 200)
        emails = [l["email"] for l in r.json()]
        self.assertIn("william_l_stone@brown.edu", emails)
        self.assertIn("alan_wang2@brown.edu", emails)

    def test_06_leaders_excludes_participant_users(self):
        r = get("/leaders")
        emails = [l["email"] for l in r.json()]
        self.assertNotIn("test@du.de", emails)

    # =========================================================================
    # /user/
    # =========================================================================

    def test_07_user_basic_returns_correct_user(self):
        r = get("/user/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["email"], "william_l_stone@brown.edu")

    def test_08_user_basic_excludes_sensitive_fields(self):
        data = get("/user/").json()
        self.assertNotIn("id", data)
        self.assertNotIn("lotteryWeight", data)
        self.assertNotIn("TripSignUps", data)

    # =========================================================================
    # /user/profile
    # =========================================================================

    def test_09_user_profile_includes_signups(self):
        r = get("/user/profile")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("TripSignUps", data)
        self.assertIsInstance(data["TripSignUps"], list)
        self.assertNotIn("lotteryWeight", data)

    # =========================================================================
    # /user/add-phone
    # =========================================================================

    def test_10_add_phone_success(self):
        r = post("/user/add-phone", {"phoneNum": "(401) 555-1234"})
        self.assertEqual(r.status_code, 200)
        profile = get("/user/profile").json()
        self.assertEqual(profile["phone"], "4015551234")  # non-numeric stripped

    def test_11_add_phone_missing_field_returns_422(self):
        r = post("/user/add-phone", {"wrongField": "555-1234"})
        self.assertEqual(r.status_code, 422)

    # =========================================================================
    # /user/listserv-add
    # =========================================================================

    def test_12_listserv_add_success(self):
        r = post("/user/listserv-add")
        self.assertEqual(r.status_code, 200)
        profile = get("/user/profile").json()
        self.assertTrue(profile["joinedListserv"])

    def test_13_listserv_add_noop_if_already_joined(self):
        """Second call must succeed silently — no error."""
        r = post("/user/listserv-add")
        self.assertEqual(r.status_code, 200)

    # =========================================================================
    # /trip/<tripId>
    # =========================================================================

    def test_14_trip_get_leader_view_includes_planning_checklist(self):
        """User 1 is leader on trip 6; planningChecklist must be present."""
        r = get("/trip/6")
        self.assertEqual(r.status_code, 200)
        self.assertIn("planningChecklist", r.json())

    def test_15_trip_get_non_member_view_excludes_planning_checklist(self):
        """User 1 has no signup on trip 2; planningChecklist must be absent."""
        r = get("/trip/2")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("planningChecklist", r.json())

    def test_16_trip_get_staging_as_leader_succeeds(self):
        """User 1 is leader on trip 7 (Staging); leader view must work."""
        r = get("/trip/7")
        self.assertEqual(r.status_code, 200)
        self.assertIn("planningChecklist", r.json())

    def test_16b_trip_get_staging_as_non_member_returns_401(self):
        """A Staging trip is private. Previously untestable: it needs a second
        identity, which phonyAuth could not provide without a restart."""
        with as_user("ada.lovelace@brown.edu"):
            r = get("/trip/7")
        self.assertEqual(r.status_code, 401)

    def test_16c_trip_get_staging_logged_out_returns_401(self):
        with as_user(None):
            r = get("/trip/7")
        self.assertEqual(r.status_code, 401)

    def test_17_trip_get_nonexistent_returns_404(self):
        r = get("/trip/99999")
        self.assertEqual(r.status_code, 404)

    # =========================================================================
    # /trip/<tripId>/is-signed-up
    # =========================================================================

    def test_18_is_signed_up_true_for_leader(self):
        r = get("/trip/6/is-signed-up")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json())

    def test_19_is_signed_up_true_for_participant(self):
        """User 1 is a Participant on trip 3 (added in default_insts)."""
        r = get("/trip/3/is-signed-up")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json())

    def test_20_is_signed_up_false_when_not_on_trip(self):
        r = get("/trip/2/is-signed-up")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json())

    # =========================================================================
    # /leader/create-trip
    # =========================================================================

    def test_21_create_trip_success(self):
        r = post("/leader/create-trip", {
            "leaders": [],
            "tripName": "Verify.py Test Trip",
            "category": "Hiking",
            "plannedDate": "2026-11-01",
            "plannedEndDate": None,
            "maxSize": 15,
            "class": "B",
            "priceOverride": None,
            "sentenceDesc": "Created by verify.py integration tests",
            "blurb": None,
            "image": None,
        })
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["tripName"], "Verify.py Test Trip")
        self.assertEqual(data["status"], "Staging")

    def test_22_create_trip_missing_fields_returns_422(self):
        r = post("/leader/create-trip", {
            "leaders": [],
            "tripName": "Incomplete Trip",
        })
        self.assertEqual(r.status_code, 422)

    # =========================================================================
    # /trip/<tripId>/lead/task
    # =========================================================================

    def test_23_lead_task_update_success(self):
        """Update a manual task on trip 7 (Staging)."""
        r = post("/trip/7/lead/task", {
            "task": "Add to Google Calendar",
            "responsible": "william_l_stone@brown.edu",
            "complete": True,
        })
        self.assertEqual(r.status_code, 200)

    def test_24_lead_task_auto_task_completion_blocked(self):
        """Manually marking the automated 'Lottery' task complete must return 403."""
        r = post("/trip/7/lead/task", {
            "task": "Lottery",
            "responsible": "",
            "complete": True,
        })
        self.assertEqual(r.status_code, 403)

    # =========================================================================
    # /trip/<tripId>/lead/open  (failure — before alter adds blurb)
    # =========================================================================

    def test_25_lead_open_fails_without_blurb_or_sentence_desc(self):
        """Trip 7 has no blurb or sentenceDesc yet; open must fail with 403."""
        r = post("/trip/7/lead/open")
        self.assertEqual(r.status_code, 403)

    # =========================================================================
    # /trip/<tripId>/lead/alter
    # =========================================================================

    def test_26_lead_alter_success(self):
        """Add blurb and sentenceDesc to trip 7 to enable /lead/open."""
        r = post("/trip/7/lead/alter", {
            "sentenceDesc": "A staging test trip for integration testing.",
            "blurb": "This trip exists to test /lead/alter and /lead/open.",
        })
        self.assertEqual(r.status_code, 200)

    def test_27_lead_alter_pricing_change_after_staging_returns_422(self):
        """Changing class on a Pre-Trip trip (trip 8) must fail with 422."""
        r = post("/trip/8/lead/alter", {"class": "A"})
        self.assertEqual(r.status_code, 422)

    # =========================================================================
    # /trip/<tripId>/lead/open  (success — after alter added blurb)
    # =========================================================================

    def test_28_lead_open_success_after_alter(self):
        """Trip 7 now has blurb and sentenceDesc; open must succeed."""
        r = post("/trip/7/lead/open")
        self.assertEqual(r.status_code, 200)

    # =========================================================================
    # /trip/<tripId>/lead/lottery
    # =========================================================================

    def test_29_lead_lottery_success(self):
        """Run lottery on trip 6 (Open, maxSize=1, 3 participants).
        Expect 1 accepted and 2 waitlisted (all non-winners are waitlisted).
        Trip 6 becomes Pre-Trip after this test."""
        r = post("/trip/6/lead/lottery")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("accepted", data)
        self.assertIn("waitlisted", data)
        self.assertIn("notAccepted", data)
        self.assertEqual(len(data["accepted"]), 1)
        self.assertEqual(len(data["waitlisted"]), 2)
        self.assertEqual(len(data["notAccepted"]), 0)

    # =========================================================================
    # /trip/<tripId>/lead/participants
    # =========================================================================

    def test_30_lead_participants_returns_list_with_correct_fields(self):
        """Trip 8 has User 2 (Selected) and User 3 (Waitlisted) as participants."""
        r = get("/trip/8/lead/participants")
        self.assertEqual(r.status_code, 200)
        participants = r.json()
        self.assertIsInstance(participants, list)
        self.assertEqual(len(participants), 2)
        for field in ("firstName", "lastName", "email", "status", "confirmed", "paid"):
            self.assertIn(field, participants[0])

    # =========================================================================
    # /trip/<tripId>/lead/add-participant
    # =========================================================================

    def test_31_lead_add_participant_success(self):
        """Move User 3 (Waitlisted, confirmed) on trip 8 to Selected."""
        r = post("/trip/8/lead/add-participant")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["success"], 1)

    def test_32_lead_add_participant_returns_zero_when_waitlist_empty(self):
        """After moving User 3, trip 8 waitlist is empty; success must be 0."""
        r = post("/trip/8/lead/add-participant")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["success"], 0)

    # =========================================================================
    # /trip/<tripId>/lead/remove-participant
    # =========================================================================

    def test_33_lead_remove_participant_success(self):
        """Remove User 2 (Selected) from trip 8."""
        r = post("/trip/8/lead/remove-participant", {"email": "alan_wang2@brown.edu"})
        self.assertEqual(r.status_code, 200)

    def test_34_lead_remove_nonselected_participant_returns_422(self):
        """User 2 is now Not Selected — removing again must fail with 422."""
        r = post("/trip/8/lead/remove-participant", {"email": "alan_wang2@brown.edu"})
        self.assertEqual(r.status_code, 422)

    # =========================================================================
    # /trip/<tripId>/lead/attendance
    # =========================================================================

    def test_35_lead_attendance_success(self):
        """Take attendance on trip 9 (Post-Trip, past date). User 2 attended, and
        User 3 - seeded Not Selected on this trip - came along as a walk-on, which
        used to collide with their existing signup row (Apple Picking, 2026-09-21).
        Trip 9 becomes Complete after this test."""
        r = post("/trip/9/lead/attendance", {
            "selectedParticipants": {"alan_wang2@brown.edu": "Attended"},
            "additionalParticipants": ["test@du.de"],
        })
        self.assertEqual(r.status_code, 200)
        trip = get("/trip/9").json()
        self.assertEqual(trip["status"], "Complete")
        status = {p["email"]: p["status"] for p in get("/trip/9/lead/participants").json()}
        self.assertEqual(status["alan_wang2@brown.edu"], "Attended")
        self.assertEqual(status["test@du.de"], "Attended")

    # =========================================================================
    # /trip/<tripId>/signup
    # =========================================================================

    def test_36_signup_for_open_trip_success(self):
        """User 1 signs up for trip 5 (Open, not already on it)."""
        r = post("/trip/5/signup")
        self.assertEqual(r.status_code, 200)

    def test_37_signup_for_non_open_trip_returns_403(self):
        """Signing up for trip 8 (Pre-Trip) must fail with 403."""
        r = post("/trip/8/signup")
        self.assertEqual(r.status_code, 403)

    # =========================================================================
    # /trip/<tripId>/participate/confirm + cancel (+ the removed pay route)
    # Run in order on trip 3, where User 1 is a Participant in default_insts.
    # =========================================================================

    def test_38_participate_confirm_success(self):
        r = post("/trip/3/participate/confirm")
        self.assertEqual(r.status_code, 200)
        signups = get("/user/profile").json()["TripSignUps"]
        trip3 = next((s for s in signups if s["tripId"] == 3), None)
        self.assertIsNotNone(trip3)
        self.assertTrue(trip3["confirmed"])

    def test_39_participate_pay_route_removed(self):
        """Payment is recorded from Marketplace receipts (payments/), never self-reported."""
        self.assertEqual(post("/trip/3/participate/pay").status_code, 404)

    def test_40_participate_cancel_destroys_signup(self):
        r = post("/trip/3/participate/cancel")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(get("/trip/3/is-signed-up").json())

    # =========================================================================
    # /public/leader-stats/:first/:last
    # =========================================================================

    def test_41_public_leader_stats_success(self):
        r = get("/public/leader-stats/William/Stone")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("totalTrips", data)
        self.assertIsInstance(data["totalTrips"], int)
        self.assertGreaterEqual(data["totalTrips"], 1)

    # =========================================================================
    # /public/leader-trips/:first/:last
    # =========================================================================

    def test_42_public_leader_trips_success(self):
        r = get("/public/leader-trips/William/Stone")
        self.assertEqual(r.status_code, 200)
        trips = r.json()
        self.assertIsInstance(trips, list)
        self.assertGreater(len(trips), 0)
        for field in ("tripId", "tripName", "date", "sentenceDesc", "lotteryInfo"):
            self.assertIn(field, trips[0])
        self.assertEqual(trips[0]["lotteryInfo"], "Hosted Trip")


    # =========================================================================
    # Test identity bypass
    # =========================================================================

    def test_43_unauthenticated_request_to_protected_route_returns_401(self):
        """Sending no credentials at all must not fall through as a logged-in user."""
        with as_user(None):
            r = get("/user/")
        self.assertEqual(r.status_code, 401)

    def test_44_can_act_as_a_different_user(self):
        """The whole point of the bypass: switching identity mid-run, no restart."""
        with as_user("alan_wang2@brown.edu"):
            r = get("/user/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["email"], "alan_wang2@brown.edu")
        # Identity must be restored after the block
        self.assertEqual(get("/user/").json()["email"], "william_l_stone@brown.edu")

    def test_45_unseen_brown_email_is_auto_created(self):
        """Mirrors the real Google path: first request from a Brown address makes a user."""
        with as_user("auto.created@brown.edu"):
            r = get("/user/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["email"], "auto.created@brown.edu")
        self.assertEqual(data["firstName"], "auto")
        self.assertEqual(data["lastName"], "created")
        self.assertEqual(data["role"], "Participant")

    def test_46_non_brown_email_is_rejected(self):
        """The bypass must not sidestep the Brown/RISD restriction."""
        with as_user("someone@gmail.com"):
            r = get("/user/")
        self.assertEqual(r.status_code, 401)

    # =========================================================================
    # Email notifications
    #
    # These assert against mail captured by earlier tests in this run: the
    # lottery in test_29 (trip 6), the waitlist add in test_31/32 (trip 8), and
    # attendance in test_35 (trip 9).
    # =========================================================================

    def test_47_lottery_emails_selected_and_waitlisted_groups(self):
        """Trip 6 selects 1 of 3 signups; the other 2 are waitlisted.
        No 'not selected' mail, since the lottery waitlists everyone it drops."""
        #Subjects carry the trip name, so these counts stay scoped to trip 6 even
        #if another test later runs a lottery elsewhere
        selected = sent_mail(SUBJ_SELECTED + "Small Trip")
        waitlisted = sent_mail(SUBJ_WAITLISTED + "Small Trip")
        self.assertEqual(len(selected), 1)
        self.assertEqual(len(waitlisted), 1)
        self.assertEqual(len(sent_mail(SUBJ_NOT_SELECTED + "Small Trip")), 0)
        self.assertEqual(len(selected[0]["bcc"]), 1)
        self.assertEqual(len(waitlisted[0]["bcc"]), 2)

    def test_48_waitlist_promotion_emails_only_the_promoted_user(self):
        """test_31 promoted one user off trip 8; test_32 promoted nobody and
        must not have sent an empty message."""
        messages = sent_mail(SUBJ_PROMOTED + "Pre-Trip Test Trip")
        self.assertEqual(len(messages), 1)
        #Which waitlister gets promoted is random, so only the count is asserted
        self.assertEqual(len(messages[0]["bcc"]), 1)

    def test_49_attendance_thanks_attendees_and_skips_excused(self):
        """Trip 9: one attendee plus one walk-on, no no-shows, so only the thank-you goes out."""
        messages = sent_mail(SUBJ_THANKS + "Post-Trip Test Trip")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["bcc"], ["alan_wang2@brown.edu", "test@du.de"])
        self.assertEqual(len(sent_mail(SUBJ_NO_SHOW + "Post-Trip Test Trip")), 0)

    def test_51_rendered_emails_have_no_leftover_markup(self):
        """Templates are written with *bold* and [label](url); every message must
        come out with both expanded, or the club will see raw markup in Gmail."""
        messages = all_sent_mail()
        self.assertGreater(len(messages), 0)
        for m in messages:
            self.assertIn("html", m, f"no html body on {m['subject']}")
            self.assertNotIn("*", m["html"], f"unconverted asterisk in {m['subject']}")
            self.assertNotIn("](", m["html"], f"unconverted link in {m['subject']}")
            #The plain-text alternative keeps the URL visible instead of a bare label
            self.assertNotIn("](", m["text"])

    def test_50_participants_are_bcc_only_and_leaders_are_cc(self):
        """The privacy property every trip email depends on: a recipient must
        never appear in a header the other recipients can read."""
        messages = all_sent_mail()
        self.assertGreater(len(messages), 0)
        for m in messages:
            if not m["bcc"]: continue #A message to the leaders alone has nobody to hide
            #Replies must reach a person; leaders are CC'd on all but the payment reminders
            self.assertTrue(m["replyTo"], f"no Reply-To on {m['subject']}")
            if m["cc"]: self.assertEqual(m["replyTo"], ", ".join(m["cc"]))
            for recipient in m["bcc"]:
                self.assertNotIn(recipient, m["cc"])
                self.assertNotEqual(recipient, m["to"])

    # =========================================================================
    # Trip waitlist sizes
    #
    # These run after the email tests above (test_60 > test_51 alphabetically),
    # so the mail they generate is asserted here rather than there.
    # =========================================================================

    def test_60_lottery_respects_waitlist_size(self):
        """Trip 10 is Open with maxSize=1, waitlistSize=1 and 3 participants, so
        the lottery must fill all three buckets."""
        r = post("/trip/10/lead/lottery")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["accepted"]), 1)
        self.assertEqual(len(data["waitlisted"]), 1)
        self.assertEqual(len(data["notAccepted"]), 1)

    def test_61_lottery_with_zero_waitlist_size_rejects_everyone(self):
        """Trip 11 has waitlistSize=0, so nobody waits — the 2 losers are rejected."""
        r = post("/trip/11/lead/lottery")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["accepted"]), 1)
        self.assertEqual(len(data["waitlisted"]), 0)
        self.assertEqual(len(data["notAccepted"]), 2)

    def test_62_not_selected_email_sends_when_waitlist_is_capped(self):
        """The only coverage the 'not selected' template gets: it cannot fire on a
        trip with an unlimited waitlist."""
        messages = sent_mail(SUBJ_NOT_SELECTED + "Capped Waitlist Trip")
        self.assertEqual(len(messages), 1)
        m = messages[0]
        self.assertEqual(len(m["bcc"]), 1)
        self.assertGreater(len(m["cc"]), 0)
        self.assertNotIn(m["bcc"][0], m["cc"])
        #Same markup check test_51 makes, which ran before this mail existed
        self.assertNotIn("*", m["html"])
        self.assertNotIn("](", m["html"])
        self.assertEqual(len(sent_mail(SUBJ_WAITLISTED + "No Waitlist Trip")), 0)

    def test_63_alter_accepts_waitlist_size(self):
        """waitlistSize is editable while a trip is still Staging/Open."""
        r = post("/trip/7/lead/alter", {"waitlistSize": 3})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(get("/trip/7").json()["waitlistSize"], 3)

    # =========================================================================
    # Mail batching
    #
    # Gmail refuses every recipient past 100 per message and nodemailer resolves
    # anyway, so mailer.mjs splits BCC into batches. Trip 12 gets more signups
    # than one batch holds; the lottery then has to produce several messages.
    # =========================================================================

    #Must match MAX_RECIPIENTS in email-client/mailer.mjs
    MAX_RECIPIENTS = 90
    BIG_TRIP_SIGNUPS = 120

    def test_65_lottery_mail_is_batched_under_the_recipient_cap(self):
        """Every waitlister is BCC'd exactly once across the batches, no batch
        exceeds the cap counting To and CC, and each batch keeps the leaders."""
        for i in range(self.BIG_TRIP_SIGNUPS):
            with as_user(f"bulk_{i}@brown.edu"):
                self.assertEqual(post("/trip/12/signup").status_code, 200)
        r = post("/trip/12/lead/lottery")
        self.assertEqual(r.status_code, 200)
        waitlisted = r.json()["waitlisted"]
        self.assertEqual(len(waitlisted), self.BIG_TRIP_SIGNUPS - 2)
        batches = sent_mail(SUBJ_WAITLISTED + "Big Trip")
        self.assertGreater(len(batches), 1)
        seen = []
        for m in batches:
            self.assertLessEqual(1 + len(m["cc"]) + len(m["bcc"]), self.MAX_RECIPIENTS)
            self.assertGreater(len(m["cc"]), 0)
            self.assertEqual(m["text"], batches[0]["text"])
            seen += m["bcc"]
        self.assertEqual(sorted(seen), sorted(waitlisted))
        #The two selected fit in one message, so that one must not be split
        self.assertEqual(len(sent_mail(SUBJ_SELECTED + "Big Trip")), 1)

    # =========================================================================
    # Batch waitlist promotion
    #
    # Trip 6 is left in Pre-Trip by test_29 with 2 confirmed waitlisters, and
    # nothing between there and here touches it. These run after the email
    # tests (test_47-test_51), which sweep all captured mail.
    # =========================================================================

    def test_70_lead_add_participant_rejects_a_bad_count(self):
        """count must be a positive integer, so neither 0 nor a string works."""
        self.assertEqual(post("/trip/6/lead/add-participant", {"count": 0}).status_code, 422)
        self.assertEqual(post("/trip/6/lead/add-participant", {"count": "2"}).status_code, 422)
        self.assertEqual(post("/trip/6/lead/add-participant", {"number": 2}).status_code, 422)

    def test_71_lead_add_participant_batch_clamps_to_waitlist(self):
        """Trip 6 has 2 waitlisted; asking for 5 promotes both and no more."""
        r = post("/trip/6/lead/add-participant", {"count": 5})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["success"], 2)
        self.assertEqual(len(data["added"]), 2)

    def test_72_batch_promotion_sends_one_message_to_everyone_promoted(self):
        """The batch is one mail with both promoted users bcc'd, and the now-empty
        waitlist adds nothing further."""
        r = post("/trip/6/lead/add-participant", {"count": 2})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["success"], 0)
        self.assertEqual(r.json()["added"], [])
        messages = sent_mail(SUBJ_PROMOTED + "Small Trip")
        self.assertEqual(len(messages), 1)
        self.assertEqual(len(messages[0]["bcc"]), 2)

    # =========================================================================
    # /trip/<tripId>/lead/cancel
    #
    # These create the trips they destroy, so no seeded trip disappears out from
    # under a later test. They run after the email sweeps (test_50/test_51), so
    # the cancellation mail is checked here instead.
    # =========================================================================

    def _make_trip(self, name, **overrides):
        """Create a trip led by the default user and return its id."""
        body = {
            "leaders": [],
            "tripName": name,
            "category": "Hiking",
            "plannedDate": "2027-03-01",
            "plannedEndDate": None,
            "maxSize": 15,
            "class": "Z",
            "priceOverride": None,
            "sentenceDesc": "Created by verify.py cancellation tests",
            "blurb": None,
            "image": None,
        }
        body.update(overrides)
        r = post("/leader/create-trip", body)
        self.assertEqual(r.status_code, 200)
        return r.json()["id"]

    def test_80_cancel_staging_trip_deletes_it(self):
        """A Staging trip has no participants, so this cancels silently."""
        trip_id = self._make_trip("Cancel Me While Staging")
        r = post(f"/trip/{trip_id}/lead/cancel")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(get(f"/trip/{trip_id}").status_code, 404)
        self.assertEqual(len(sent_mail(SUBJ_CANCELLED + "Cancel Me While Staging")), 0)

    def test_81_cancel_after_pre_trip_returns_403(self):
        """Trip 9 was taken to Complete by test_35 and can no longer be cancelled."""
        r = post("/trip/9/lead/cancel")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(get("/trip/9").status_code, 200)

    def test_82_cancel_open_trip_emails_everyone_signed_up(self):
        """Everyone with a signup on an Open trip is told, in one message."""
        trip_id = self._make_trip("Cancel Me While Open", blurb="A trip to cancel")
        self.assertEqual(post(f"/trip/{trip_id}/lead/open").status_code, 200)
        for email in ["ada.lovelace@brown.edu", "grace.hopper@brown.edu"]:
            with as_user(email):
                self.assertEqual(post(f"/trip/{trip_id}/signup").status_code, 200)
        r = post(f"/trip/{trip_id}/lead/cancel")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(get(f"/trip/{trip_id}").status_code, 404)
        messages = sent_mail(SUBJ_CANCELLED + "Cancel Me While Open")
        self.assertEqual(len(messages), 1)
        m = messages[0]
        self.assertEqual(sorted(m["bcc"]),
                         ["ada.lovelace@brown.edu", "grace.hopper@brown.edu"])
        #The privacy and markup checks test_50/test_51 make, which both ran before
        #this mail existed
        self.assertGreater(len(m["cc"]), 0)
        self.assertEqual(m["replyTo"], ", ".join(m["cc"]))
        for recipient in m["bcc"]:
            self.assertNotIn(recipient, m["cc"])
        self.assertNotIn("*", m["html"])
        self.assertNotIn("](", m["html"])
        #A cancellation must never link to the trip page - the trip is gone
        self.assertNotIn("/trips/view", m["html"])

    def test_83_cancel_as_non_leader_returns_401(self):
        """Deliberately a failure case, so trip 8 survives for later tests."""
        with as_user("ada.lovelace@brown.edu"):
            r = post("/trip/8/lead/cancel")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(get("/trip/8").status_code, 200)

    # =========================================================================
    # /leader/firebase-token
    # =========================================================================
    # The service account key lives only on the production VM, so a real token cannot be
    # minted here. What these assert is the half that matters locally: who is allowed to
    # ask, and that a server without a key degrades instead of erroring out.

    def test_90_firebase_token_requires_login(self):
        with as_user(None):
            r = get("/leader/firebase-token")
        self.assertEqual(r.status_code, 401)

    def test_91_firebase_token_rejects_participants(self):
        """Leader+ only - if any signed-in student could mint one, the Firebase rules
        this exists to enable would be no better than allowing every write."""
        with as_user("ada.lovelace@brown.edu"):
            r = get("/leader/firebase-token")
        self.assertEqual(r.status_code, 401)

    def test_92_firebase_token_for_leader(self):
        """200 with a token where a key is installed, 503 where it isn't. Never a 500:
        a missing key must not look like a broken server."""
        r = get("/leader/firebase-token")
        self.assertIn(r.status_code, (200, 503))
        if r.status_code == 200:
            self.assertIsInstance(r.json()["token"], str)
            self.assertGreater(len(r.json()["token"]), 0)
        else:
            self.assertIn("errMessage", r.json())

    # =========================================================================
    # /public/leader-stats + the status field on /public/leader-trips
    # =========================================================================
    # These two back the leader profile page, which shows Current Trips (Open/Pre-Trip),
    # Past Trips (Post-Trip/Complete) and a "Trips Led" badge. The badge used to count
    # every tripRole=Leader signup row, so trips that had only been planned inflated it.
    # The badge is now defined to equal the number of rows in Past Trips, and test_93
    # asserts exactly that.
    #
    # Note on coverage: trip 9 is the seed's Post-Trip trip, but test_35 takes attendance
    # on it, so by the time these run it is Complete. The Post-Trip arm of the filter is
    # therefore not exercised by live data here - test_93 asserts the invariant instead,
    # so it covers Post-Trip automatically whenever such a row exists.

    LED_PAST = ("Post-Trip", "Complete")
    LED_CURRENT = ("Open", "Pre-Trip")

    def test_93_badge_equals_past_trips_row_count(self):
        """The contract tying the two routes together: the badge is exactly the number of
        rows the Past Trips table renders."""
        trips = get("/public/leader-trips/William/Stone").json()
        past = [t for t in trips if t["status"] in self.LED_PAST]
        badge = get("/public/leader-stats/William/Stone").json()["totalTrips"]
        self.assertEqual(badge, len(past))

    def test_94_badge_ignores_trips_not_yet_run(self):
        """Staging, Open and Pre-Trip trips are led but haven't happened, so none of them
        count. Creating a trip proves the Staging case directly."""
        path = "/public/leader-stats/William/Stone"
        before = get(path).json()["totalTrips"]

        created = post("/leader/create-trip", {
            "leaders": [],
            "tripName": "Leader Stats Planning Trip",
            "category": "Hiking",
            "plannedDate": "2026-12-09",
            "plannedEndDate": None,
            "maxSize": 10,
            "class": "B",
            "priceOverride": None,
            "sentenceDesc": "Staging trip that must not count toward the badge",
            "blurb": None,
            "image": None,
        })
        self.assertEqual(created.status_code, 200)
        self.assertEqual(get(path).json()["totalTrips"], before)

        trips = get("/public/leader-trips/William/Stone").json()
        not_run = [t for t in trips if t["status"] not in self.LED_PAST]
        self.assertTrue(any(t["status"] == "Staging" for t in not_run))
        self.assertEqual(get(path).json()["totalTrips"], len(trips) - len(not_run))

    def test_95_leader_trips_carries_status_and_legacy_fields(self):
        """status is additive. The frontend deploys separately from this server, so the
        fields the released page already reads must keep coming back untouched."""
        trips = get("/public/leader-trips/William/Stone").json()
        self.assertGreater(len(trips), 0)
        for t in trips:
            self.assertIn(t["status"], self.LED_PAST + self.LED_CURRENT + ("Staging",))
            for field in ("tripId", "tripName", "date", "sentenceDesc", "lotteryInfo"):
                self.assertIn(field, t)
            self.assertEqual(t["lotteryInfo"], "Hosted Trip")

    def test_96_badge_counts_led_trips_only_not_participation(self):
        """It is "Trips Led" now. A user who only ever joined trips scores 0.
        Alan Wang is the subject because test_35 takes attendance on his trip 9
        signup, so his tripsParticipated is real by the time this runs, and he
        leads nothing. Ada Lovelace only participates in the Playwright walk."""
        with as_user("alan_wang2@brown.edu"):
            profile = get("/user/profile").json()
        self.assertGreaterEqual(profile["tripsParticipated"], 1)
        r = get(f"/public/leader-stats/{profile['firstName']}/{profile['lastName']}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["totalTrips"], 0)

    def test_97_leader_routes_are_public(self):
        """Logged-out visitors are exactly who the profile pages are for."""
        with as_user(None):
            stats = get("/public/leader-stats/William/Stone")
            trips = get("/public/leader-trips/William/Stone")
        self.assertEqual(stats.status_code, 200)
        self.assertEqual(trips.status_code, 200)
        self.assertIsInstance(stats.json()["totalTrips"], int)

    def test_98_leader_stats_unknown_name_is_zero(self):
        """An unmatched name is 0, not a 404 or a 500 - the page renders a badge either
        way, and Firestore names don't always match a User row."""
        r = get("/public/leader-stats/Nobody/Atall")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["totalTrips"], 0)

    # =========================================================================
    # Payment reminders (server_jobs.remindPayments, replayed on chosen dates)
    #
    # Trip 13 ran on 2026-04-20 and took attendance: Ada and Grace attended and owe $15,
    # Turing attended and paid, Johnson no-showed. Only the first two should ever hear.
    # =========================================================================

    UNPAID = ["ada.lovelace@brown.edu", "grace.hopper@brown.edu"]

    def _remind_as_of(self, date):
        subprocess.run(["node", "test-helpers/remind-payments.mjs", date], check=True, capture_output=True)

    def test_99a_daily_reminder_goes_to_unpaid_attendees_only(self):
        self._remind_as_of("2026-04-23") #Day 3
        messages = sent_mail(SUBJ_PAYMENT_DUE + "Unpaid Test Trip")
        self.assertEqual(len(messages), 1)
        m = messages[0]
        self.assertEqual(sorted(m["bcc"]), self.UNPAID)
        self.assertEqual(m["cc"], []) #Leaders are not copied on the daily nag...
        self.assertEqual(m["replyTo"], "william_l_stone@brown.edu") #...but replies reach them
        self.assertIn("Outing Club-Class C Trip", m["text"])
        self.assertIn("$15", m["text"])
        self.assertIn("/trips/view?id=13", m["text"])
        self.assertNotIn("*", m["html"])
        self.assertNotIn("](", m["html"])

    def test_99b_day_seven_sends_the_final_notice_and_hands_off_to_leaders(self):
        self._remind_as_of("2026-04-27") #Day 7
        self.assertEqual(len(sent_mail(SUBJ_PAYMENT_DUE + "Unpaid Test Trip")), 1) #Unchanged
        final = sent_mail(SUBJ_PAYMENT_OVERDUE + "Unpaid Test Trip")
        self.assertEqual(len(final), 1)
        self.assertEqual(sorted(final[0]["bcc"]), self.UNPAID)
        handoff = sent_mail(SUBJ_UNPAID_HANDOFF + "Unpaid Test Trip")
        self.assertEqual(len(handoff), 1)
        h = handoff[0]
        self.assertEqual(h["to"], ["william_l_stone@brown.edu"])
        self.assertEqual(h["bcc"], [])
        self.assertIn("Ada Lovelace - ada.lovelace@brown.edu", h["text"])
        self.assertIn("Grace Hopper - grace.hopper@brown.edu", h["text"])
        self.assertNotIn("Turing", h["text"])   #Paid
        self.assertNotIn("Johnson", h["text"])  #No show
        self.assertNotIn("](", h["html"])

    def test_99c_nothing_after_day_seven_and_nothing_for_free_trips(self):
        before = len(all_sent_mail())
        self._remind_as_of("2026-04-28") #Day 8
        self._remind_as_of("2026-05-02") #Day after trip 9 (free, class Z) ran
        self.assertEqual(len(all_sent_mail()), before)

if __name__ == "__main__":
    unittest.main(verbosity=2)
