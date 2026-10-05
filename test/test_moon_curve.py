#!/usr/bin/env python3
"""The moon-illumination curve behind the ten-day strip was removed (Tim's
decision). These keep it gone and the strip as it was, with its phase glyphs."""

from pathlib import Path
import unittest


PLUGIN = Path(__file__).parents[1]
PANEL = (PLUGIN / "Panel.qml").read_text(encoding="utf-8")
MOON = (PLUGIN / "Moon.js").read_text(encoding="utf-8")
README = (PLUGIN / "README.md").read_text(encoding="utf-8")


def strip():
    return PANEL.split("id: forecastStrip", 1)[1].split("// ---- HOURLY", 1)[0]


class NoMoonCurveTests(unittest.TestCase):
    def test_no_curve_canvas_or_series_in_the_panel(self):
        for gone in ("moonCurve", "moonSeries", "moonStripRow", "illuminationSeries", "curvePoints", "curveSegments"):
            self.assertNotIn(gone, PANEL)

    def test_the_pure_curve_functions_are_gone_from_moon_js(self):
        for gone in ("illuminationSeries", "curvePoints", "curveSegments", "appendRun", "moon curve"):
            self.assertNotIn(gone, MOON)

    def test_the_strip_is_its_plain_row_of_cells_again(self):
        body = strip()
        self.assertNotIn("Canvas", body)
        row = body.split("RowLayout {", 1)[1]
        self.assertTrue(row.lstrip().startswith("width: parent.width\n              spacing: Style.space(6)\n\n              Repeater {"))
        self.assertEqual(body.count("RowLayout {"), 1)
        # No wrapper Item was left behind between the header and the row.
        header_to_row = body.split("PanelSectionHeader {", 1)[1].split("RowLayout {", 1)[0]
        self.assertNotIn("Item {", header_to_row)

    def test_the_phase_glyphs_and_the_card_section_stay(self):
        self.assertIn("function moonGlyph(date)", PANEL)
        self.assertIn("root.moonGlyph(modelData.date)", PANEL)
        for kept in ("function dayInfo(", "function reportDay(", "function glyph(", "function phaseName("):
            self.assertIn(kept, MOON)

    def test_no_readme_mention(self):
        self.assertNotIn("moon curve", README.lower())
        self.assertNotIn("illumination curve", README.lower())


if __name__ == "__main__":
    unittest.main()
