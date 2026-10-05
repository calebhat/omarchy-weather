#!/usr/bin/env python3
"""tz-transitions.json must match the system tz database it was built from, and
must be regenerated before it expires."""

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
import unittest


PLUGIN = Path(__file__).parents[1]
SCRIPT = PLUGIN / "scripts" / "build-tz-transitions.py"
TABLE = PLUGIN / "tz-transitions.json"


def load_generator():
    spec = importlib.util.spec_from_file_location("build_tz", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def have_tzdata():
    try:
        import zoneinfo
        zoneinfo.ZoneInfo("America/New_York")
        return True
    except Exception:
        return False


class TzTableTests(unittest.TestCase):
    def test_the_window_is_relative_to_the_current_year(self):
        build = load_generator()
        self.assertEqual(build.default_window(2026), (2025, 2032))
        self.assertEqual(build.default_window(2031), (2030, 2037))

    def test_committed_table_matches_the_tz_database_for_its_own_years(self):
        if not have_tzdata():
            self.skipTest("no tz database on this machine")
        result = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_committed_table_is_not_within_a_year_of_expiring(self):
        body = json.loads(TABLE.read_text(encoding="utf-8"))
        ends = datetime(body["to"] + 1, 1, 1, tzinfo=timezone.utc)
        remaining = (ends - datetime.now(timezone.utc)).days
        self.assertGreater(remaining, 365, "tz-transitions.json is due to expire; run scripts/build-tz-transitions.py")

    def test_committed_table_covers_the_present(self):
        body = json.loads(TABLE.read_text(encoding="utf-8"))
        self.assertLessEqual(body["from"], datetime.now(timezone.utc).year)


if __name__ == "__main__":
    unittest.main()
