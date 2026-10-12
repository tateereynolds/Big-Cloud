import csv
import io
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from app import DEFAULTS, create_app


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name) / "test.sqlite3")
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.id = str(uuid4())
        self.data = dict(started_at="2026-10-09T15:00:00+00:00", local_day="2026-10-09",
                         subject="Biology", intention="Recall muscle groups", duration=60,
                         focused=35, distracted=10, unknown=15, manual=20, status="active")

    def tearDown(self):
        self.temp.cleanup()

    def put(self, **changes):
        return self.client.put(f"/api/sessions/{self.id}", json=self.data | changes)

    def test_save_retry_is_idempotent_and_completed_cannot_reopen(self):
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(len(self.client.get("/api/sessions").json), 1)
        self.assertEqual(self.put(status="completed").status_code, 200)
        self.assertEqual(self.put().status_code, 409)

    def test_stale_snapshots_do_not_erase_time(self):
        self.put()
        self.assertEqual(self.put(duration=30, focused=5).status_code, 409)
        self.assertEqual(self.client.get("/api/sessions").json[0]["duration"], 60)

    def test_breaks_cannot_be_smuggled_in_as_focus_totals(self):
        self.assertEqual(self.put(focused=55).status_code, 400)
        self.assertEqual(self.put(manual=61).status_code, 400)
        self.assertEqual(self.put(duration=float("nan")).status_code, 400)
        self.assertEqual(self.put(duration=True).status_code, 400)

    def test_settings_reject_invalid_values_and_persist(self):
        self.assertEqual(self.client.get("/api/settings").json["shortBreak"], 15)
        self.assertEqual(self.client.put("/api/settings", json=DEFAULTS | {"study": 0}).status_code, 400)
        self.assertEqual(self.client.put("/api/settings", json=DEFAULTS | {"study": 1.5}).status_code, 400)
        self.assertEqual(self.client.put("/api/settings", json=DEFAULTS | {"longBreak": 60}).status_code, 200)
        self.assertEqual(self.client.get("/api/settings").json["longBreak"], 60)

    def test_local_dates_and_export_with_formula_escape(self):
        self.put(subject="=HYPERLINK(\"bad\")")
        self.assertEqual(len(self.client.get("/api/sessions?day=2026-10-09").json), 1)
        self.assertEqual(self.client.get("/api/sessions?day=2026-10-10").json, [])
        response = self.client.get("/api/export")
        rows = list(csv.reader(io.StringIO(response.text)))
        self.assertTrue(rows[1][2].startswith("'="))
        self.assertEqual(rows[1][4], "1.0")

    def test_cross_site_writes_and_remote_hosts_are_rejected(self):
        self.assertEqual(self.client.put(f"/api/sessions/{self.id}", json=self.data,
                         headers={"Origin": "https://example.com"}).status_code, 403)
        self.assertEqual(self.client.get("/api/sessions", headers={"Host": "example.com"}).status_code, 403)
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_invalid_input_does_not_crash(self):
        self.assertEqual(self.client.put(f"/api/sessions/{self.id}", json=[]).status_code, 400)
        self.assertEqual(self.client.put("/api/sessions/not-an-id", json=self.data).status_code, 400)
        self.assertEqual(self.client.get("/api/sessions?day=bad").status_code, 400)

    def test_health_and_task_progress_controls_are_available(self):
        self.assertEqual(self.client.get("/api/health").json, {"app": "focus-studio", "status": "ok"})
        page = self.client.get("/").text
        self.assertIn('id="taskSuggestions"', page)
        self.assertIn('id="taskProgress"', page)
        self.assertIn('<option value="7">7 days</option>', page)
        self.assertIn('<option value="30">30 days</option>', page)


if __name__ == "__main__":
    unittest.main()
