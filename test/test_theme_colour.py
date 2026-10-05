#!/usr/bin/env python3
"""Static contracts for the theme colour wiring: colours come from the theme,
never from literals, and the colour choices stay in Palette.js."""

from pathlib import Path
import re
import unittest


PLUGIN = Path(__file__).parents[1]
PANEL = (PLUGIN / "Panel.qml").read_text(encoding="utf-8")
THEME = (PLUGIN / "ThemePalette.qml").read_text(encoding="utf-8")
ROWS = (PLUGIN / "DetailRows.qml").read_text(encoding="utf-8")
DAY = (PLUGIN / "DayDetail.qml").read_text(encoding="utf-8")
HOUR = (PLUGIN / "HourDetail.qml").read_text(encoding="utf-8")
PALETTE_JS = (PLUGIN / "Palette.js").read_text(encoding="utf-8")


class ThemeColourTests(unittest.TestCase):
    def test_palette_reads_the_themes_colors_file_and_follows_theme_changes(self):
        for contract in (
            'import "Palette.js" as Palette',
            'Color.currentThemePath + "/colors.toml"',
            "watchChanges: true",
            "onFileChanged: reload()",
            "Palette.parseColors(text())",
            "Palette.roles(",
            "target: Color",
            "function onAccentChanged()",
            "function onBackgroundChanged()",
            "function onForegroundChanged()",
        ):
            self.assertIn(contract, THEME)

    def test_palette_takes_the_shells_own_colours_for_the_basics(self):
        for contract in ("Color.foreground", "Color.background", "Color.accent", "Color.muted"):
            self.assertIn(contract, THEME)

    def test_contrast_is_judged_on_the_popup_surface_the_cards_are_drawn_on(self):
        for contract in ("Color.popups.background", "Color.popups.text", "p.surface =", "p.surfaceText ="):
            self.assertIn(contract, THEME)
        # Alpha is dropped so the surface is a plain #rrggbb the palette can use.
        self.assertIn("opaqueHex(", THEME)

    def test_panel_hands_it_the_tinted_accents_it_used_before(self):
        self.assertIn("ThemePalette {", PANEL)
        for code in ("weatherAccentForCode(0)", "weatherAccentForCode(61)", "weatherAccentForCode(71)",
                     "weatherAccentForCode(95)", "weatherAccentForCode(45)"):
            self.assertIn(code, PANEL)

    def test_no_colour_literal_in_the_new_or_changed_components(self):
        literal = re.compile(r'#[0-9a-fA-F]{6}\b|Qt\.rgba\(\s*[0-9.]|"(red|blue|green|yellow|orange|cyan|magenta)"')
        for name, source in (("ThemePalette", THEME), ("DetailRows", ROWS), ("DayDetail", DAY), ("HourDetail", HOUR)):
            body = "\n".join(line for line in source.splitlines() if not line.strip().startswith("//"))
            self.assertIsNone(literal.search(body), name)

    def test_icons_take_their_role_from_the_weather_code(self):
        self.assertEqual(PANEL.count("root.iconColor("), 3)
        self.assertIn("function iconColor(code, plain, night)", PANEL)
        self.assertIn("Palette.iconRole(", PANEL)
        self.assertIn("themePalette.roles[", PANEL)

    def test_rain_amounts_and_bars_use_the_rain_roles(self):
        self.assertGreaterEqual(PANEL.count("themePalette.roles.rainAmount"), 3)
        self.assertIn("themePalette.roles.rainBar", PANEL)
        self.assertIn("rainBarColor", DAY)

    def test_no_curve_canvas_is_left_to_colour_and_the_tide_roles_serve_the_card(self):
        for gone in ("moonCurve", "tideWaveCanvas", "highColor", "lowColor"):
            self.assertNotIn(gone, PANEL)
        # The tide highs and lows are still coloured in the day card, by tone.
        self.assertIn("tideHigh", (PLUGIN / "Tides.js").read_text(encoding="utf-8"))
        self.assertIn("tideLow", (PLUGIN / "Tides.js").read_text(encoding="utf-8"))
        self.assertIn("root.toneColor(modelData.tone)", DAY)

    def test_uv_bar_uses_the_band_colour(self):
        self.assertIn("themePalette.roles.uv[", PANEL)

    def test_card_rows_draw_their_segments_in_tone_colours(self):
        for contract in ("modelData.segments", "Palette.toneColor(", "roles"):
            self.assertIn(contract, ROWS)
        self.assertEqual(DAY.count("roles: root.roles"), 2)
        self.assertEqual(DAY.count("root.toneColor(modelData.tone)"), 2)
        self.assertEqual(HOUR.count("roles: root.roles"), 1)
        self.assertIn("roles: themePalette.roles", PANEL)

    def test_the_choices_live_in_the_pure_file(self):
        for name in ("yellow", "blue", "cyan", "magenta", "orange", "green", "red"):
            self.assertIn(name, PALETTE_JS)
        for source in (PANEL, ROWS, DAY, HOUR):
            self.assertNotIn('"yellow"', source)


if __name__ == "__main__":
    unittest.main()
