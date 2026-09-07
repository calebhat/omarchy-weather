#!/usr/bin/env python3
"""Contracts for the Service.qml wiring that pure tests cannot reach.

RadarModel.js decides; Service.qml plumbs. The decisions are pinned by
test/nws.test.js against fixtures, but the plumbing around them has its own
failure modes — a response applied to the wrong place, a clock refreshed on a
cycle that learned nothing, a process that cannot tell a failure from a fork
that never ran. Each assertion here stands for a bug that was actually present.
"""
from pathlib import Path
import re
import unittest


PLUGIN = Path(__file__).parents[1]
SERVICE = (PLUGIN / "Service.qml").read_text(encoding="utf-8")
RADAR_MODEL = (PLUGIN / "RadarModel.js").read_text(encoding="utf-8")

NWS_PROCESSES = ("nwsPointsProc", "nwsAlertsProc", "nwsHourlyProc")
NWS_FINISHERS = ("finishPoints", "finishAlerts", "finishHourly")


def code_only(source: str) -> str:
    """Source with // comments stripped.

    Assertions about what the code does must not be satisfied — or broken — by
    prose. A comment explaining why a URL is not built here contains the URL.
    """
    return "\n".join(re.sub(r"//.*$", "", line) for line in source.splitlines())


def body_of(source: str, name: str) -> str:
    match = re.search(rf"function {name}\(.*?\) \{{(?P<body>.*?)\n  \}}", source, re.DOTALL)
    assert match is not None, f"{name} not found"
    return match.group("body")


class StalenessTests(unittest.TestCase):
    """A stale opinion must not be able to pass as a current one.

    finishAlerts and finishHourly keep the previous figures when a request
    fails, on purpose. Stamping the clock regardless marked those figures fresh,
    so a service that lost api.weather.gov would go on presenting an old "no
    rain expected" forever — and the 45-minute bound would never be reached.
    That direction ends in silence, which is the one failure this must not have.
    """

    def test_the_clock_is_only_refreshed_by_a_cycle_that_learned_something(self):
        body = body_of(SERVICE, "nwsAnswered")
        stamp = re.search(r"if \((?P<cond>[^)]*)\) nwsStamp = Date\.now\(\)", body)
        self.assertIsNotNone(stamp, "nwsStamp must be set behind a condition")
        assert stamp is not None
        self.assertIn("nwsCycleAnswered", stamp.group("cond"))

    def test_only_a_response_carrying_data_counts_as_an_answer(self):
        for name in ("finishAlerts", "finishHourly"):
            with self.subTest(name):
                body = body_of(SERVICE, name)
                self.assertIn("nwsCycleAnswered = true", body)
                # Inside the `if (data)` arm, not beside it.
                arm = re.search(r"if \(data\) \{(?P<arm>.*?)\n    \}", body, re.DOTALL)
                self.assertIsNotNone(arm, f"{name} must guard on data")
                assert arm is not None
                self.assertIn("nwsCycleAnswered = true", arm.group("arm"))

    def test_a_new_cycle_starts_without_last_cycle_s_answer(self):
        self.assertIn("nwsCycleAnswered = false", body_of(SERVICE, "refreshNws"))

    def test_freshness_is_bounded_by_time_and_by_place(self):
        body = body_of(SERVICE, "nwsSnapshot")
        self.assertIn("NWS_MAX_AGE_MS", body)
        self.assertIn("nwsPlaceKey === latchPlaceKey", body)
        # A stamp in the future is a clock that moved, not data from later.
        self.assertIn(">= 0", body)


class WrongPlaceTests(unittest.TestCase):
    """A response is only an answer to the question that was asked.

    Coordinates can move while curl is running. A points lookup that landed
    after a move installed the old city's gridpoint URL, and every later reading
    corroborated the new place against the wrong forecast office.
    """

    def test_every_finisher_discards_an_answer_about_somewhere_else(self):
        for name, stamp in zip(NWS_FINISHERS, ("nwsPointsFor", "nwsRequestedFor", "nwsRequestedFor")):
            with self.subTest(name):
                body = body_of(SERVICE, name)
                self.assertRegex(body, rf"if \({stamp} !== latchPlaceKey\)")

    def test_a_discarded_answer_still_settles_the_count(self):
        # Returning without nwsAnswered() would strand nwsOutstanding above
        # zero and hold every later verdict until the timeout.
        for name in NWS_FINISHERS:
            with self.subTest(name):
                guard = re.search(
                    r"if \(nws\w+For !== latchPlaceKey\) \{(?P<arm>.*?)\n    \}",
                    body_of(SERVICE, name), re.DOTALL)
                self.assertIsNotNone(guard)
                assert guard is not None
                self.assertIn("nwsAnswered()", guard.group("arm"))

    def test_each_request_records_the_place_it_was_made_for(self):
        body = body_of(SERVICE, "refreshNws")
        self.assertIn("nwsPointsFor = latchPlaceKey", body)
        self.assertIn("nwsRequestedFor = latchPlaceKey", body)

    def test_a_move_forgets_the_questions_still_in_flight(self):
        body = body_of(SERVICE, "forgetNws")
        for prop in ("nwsPointsFor", "nwsRequestedFor", "nwsCycleAnswered", "nwsStamp", "nwsPop"):
            self.assertIn(prop, body)


