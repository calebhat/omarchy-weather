#!/usr/bin/env python3
"""Regenerate tide-stations.json from the providers' full station lists.

    scripts/build-tide-stations.py [output-path]

The plugin never downloads a station list at runtime; this index is the only
place stations come from. Only stations that publish high/low predictions are
kept.

  NOAA CO-OPS   the metadata API's `tidepredictions` list (US coasts and
                territories).
  Canada DFO    IWLS stations that carry a `wlp-hilo` time series. Operating,
                permanent and seasonal stations are kept; discontinued and
                temporary survey sites are left out.

To stay small, NOAA stations within DEDUPE_KM of an already-kept one are
dropped, reference (harmonic) stations first, so a bay with a dozen subordinate
stations contributes the reference station and a few spread-out ones.

Row layout, per provider: [id, name, latitude, longitude].
"""

import datetime
import json
import math
import sys
import urllib.request
from pathlib import Path

NOAA_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"
DFO_URL = "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations"
DEDUPE_KM = 4
MAX_BYTES = 150 * 1024
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tide-stations.json"
KEEP_DFO_TYPES = {"PERMANENT", "SEASONAL"}


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def km_between(a, b):
    dy = (a[0] - b[0]) * 111.2
    dx = (a[1] - b[1]) * 111.2 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def valid_place(lat, lon):
    return (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and -90 <= lat <= 90 and -180 <= lon <= 180)


def noaa_rows():
    stations = [s for s in fetch(NOAA_URL)["stations"] if valid_place(s.get("lat"), s.get("lng"))]
    # Reference stations first so they win a dedupe tie.
    stations.sort(key=lambda s: (s.get("type") != "R", str(s["id"])))
    kept = []
    for s in stations:
        here = (s["lat"], s["lng"])
        if any(km_between(here, (k["lat"], k["lng"])) < DEDUPE_KM for k in kept):
            continue
        kept.append(s)
    rows = [[str(s["id"]), str(s["name"]).strip(), round(s["lat"], 3), round(s["lng"], 3)] for s in kept]
    return sorted(rows, key=lambda r: r[0])


def dfo_rows():
    rows = []
    for s in fetch(DFO_URL):
        if not valid_place(s.get("latitude"), s.get("longitude")):
            continue
        if not any(t.get("code") == "wlp-hilo" for t in s.get("timeSeries", [])):
            continue
        if not (s.get("operating") or s.get("type") in KEEP_DFO_TYPES):
            continue
        rows.append([str(s["id"]), str(s["officialName"]).strip(), round(s["latitude"], 3), round(s["longitude"], 3)])
    return sorted(rows, key=lambda r: r[0])


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    index = {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "noaa": noaa_rows(),
        "dfo": dfo_rows(),
    }
    text = json.dumps(index, separators=(",", ":"), ensure_ascii=False) + "\n"
    out.write_text(text, encoding="utf-8")
    size = len(text.encode("utf-8"))
    print("%s: %d NOAA + %d DFO stations, %d bytes" % (out, len(index["noaa"]), len(index["dfo"]), size))
    if size > MAX_BYTES:
        print("over the %d byte budget; raise DEDUPE_KM" % MAX_BYTES)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
