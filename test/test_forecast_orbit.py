#!/usr/bin/env python3
"""Static contracts for the interactive ten-day forecast orbit."""

import json
from pathlib import Path
import unittest


PLUGIN = Path(__file__).parents[1]
PANEL = (PLUGIN / "Panel.qml").read_text(encoding="utf-8")
BAR_WIDGET = (PLUGIN / "BarWidget.qml").read_text(encoding="utf-8")
LOADER = (PLUGIN / "MorphingWeatherLoader.qml").read_text(encoding="utf-8")
WAVE_WIPE = (PLUGIN / "WeatherWaveWipe.qml").read_text(encoding="utf-8")
ENERGY_CORE = (PLUGIN / "WeatherEnergyCore.qml").read_text(encoding="utf-8")
README = (PLUGIN / "README.md").read_text(encoding="utf-8")
MANIFEST = json.loads((PLUGIN / "manifest.json").read_text(encoding="utf-8"))


class ForecastOrbitTests(unittest.TestCase):
    def test_bar_shows_saved_home_temperature_in_fahrenheit_with_small_condition(self):
        for contract in (
            'property string homeTempF: ""',
            "readonly property string barTemperatureF: homeTempF",
            "readonly property string barConditionGlyph: homeLabel || label",
            "function rememberHomeCurrent(currentCondition, provisionalIcon)",
            "Model.roundedTemp(currentCondition.temp_F)",
        ):
            self.assertIn(contract, PANEL)

        for contract in (
            "WidgetButton {",
            'panelLoader.item.barTemperatureF + "°F"',
            "font.pixelSize: Style.font.bodySmall",
            "text: panelLoader.item ? panelLoader.item.barConditionGlyph",
            "font.pixelSize: Style.font.caption",
        ):
            self.assertIn(contract, BAR_WIDGET)

        self.assertIn("bar temperature is always Fahrenheit", README)
        self.assertEqual(MANIFEST["version"], "1.3.1")

    def test_hot_reload_bar_teardown_has_fallback(self):
        for contract in (
            "id: fallbackBar",
            "property color foreground: Color.foreground",
            "property color barForeground: Color.foreground",
            "property color urgent: Color.urgent",
            "property string fontFamily: Style.font.family",
            "onBarChanged: if (!bar) bar = fallbackBar",
        ):
            self.assertIn(contract, PANEL)

    def test_direct_manipulation_and_snap_are_present(self):
        for contract in (
            "function carouselCardAt(",
            "function settleCarousel(",
            "function stepCarousel(",
            "onPositionChanged: function(mouse)",
            "onWheel: function(wheel)",
            'easing.type: Easing.OutBack',
        ):
            self.assertIn(contract, PANEL)

    def test_orbit_uses_the_full_ten_day_model(self):
        self.assertIn(
            "Model.dailyForecast(dailyForecastReport, "
            'Qt.formatDate(new Date(), "yyyy-MM-dd"), 10)',
            PANEL,
        )
        self.assertIn("model: root.daily", PANEL)

    def test_auto_spin_setting_is_wired_and_documented(self):
        defaults = MANIFEST["barWidget"]["defaults"]
        schema = {
            entry["key"]: entry for entry in MANIFEST["barWidget"]["schema"]
        }
        self.assertIs(defaults["orbitAutoSpin"], True)
        self.assertEqual(schema["orbitAutoSpin"]["type"], "boolean")
        self.assertIn('setting("orbitAutoSpin", true)', PANEL)
        self.assertIn("orbitAutoSpin", README)

    def test_reactive_effects_remain_wired_to_weather_and_motion(self):
        for contract in (
            "function weatherAccentForCode(",
            "property real weatherAmbientPhase",
            "property real weatherWavePhase",
            "property real carouselLean",
            "function isStormCode(",
            "id: liquidCanvas",
            "angle: root.carouselLean",
            "root.carouselStorm",
        ):
            self.assertIn(contract, PANEL)

    def test_loading_state_uses_the_morphing_canvas(self):
        self.assertIn("MorphingWeatherLoader {", PANEL)
        self.assertIn("Canvas {", LOADER)
        self.assertIn("quadraticCurveTo", LOADER)
        self.assertIn("loops: Animation.Infinite", LOADER)

    def test_refresh_and_location_changes_use_the_wave_wipe(self):
        for contract in (
            "function beginWeatherTransition(",
            "function completeWeatherTransition(",
            "id: weatherWipeCover",
            "id: weatherWipeReveal",
            'beginWeatherTransition("location")',
            "WeatherWaveWipe {",
        ):
            self.assertIn(contract, PANEL)
        self.assertIn("ctx.bezierCurveTo(", WAVE_WIPE)
        self.assertIn("property real direction", WAVE_WIPE)
        self.assertIn("root.weatherWipeDirection = dx > 0 ? 1 : -1", PANEL)
        self.assertIn("layered, condition-colored", README)

    def test_selected_day_has_a_phase_shifted_energy_core(self):
        for contract in (
            "property real weatherCorePhase",
            "NumberAnimation on weatherCorePhase",
            "WeatherEnergyCore {",
            "phase: root.weatherCorePhase",
            "storm: root.carouselStorm",
        ):
            self.assertIn(contract, PANEL)
        self.assertIn("ctx.createRadialGradient(", ENERGY_CORE)
        self.assertIn("var ringScales = [", ENERGY_CORE)
        self.assertIn("Counter-rotating partial arcs", ENERGY_CORE)

    def test_temperature_tweens_and_signals_direction(self):
        for contract in (
            "function syncAnimatedTemperature(",
            "property real animatedReportTemp",
            "property real temperatureFlash",
            "id: temperatureTween",
            "id: temperatureFlashPulse",
            "text: root.displayedTempNum",
            'root.temperatureDirection > 0 ? "↗" : "↘"',
        ):
            self.assertIn(contract, PANEL)
        self.assertIn("warming flashes amber", README)
        self.assertIn("cooling flashes ice-blue", README)

    def test_late_day_hourly_cards_fill_the_row_symmetrically(self):
        for contract in (
            "id: hourlyStrip",
            "readonly property real edgeInset",
            "readonly property real fittedCellWidth",
            "var available = width - edgeInset * 2 - gaps",
            "width: hourlyStrip.fittedCellWidth",
        ):
            self.assertIn(contract, PANEL)
        self.assertEqual(PANEL.count("Item { width: hourlyStrip.edgeInset; height: 1 }"), 2)
        self.assertIn("expand evenly across the", README)

    def test_opening_choreography_is_fifty_percent_faster(self):
        for contract in (
            "duration: 307",
            "PauseAnimation { duration: 67 }",
            "duration: 453",
            "interval: 1200",
            "duration: 700",
            "duration: 347",
            "duration: 600",
        ):
            self.assertIn(contract, PANEL)
        self.assertIn("run at 1.5×", README)


if __name__ == "__main__":
    unittest.main()
