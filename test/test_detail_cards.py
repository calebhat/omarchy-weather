#!/usr/bin/env python3
"""Static contracts for the hour and day detail cards."""

from pathlib import Path
import unittest


PLUGIN = Path(__file__).parents[1]
PANEL = (PLUGIN / "Panel.qml").read_text(encoding="utf-8")


class DetailCardTests(unittest.TestCase):
    def test_request_asks_for_the_card_fields(self):
        for field in (
            "apparent_temperature", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m",
            "relative_humidity_2m", "dew_point_2m", "cloud_cover", "pressure_msl",
            "visibility", "uv_index", "apparent_temperature_max", "apparent_temperature_min",
            "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
            "daylight_duration",
        ):
            self.assertIn(field, PANEL.split("&forecast_days=10")[0], field)
        self.assertEqual(PANEL.count('"https://api.open-meteo.com/v1/forecast"'), 1)

    def test_panel_only_holds_the_selection(self):
        for contract in (
            'import "Detail.js" as Detail',
            "property var detailSelection",
            "function toggleDetail(kind, reportIndex)",
            "function closeDetail()",
            "Detail.nextSelection(",
            "Detail.hourDetail(dailyForecastReport",
            "Detail.dayDetail(dailyForecastReport",
            "HourDetail {",
            "DayDetail {",
        ):
            self.assertIn(contract, PANEL)

    def test_every_entry_point_toggles_a_card(self):
        self.assertIn('root.toggleDetail("hour", modelData.reportIndex)', PANEL)
        self.assertEqual(PANEL.count('root.toggleDetail("day", '), 2)

    def test_escape_closes_the_card_before_the_panel(self):
        close = PANEL.split("onCloseRequested: {")[1].split("}")[0]
        self.assertLess(close.index("closeDetail"), close.index("root.close()"))

    def test_card_closes_with_the_panel_and_when_the_report_goes(self):
        self.assertIn("onDailyForecastReportChanged: if (!dailyForecastReport) closeDetail()", PANEL)
        self.assertIn("closeDetail()", PANEL.split("function close() {")[1].split("\n  }\n")[0])

    def test_day_heading_uses_the_panels_locale_date_format(self):
        self.assertIn('Qt.formatDate(d, "ddd MMM d")', PANEL)

    def test_components_exist_and_leave_slots(self):
        day = (PLUGIN / "DayDetail.qml").read_text(encoding="utf-8")
        self.assertIn("SLOT: moon", day)
        self.assertIn("SLOT: tides", day)
        self.assertTrue((PLUGIN / "HourDetail.qml").exists())


if __name__ == "__main__":
    unittest.main()
