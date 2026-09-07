#!/usr/bin/env python3
"""Static lifecycle regressions for delayed QML callbacks.

Any plugin writing inside its own directory makes the shell rebuild every
plugin, so a hot reload can land between a Qt.callLater and the call it queued.
A direct function reference goes on evaluating into the half-destroyed context
instead of failing quietly, which the journal records as:

    QQmlVMEMetaObject: Internal error - attempted to evaluate a function in an
    invalid context
"""
from pathlib import Path
import re
import unittest


PANEL = (Path(__file__).parents[1] / "Panel.qml").read_text(encoding="utf-8")


class PanelLifecycleTests(unittest.TestCase):
    def test_no_refresh_is_deferred_by_bare_reference(self):
        self.assertNotRegex(PANEL, r"Qt\.callLater\(\s*(?:root\.)?refresh\s*\)")

    def test_no_refresh_is_deferred_by_unguarded_closure(self):
        self.assertNotRegex(PANEL, r"Qt\.callLater\(function\(\)\s*\{\s*root\.refresh\(")

    def test_the_guard_probes_both_methods_at_execution_time(self):
        scheduler = re.search(
            r"function scheduleRefresh\(reason\) \{(?P<body>.*?)\n  \}", PANEL, re.DOTALL
        )
        self.assertIsNotNone(scheduler, "scheduleRefresh(reason) must exist")
        assert scheduler is not None
        body = scheduler.group("body")
        # The probe has to sit inside the deferred closure, not beside it.
        self.assertRegex(body, r"Qt\.callLater\(function\(\)")
        self.assertIn("root.refresh", body)
        self.assertIn("root.refreshDailyForecast", body)
        self.assertRegex(body, r"return\b")

    def test_the_guard_forwards_the_transition_reason(self):
        # A caller that already started its own transition passes false; losing
        # that would double-animate every location change.
        self.assertIn("root.refresh(reason)", PANEL)
        self.assertGreaterEqual(PANEL.count("scheduleRefresh(false)"), 2)

    def test_every_deferred_refresh_goes_through_the_guard(self):
        self.assertGreaterEqual(PANEL.count("scheduleRefresh"), 4)


if __name__ == "__main__":
    unittest.main()