class ProcessTests(unittest.TestCase):
    """A fork that never happened goes from running to not running in silence."""

    def test_every_request_can_tell_a_failure_from_a_fork_that_never_ran(self):
        for name in NWS_PROCESSES:
            with self.subTest(name):
                block = re.search(rf"Process \{{\s*\n\s*id: {name}(?P<body>.*?)\n  \}}",
                                  SERVICE, re.DOTALL)
                self.assertIsNotNone(block, name)
                assert block is not None
                body = block.group("body")
                self.assertIn("property bool answered", body)
                self.assertIn("onExited", body)
                self.assertIn("onRunningChanged", body)
                self.assertIn("if (running || answered) return", body)

    def test_the_answered_flag_is_armed_at_the_call_site_not_in_the_handler(self):
        # Clearing it inside the finisher lets the `running` drop that follows
        # an ordinary exit look like a second, empty answer.
        for name in NWS_FINISHERS:
            with self.subTest(name):
                self.assertNotIn("answered = false", body_of(SERVICE, name))
        for name in NWS_PROCESSES:
            with self.subTest(name):
                self.assertIn(f"{name}.answered = false", body_of(SERVICE, "refreshNws"))

    def test_no_nws_request_is_built_outside_the_library_that_bounds_it(self):
        # nwsCurlGet is what carries the timeout, the byte ceiling and the
        # User-Agent the service requires.
        for call in re.findall(r"nws\w*Proc\.command = (\w+(?:\.\w+)*)", SERVICE):
            self.assertEqual(call, "RadarModel.nwsCurlGet")
        self.assertIn("api.weather.gov", RADAR_MODEL)
        self.assertNotIn("api.weather.gov", code_only(SERVICE),
                         "Service.qml must not build NWS URLs itself")


class FailOpenTests(unittest.TestCase):
    """An absent second source declines to help. It never mutes."""

    def test_the_wait_for_the_office_is_bounded(self):
        timer = re.search(r"Timer \{\s*\n\s*id: nwsWaitTimer(?P<body>.*?)\n  \}",
                          SERVICE, re.DOTALL)
        self.assertIsNotNone(timer, "the wait must have a deadline")
        assert timer is not None
        body = timer.group("body")
        self.assertRegex(body, r"interval: \d+")
        self.assertIn("settleOutlook(true)", body)

    def test_the_gate_is_the_only_thing_that_lowers_a_reading(self):
        body = body_of(SERVICE, "settleOutlook")
        self.assertIn("RadarModel.corroborate(modelLevel, nwsSnapshot())", body)
        self.assertIn("outlookLevel = verdict.level", body)
        # No second, ad-hoc suppression path beside the pure one.
        self.assertNotRegex(body, r"outlookLevel = 0")

    def test_the_expired_wait_settles_instead_of_returning(self):
        body = body_of(SERVICE, "settleOutlook")
        for guard in re.findall(r"if \((?P<cond>[^)]*)\) \{[^}]*return", body):
            self.assertIn("!expired", guard, "every hold must yield to the deadline")


