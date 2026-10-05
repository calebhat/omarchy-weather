#!/usr/bin/env python3
"""Regenerate tz-transitions.json: when each IANA zone changes its UTC offset.

    scripts/build-tz-transitions.py [output-path]
    scripts/build-tz-transitions.py --check      # exit 1 if the committed file is stale

Open-Meteo writes every time in a response in ONE fixed offset (the one in force
when it was fetched), so a ten-day forecast that crosses a daylight-saving
change cannot say what the wall clock reads on each date. The panel looks the
zone up in this table instead. The table covers the previous calendar year
through six years ahead (see default_window); outside those years, and for a zone
that is not listed, the response's own offset is used. The plugin stops trusting
the table within a year of its end, so regenerate it at least once a year.
Only zones that change offset in that window are listed.

Entry: "Zone/Name": [offset_before, minute_1, offset_1, minute_2, offset_2, ...]
Offsets are seconds east of UTC; minutes are minutes since the Unix epoch (UTC).
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, available_timezones

YEARS_BEFORE = 1
YEARS_AFTER = 6
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tz-transitions.json"


def offset_at(zone, minute):
    moment = datetime.fromtimestamp(minute * 60, tz=timezone.utc).astimezone(zone)
    return int(moment.utcoffset().total_seconds())


def default_window(year):
    """(first year, last year) covered, relative to `year`."""
    return year - YEARS_BEFORE, year + YEARS_AFTER


def transitions(name, start_year, end_year):
    zone = ZoneInfo(name)
    start = int(datetime(start_year, 1, 1, tzinfo=timezone.utc).timestamp() // 60)
    end = int(datetime(end_year + 1, 1, 1, tzinfo=timezone.utc).timestamp() // 60)
    step = 6 * 60
    before = offset_at(zone, start)
    out = []
    previous, previous_offset = start, before
    for minute in range(start + step, end + step, step):
        current = offset_at(zone, minute)
        if current != previous_offset:
            low, high = previous, minute
            while high - low > 1:
                middle = (low + high) // 2
                if offset_at(zone, middle) == previous_offset:
                    low = middle
                else:
                    high = middle
            out += [high, current]
            previous_offset = current
        previous = minute
    return [before] + out if out else None


def build(start_year, end_year):
    table = {}
    for name in sorted(available_timezones()):
        try:
            row = transitions(name, start_year, end_year)
        except Exception:
            continue
        if row:
            table[name] = row
    return {"version": 1, "from": start_year, "to": end_year, "zones": table}


def main():
    if "--check" in sys.argv:
        # Verify the committed data against the tz database for the years it
        # claims to cover. Expiry is a separate question (test_tz_table.py).
        current = DEFAULT_OUT.read_text(encoding="utf-8") if DEFAULT_OUT.exists() else ""
        try:
            body = json.loads(current)
            window = (body["from"], body["to"])
        except (ValueError, KeyError, TypeError):
            window = default_window(datetime.now(timezone.utc).year)
        text = json.dumps(build(*window), separators=(",", ":")) + "\n"
        if current != text:
            print("tz-transitions.json is out of date; run scripts/build-tz-transitions.py")
            return 1
        print("tz-transitions.json is up to date")
        return 0
    text = json.dumps(build(*default_window(datetime.now(timezone.utc).year)), separators=(",", ":")) + "\n"
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.write_text(text, encoding="utf-8")
    print("%s: %d zones, %d bytes" % (out, len(json.loads(text)["zones"]), len(text.encode())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
