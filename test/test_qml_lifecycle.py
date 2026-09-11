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


PLUGIN = Path(__file__).parents[1]
PANEL = (PLUGIN / "Panel.qml").read_text(encoding="utf-8")
QML = {p.name: p.read_text(encoding="utf-8") for p in PLUGIN.glob("*.qml")}

# Qt.callLater(someFunction) — a bare reference rather than a closure or an
# owned Timer. This is the shape that keeps evaluating into a context the shell
# is tearing down.
BARE_DEFERRAL = re.compile(r"Qt\.callLater\(\s*(?:root\.)?[A-Za-z_][\w.]*\s*\)")


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

    def test_nothing_in_the_plugin_defers_a_bare_function_reference(self):
        """Every deferral is a guarded closure or a Timer this object owns.

        A Timer is a child of the object, so it is destroyed with it; a bare
        reference handed to Qt.callLater is not, and outlives it. Where the
        deferral also needs coalescing — settings settling, a unit flip, a
        geocode chasing the query — the Timer is the only option that keeps
        both, since a fresh closure per call has no identity to collapse on.
        """
        offenders = {
            name: BARE_DEFERRAL.findall(text)
            for name, text in QML.items() if BARE_DEFERRAL.search(text)
        }
        self.assertEqual(offenders, {})

    def test_the_coalescing_deferrals_are_owned_timers(self):
        for timer in ("alertConfigTimer", "tempUnitTimer", "geocodeChaseTimer"):
            with self.subTest(timer):
                source = "\n".join(QML.values())
                self.assertRegex(source, rf"Timer \{{\s*\n\s*id: {timer}")
                self.assertIn(f"{timer}.restart()", source)


class BarFacadeWriteTests(unittest.TestCase):
    """close() must survive the read-only PluginBarApi mirror.

    An installed plugin is handed PluginBarApi, where centerHoverRevealSuppressed
    is a readonly mirror of the host Bar. Assigning it raises a TypeError, and
    close() calls the helper on its first line, so the throw aborted close()
    before controller.hide() -- the panel stayed up and kept the keyboard.
    """

    HELPER = re.search(
        r"function setCenterHoverRevealSuppressed\(value\) \{(?P<body>.*?)\n  \}",
        PANEL,
        re.DOTALL,
    )

    def test_the_helper_exists(self):
        self.assertIsNotNone(self.HELPER)

    def test_the_delegated_setter_is_tried_first(self):
        body = self.HELPER.group("body")
        self.assertIn('typeof root.bar.setCenterHoverRevealSuppressed === "function"', body)
        self.assertLess(
            body.index("root.bar.setCenterHoverRevealSuppressed(value)"),
            body.index("root.bar.centerHoverRevealSuppressed = value"),
            "the delegated setter must be attempted before the direct assignment",
        )

    def test_a_throw_cannot_abort_close(self):
        self.assertIn("try {", self.HELPER.group("body"))
        self.assertIn("catch", self.HELPER.group("body"))


if __name__ == "__main__":
    unittest.main()