class LatchTests(unittest.TestCase):
    """The persisted latch, which is what stopped the duplicates."""

    def test_no_verdict_is_reached_before_the_latch_is_known(self):
        body = body_of(SERVICE, "evaluateAlert")
        self.assertIn("if (!latchLoaded)", body)
        self.assertIn("latchEvaluatePending = true", body)

    def test_every_deliberate_clear_is_written_down(self):
        # A clear kept only in memory comes back on the next rebuild.
        clears = SERVICE.count("notifiedLevel = 0")
        stores = SERVICE.count("storeLatch(0)")
        self.assertGreaterEqual(stores, clears - 1,
                                "a reset that is not stored will be adopted back")

    def test_a_level_off_disk_is_range_checked(self):
        """The latch file is untrusted input — anything can write it.

        A level above the top band would sit in the latch over every real
        reading and silence the plugin. It is rejected rather than clamped down,
        so an unusable record means "nothing announced" — one possible duplicate
        instead of an indefinite silence.
        """
        body = body_of(SERVICE, "adoptLatch")
        self.assertRegex(body, r"level <= 0 \|\| level > 4")
        self.assertIn("isFinite(level)", body)

    def test_adoption_only_ever_raises_the_latch(self):
        body = body_of(SERVICE, "adoptLatch")
        self.assertIn("if (level > notifiedLevel)", body)


if __name__ == "__main__":
    unittest.main()


class PromiseTests(unittest.TestCase):
    """Claims the README makes to the user, checked against the code.

    A README is the only place most people will look to find out what a plugin
    on their machine talks to. These keep the answer true.
    """

    def test_the_second_source_is_never_contacted_with_alerts_off(self):
        # README: "With storm alerts off — the default — api.weather.gov is
        # never contacted." Enforced where the requests are built, not left to
        # every caller to remember.
        body = body_of(SERVICE, "refreshNws")
        first = body.strip().splitlines()
        guards = [line for line in first if line.strip().startswith("if (")][:2]
        self.assertTrue(any("!alertsEnabled" in g for g in guards),
                        "refreshNws must refuse before it reaches the network")

    def test_alerts_are_off_by_default(self):
        import json
        manifest = json.loads((PLUGIN / "manifest.json").read_text(encoding="utf-8"))
        defaults = manifest["barWidget"]["defaults"]
        self.assertIs(defaults["alertsEnabled"], False)

    def test_the_documented_thresholds_are_the_ones_in_the_code(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        confirm = re.search(r"NWS_POP_CONFIRM = (\d+)", RADAR_MODEL)
        partial = re.search(r"NWS_POP_PARTIAL = (\d+)", RADAR_MODEL)
        self.assertIsNotNone(confirm)
        self.assertIsNotNone(partial)
        assert confirm is not None and partial is not None
        # "Rain is likely (>=50%)" / "possible (30-49%)" / "unlikely (<30%)"
        self.assertIn(f"≥{confirm.group(1)}%", readme)
        self.assertIn(f"{partial.group(1)}–{int(confirm.group(1)) - 1}%", readme)
        self.assertIn(f"<{partial.group(1)}%", readme)

    def test_the_documented_staleness_bound_is_the_one_in_the_code(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        minutes = re.search(r"NWS_MAX_AGE_MS = (\d+) \* 60 \* 1000", RADAR_MODEL)
        self.assertIsNotNone(minutes)
        assert minutes is not None
        self.assertIn(f"last {minutes.group(1)} minutes", readme)

    # Hosts the plugin can reach, and the name the README documents each under.
    # The README names services the way a reader would recognise them, so the
    # mapping is explicit rather than guessed from the hostname.
    DOCUMENTED_AS = {
        "api.open-meteo.com": "Open-Meteo",
        "air-quality-api.open-meteo.com": "Open-Meteo",
        "geocoding-api.open-meteo.com": "Open-Meteo",
        "api.weather.gov": "api.weather.gov",
        "wttr.in": "wttr.in",
        "www.rainviewer.com": "RainViewer",
        "radar.weather.gov": "NOAA",
        "www.windy.com": "Windy",
        "www.wunderground.com": "Weather Underground",
        # Not contacted: this appears only inside the User-Agent string the NWS
        # requires, as the contact address for whoever runs the plugin.
        "github.com": None,
    }

    def test_every_host_the_plugin_can_reach_is_documented(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        sources = "\n".join((PLUGIN / f).read_text(encoding="utf-8")
                            for f in ("Service.qml", "Panel.qml", "Model.js", "RadarModel.js"))
        hosts = set(re.findall(r"https://([a-z0-9.\-]+)", sources))

        undeclared = hosts - set(self.DOCUMENTED_AS)
        self.assertEqual(undeclared, set(),
                         "a new host was added without deciding how to document it")

        for host in sorted(hosts):
            alias = self.DOCUMENTED_AS[host]
            if alias is None:
                continue
            with self.subTest(host=host):
                self.assertIn(alias, readme, f"{host} is reachable but undocumented")
