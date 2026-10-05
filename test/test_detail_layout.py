#!/usr/bin/env python3
"""Static contracts that keep the detail cards from overlapping or clipping.

Nothing here can measure pixels, so each contract pins the structural reason a
value cannot overlap its label: it either fits beside the label or moves to its
own full-width line, and every other line is given the room it needs."""

from pathlib import Path
import unittest


PLUGIN = Path(__file__).parents[1]
ROWS = (PLUGIN / "DetailRows.qml").read_text(encoding="utf-8")
DAY = (PLUGIN / "DayDetail.qml").read_text(encoding="utf-8")


def block(source, start, end):
    return source.split(start, 1)[1].split(end, 1)[0]


class DetailLayoutTests(unittest.TestCase):
    def test_rows_are_full_width_lines_not_a_squeezed_grid(self):
        self.assertNotIn("Grid {", ROWS)
        self.assertNotIn("columns: 2", ROWS)

    def test_a_value_that_does_not_fit_beside_its_label_gets_its_own_line(self):
        for contract in (
            "readonly property bool stacked:",
            "measure.implicitWidth >",
            "visible: !entry.stacked",
            "visible: entry.stacked",
            "Flow {",
        ):
            self.assertIn(contract, ROWS)

    def test_the_row_height_follows_whichever_layout_is_used(self):
        self.assertIn("implicitHeight: stacked", ROWS)

    def test_no_value_is_elided(self):
        self.assertNotIn("elide", ROWS)

    def test_moon_phase_line_wraps_beside_the_glyph(self):
        phase = block(DAY, "root.card.moon.phase", "}\n")
        self.assertIn("wrapMode: Text.WordWrap", DAY.split("root.card.moon.phase")[0].split("Text {")[-1] + phase)
        self.assertIn("moonGlyphText.width", DAY)

    def test_tide_columns_fill_the_row_exactly(self):
        table = block(DAY, "id: tideTable", "wrapMode: Text.WordWrap")
        self.assertIn("parent.width * 0.3", table)
        self.assertEqual(table.count("parent.width * 0.35 - parent.spacing"), 2)
        self.assertNotIn("elide", table)


if __name__ == "__main__":
    unittest.main()
