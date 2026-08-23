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

import requests
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


class ServerTests(unittest.TestCase):

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
        """Take attendance on trip 9 (Post-Trip, past date). User 2 attended.
        Trip 9 becomes Complete after this test."""
        r = post("/trip/9/lead/attendance", {
            "selectedParticipants": {"alan_wang2@brown.edu": "Attended"},
            "additionalParticipants": [],
        })
        self.assertEqual(r.status_code, 200)
        trip = get("/trip/9").json()
        self.assertEqual(trip["status"], "Complete")

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
    # /trip/<tripId>/participate/confirm + pay + cancel
    # Run in order on trip 3, where User 1 is a Participant in default_insts.
    # =========================================================================

    def test_38_participate_confirm_success(self):
        r = post("/trip/3/participate/confirm")
        self.assertEqual(r.status_code, 200)
        signups = get("/user/profile").json()["TripSignUps"]
        trip3 = next((s for s in signups if s["tripId"] == 3), None)
        self.assertIsNotNone(trip3)
        self.assertTrue(trip3["confirmed"])

    def test_39_participate_pay_success(self):
        r = post("/trip/3/participate/pay")
        self.assertEqual(r.status_code, 200)
        signups = get("/user/profile").json()["TripSignUps"]
        trip3 = next((s for s in signups if s["tripId"] == 3), None)
        self.assertTrue(trip3["paid"])

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
