// Tides: provider adapters, the shipped station index, nearest-station choice,
// the once-a-day cache, and the day rows. Fixtures are real responses fetched
// 2026-10-05 and trimmed:
//   noaa-9414290-gmt.json      San Francisco, time_zone=gmt, units=metric
//   noaa-9414290-lst_ldt.json  the same station asked in its own local time,
//                              which is the reference for the zone conversion
//   noaa-error.json            what NOAA answers (HTTP 200) for a bad station
//   dfo-07735-wlp-hilo.json    Vancouver, DFO IWLS wlp-hilo (events only: the
//                              API does not say which are highs)

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync, statSync } = require("node:fs")
const { join } = require("node:path")
const { loadLibrary } = require("./load.js")

const Tides = loadLibrary("Tides.js")
const Detail = loadLibrary("Detail.js")

const fixture = name => readFileSync(join(__dirname, "fixtures", name), "utf8")
const INDEX_PATH = join(__dirname, "..", "tide-stations.json")
const realIndex = () => Tides.parseIndex(readFileSync(INDEX_PATH, "utf8"))

const PDT = -7 * 3600
const SF = { provider: "noaa", id: "9414290", name: "San Francisco", lat: 37.806, lon: -122.465 }
const VANCOUVER = { provider: "dfo", id: "5cebf1de3d0f4a073c4bb943", name: "Vancouver", lat: 49.286, lon: -123.1 }

// ---- requests -----------------------------------------------------------

test("NOAA request is a curl argv with a fixed https base, a size cap and a timeout", () => {
  const from = Date.UTC(2026, 9, 4)
  const to = Date.UTC(2026, 9, 16)
  const argv = Tides.PROVIDERS.noaa.request("9414290", from, to)
  assert.ok(Array.isArray(argv) && argv.every(a => typeof a === "string"))
  assert.equal(argv[0], "curl")
  assert.ok(argv.includes("--max-filesize"))
  assert.ok(argv.includes("--max-time"))
  const url = argv[argv.length - 1]
  assert.ok(url.startsWith("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"), url)
  for (const part of ["product=predictions", "station=9414290", "begin_date=20261004", "end_date=20261016",
    "datum=MLLW", "time_zone=gmt", "units=metric", "interval=hilo", "format=json"]) {
    assert.ok(url.includes(part), part)
  }
})

test("DFO request is a curl argv with a fixed https base, a size cap and a timeout", () => {
  const argv = Tides.PROVIDERS.dfo.request(VANCOUVER.id, Date.UTC(2026, 9, 4), Date.UTC(2026, 9, 16))
  assert.equal(argv[0], "curl")
  assert.ok(argv.includes("--max-filesize"))
  assert.ok(argv.includes("--max-time"))
  const url = argv[argv.length - 1]
  assert.equal(url, "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/" + VANCOUVER.id +
    "/data?time-series-code=wlp-hilo&from=2026-10-04T00:00:00Z&to=2026-10-16T00:00:00Z")
})

test("a station id that could change the request is refused", () => {
  const from = Date.UTC(2026, 9, 4)
  const to = Date.UTC(2026, 9, 5)
  for (const bad of ["", "94 14", "9414290&units=english", "../x", "9414290;ls", null, undefined, 9414290, "a".repeat(40)]) {
    assert.equal(Tides.PROVIDERS.noaa.request(bad, from, to), null, String(bad))
  }
  for (const bad of ["", "07735", "5cebf1de3d0f4a073c4bb94/../x", VANCOUVER.id + "?x=1", null, 5]) {
    assert.equal(Tides.PROVIDERS.dfo.request(bad, from, to), null, String(bad))
  }
})

test("a request for a bad time range is refused", () => {
  for (const [a, b] of [[NaN, 1], [10, 5], ["x", 5], [0, Infinity]]) {
    assert.equal(Tides.PROVIDERS.noaa.request("9414290", a, b), null)
    assert.equal(Tides.PROVIDERS.dfo.request(VANCOUVER.id, a, b), null)
  }
})

test("adapters name their datum and attribution", () => {
  assert.equal(Tides.PROVIDERS.noaa.datum, "MLLW")
  assert.match(Tides.PROVIDERS.noaa.attribution, /NOAA/)
  assert.match(Tides.PROVIDERS.dfo.datum, /Chart Datum/)
  assert.match(Tides.PROVIDERS.dfo.attribution, /Fisheries and Oceans Canada/)
})

// ---- parsing ------------------------------------------------------------

test("NOAA predictions parse to UTC events with high/low types", () => {
  const events = Tides.PROVIDERS.noaa.parse(fixture("noaa-9414290-gmt.json"))
  assert.equal(events.length, 12)
  assert.deepEqual(events[0], { time: Date.UTC(2026, 9, 5, 1, 32), type: "high", height: 1.721 })
  assert.deepEqual(events[1], { time: Date.UTC(2026, 9, 5, 8, 42), type: "low", height: -0.027 })
  for (let i = 1; i < events.length; i++) assert.ok(events[i].time > events[i - 1].time)
})

test("DFO events get high/low from their neighbours", () => {
  const events = Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json"))
  assert.equal(events.length, 8)
  assert.deepEqual(events.map(e => e.type), ["low", "high", "low", "high", "low", "high", "low", "high"])
  assert.deepEqual(events[0], { time: Date.UTC(2026, 9, 5, 3, 25), type: "low", height: 3.341 })
  assert.deepEqual(events[3], { time: Date.UTC(2026, 9, 5, 22, 20), type: "high", height: 4.462 })
})

test("NOAA answers a bad station with an error body; that is no tides, not zero tides", () => {
  assert.equal(Tides.PROVIDERS.noaa.parse(fixture("noaa-error.json")), null)
})

test("malformed NOAA bodies parse to null or skip the bad entries", () => {
  const noaa = Tides.PROVIDERS.noaa
  for (const raw of ["", "not json", "null", "[]", "42", "{}", '{"predictions":"x"}', '{"predictions":{"a":1}}']) {
    assert.equal(noaa.parse(raw), null, raw)
  }
  assert.deepEqual(noaa.parse('{"predictions":[]}'), [])
  const mixed = JSON.stringify({ predictions: [
    { t: "2026-10-05 01:32", v: "1.7", type: "H" },
    { t: "2026-10-05 02:00", v: "abc", type: "L" },
    { t: "yesterday", v: "1.0", type: "H" },
    { t: "2026-10-05 03:00", v: "1.0", type: "X" },
    { t: "2026-10-05 04:00", v: "", type: "L" },
    { t: "2026-13-45 04:00", v: "1.0", type: "L" },
    { t: "2026-10-05 05:00", v: "1e999", type: "L" },
    null, 7, "x", [],
    { t: "2026-10-05 06:00", v: 0.5, type: "L" },
    { t: "2026-10-05 07:00", v: "-0.4", type: "L" }
  ] })
  assert.deepEqual(noaa.parse(mixed).map(e => [e.type, e.height]), [["high", 1.7], ["low", 0.5], ["low", -0.4]])
})

test("malformed DFO bodies parse to null or skip the bad entries", () => {
  const dfo = Tides.PROVIDERS.dfo
  for (const raw of ["", "not json", "null", "{}", '{"errors":[1]}', "42", '"x"']) {
    assert.equal(dfo.parse(raw), null, raw)
  }
  assert.deepEqual(dfo.parse("[]"), [])
  const mixed = JSON.stringify([
    { eventDate: "2026-10-05T03:00:00Z", value: 1 },
    { eventDate: "2026-10-05T09:00:00Z", value: "2" },
    { eventDate: "2026-10-05T10:00:00Z", value: null },
    { eventDate: "nope", value: 3 },
    { value: 3 },
    null, 5,
    { eventDate: "2026-10-05T15:00:00Z", value: 0.5 },
    { eventDate: "2026-10-05T21:00:00Z", value: 2.5 }
  ])
  assert.deepEqual(dfo.parse(mixed).map(e => [e.type, e.height]), [["high", 1], ["low", 0.5], ["high", 2.5]])
})

test("a lone DFO event cannot be told apart, so it is dropped", () => {
  assert.deepEqual(Tides.PROVIDERS.dfo.parse('[{"eventDate":"2026-10-05T03:00:00Z","value":1}]'), [])
})

// ---- bounds: a response cannot make the panel draw or cache an unbounded list

const flood = n => JSON.stringify({ predictions: Array.from({ length: n }, () => ({ t: "2026-10-05 01:32", v: "1.7", type: "H" })) })

test("4,500 identical NOAA events are one event", () => {
  const raw = flood(4500)
  assert.ok(raw.length > 190000)
  assert.deepEqual(Tides.PROVIDERS.noaa.parse(raw), [{ time: Date.UTC(2026, 9, 5, 1, 32), type: "high", height: 1.7 }])
})

test("a flood of distinct NOAA times is cut to a few per day and a few days", () => {
  const predictions = []
  for (let i = 0; i < 4500; i++) {
    const t = new Date(Date.UTC(2026, 9, 5) + i * 60000)
    predictions.push({
      t: t.toISOString().slice(0, 10) + " " + t.toISOString().slice(11, 16), v: String(i % 7), type: i % 2 ? "H" : "L"
    })
  }
  const events = Tides.PROVIDERS.noaa.parse(JSON.stringify({ predictions }))
  assert.ok(events.length <= Tides.MAX_EVENTS, String(events.length))
  const perDay = {}
  for (const e of events) perDay[Math.floor(e.time / 86400000)] = (perDay[Math.floor(e.time / 86400000)] || 0) + 1
  for (const n of Object.values(perDay)) assert.ok(n <= Tides.MAX_PER_DAY, String(n))
  for (let i = 1; i < events.length; i++) assert.ok(events[i].time >= events[i - 1].time)
})

test("a flood of DFO points is bounded the same way", () => {
  const same = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ eventDate: "2026-10-05T03:25:00Z", value: i % 5 })))
  assert.ok(Tides.PROVIDERS.dfo.parse(same).length <= 1)
  const spread = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({
    eventDate: new Date(Date.UTC(2026, 9, 5) + i * 60000).toISOString().slice(0, 19) + "Z", value: i % 9 })))
  const events = Tides.PROVIDERS.dfo.parse(spread)
  assert.ok(events.length <= Tides.MAX_EVENTS, String(events.length))
})

test("real data is untouched by the bounds", () => {
  assert.equal(Tides.PROVIDERS.noaa.parse(fixture("noaa-9414290-gmt.json")).length, 12)
  assert.equal(Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json")).length, 8)
})

test("a flooded cache file is bounded when it is read, and when it is written", () => {
  const events = Array.from({ length: 5000 }, () => ({ time: 5, type: "high", height: 1 }))
  const text = JSON.stringify({ version: 1, stations: { "noaa:1": { fetchedAt: NOW, events } } })
  assert.equal(Tides.eventsFor(Tides.parseCache(text), "noaa:1").length, 1)
  const many = Array.from({ length: 5000 }, (_, i) => ({ time: i * 60000, type: "low", height: 1 }))
  assert.ok(Tides.eventsFor(Tides.withEntry(Tides.parseCache(""), "noaa:1", many, NOW), "noaa:1").length <= Tides.MAX_EVENTS)
})

test("a day never draws more than a handful of rows", () => {
  const events = Array.from({ length: 300 }, (_, i) => ({ time: Date.UTC(2026, 9, 5, 8) + i * 60000, type: i % 2 ? "high" : "low", height: i }))
  const rows = Tides.dayTides({ station: SF, distanceKm: 1, events }, "2026-10-05", 0, false, false).rows
  assert.ok(rows.length <= Tides.MAX_PER_DAY, String(rows.length))
})

// ---- time zone alignment ------------------------------------------------

test("UTC events line up with NOAA's own local-time listing for the station", () => {
  const events = Tides.PROVIDERS.noaa.parse(fixture("noaa-9414290-gmt.json"))
  const local = JSON.parse(fixture("noaa-9414290-lst_ldt.json")).predictions
  for (const date of ["2026-10-05", "2026-10-06", "2026-10-07"]) {
    const mine = Tides.dayEvents(events, date, PDT).map(e => Tides.clock(e.time, PDT) + " " + e.type[0] + " " + e.height)
    const theirs = local.filter(p => p.t.startsWith(date))
      .map(p => p.t.slice(11) + " " + (p.type === "H" ? "h" : "l") + " " + Number(p.v))
    // The window ends at the 7th's last UTC event, so the 7th may be short.
    if (date === "2026-10-07") assert.deepEqual(mine, theirs.slice(0, mine.length))
    else assert.deepEqual(mine, theirs, date)
  }
})

test("a UTC event just after midnight belongs to the previous local day west of Greenwich", () => {
  const events = Tides.PROVIDERS.noaa.parse(fixture("noaa-9414290-gmt.json"))
  // 2026-10-05 01:32 UTC is 18:32 on the 4th in San Francisco.
  assert.equal(Tides.dayEvents(events, "2026-10-04", PDT).length, 1)
  assert.equal(Tides.dayEvents(events, "2026-10-04", PDT)[0].time, Date.UTC(2026, 9, 5, 1, 32))
})

// New York across the end of daylight-saving time (Nov 1 2026, 06:00 UTC), on a
// forecast fetched Oct 26 whose single offset is EDT (-4h).
const Zone = loadLibrary("Zone.js")
const NY_REPORT = {
  latitude: 40.7, longitude: -74, timezone: "America/New_York", utc_offset_seconds: -14400,
  daily: { time: ["2026-10-26", "2026-10-27", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"] }
}
const nyZone = () => Zone.forReport(NY_REPORT, Zone.parseTable(readFileSync(join(__dirname, "..", "tz-transitions.json"), "utf8")),
  Date.UTC(2026, 9, 26))
const zonedNy = () => Zone.attach(NY_REPORT, nyZone())

test("across the clock change, 04:30 UTC on Nov 2 is Nov 1 at 23:30 in New York", () => {
  const events = [{ time: Date.UTC(2026, 10, 2, 4, 30), type: "high", height: 1 }]
  const day1 = Tides.dayEvents(events, "2026-11-01", nyZone())
  assert.equal(day1.length, 1)
  assert.equal(Tides.clock(day1[0].time, nyZone()), "23:30")
  assert.equal(Tides.dayEvents(events, "2026-11-02", nyZone()).length, 0)
  // The single fetch-time offset gets both wrong, which is the bug this guards.
  assert.equal(Tides.dayEvents(events, "2026-11-02", -14400).length, 1)
})

test("the 25-hour day holds events from 00:00 EDT to 23:59 EST and no more", () => {
  const events = [
    { time: Date.UTC(2026, 10, 1, 3, 59), type: "low", height: 1 },
    { time: Date.UTC(2026, 10, 1, 4, 0), type: "high", height: 1 },
    { time: Date.UTC(2026, 10, 1, 6, 30), type: "low", height: 1 },
    { time: Date.UTC(2026, 10, 2, 4, 59), type: "high", height: 1 },
    { time: Date.UTC(2026, 10, 2, 5, 0), type: "low", height: 1 }
  ]
  assert.deepEqual(Tides.dayEvents(events, "2026-11-01", nyZone()).map(e => e.time),
    [events[1].time, events[2].time, events[3].time])
  assert.deepEqual(Tides.dayEvents(events, "2026-11-02", nyZone()).map(e => e.time), [events[4].time])
})

test("the day card for New York shows the late event on Nov 1 at 23:30, not Nov 2 at 00:30", () => {
  const events = [{ time: Date.UTC(2026, 10, 2, 4, 30), type: "high", height: 1.2 }]
  const info = { station: SF, distanceKm: 3, events }
  const nov1 = Detail.dayDetail(zonedNy(), 2, false, false, undefined, info)
  assert.deepEqual(nov1.tides.rows.map(r => r.value), ["23:30 · 1.2 m"])
  const nov2 = Detail.dayDetail(zonedNy(), 3, false, false, undefined, info)
  assert.deepEqual(nov2.tides.rows.map(r => r.value), ["—"])
})

test("the request window follows each end's own offset", () => {
  const win = Tides.windowFor(zonedNy())
  assert.equal(win.fromMs, Date.UTC(2026, 9, 26, 4) - 24 * HOUR)
  assert.equal(win.toMs, Date.UTC(2026, 10, 4, 5) + 48 * HOUR)
})

test("east of Greenwich the same UTC event lands on the next local day", () => {
  const events = [{ time: Date.UTC(2026, 9, 4, 22, 30), type: "high", height: 1 }]
  assert.equal(Tides.dayEvents(events, "2026-10-05", 11 * 3600).length, 1)
  assert.equal(Tides.dayEvents(events, "2026-10-04", 11 * 3600).length, 0)
})

test("DFO Vancouver events fall on the right local day", () => {
  const events = Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json"))
  const day = Tides.dayEvents(events, "2026-10-05", PDT)
  assert.deepEqual(day.map(e => Tides.clock(e.time, PDT) + " " + e.type[0] + " " + e.height),
    ["07:39 l 1.158", "15:20 h 4.462", "21:26 l 3.011"])
})

test("day rows are timed in the forecast zone, 12 or 24 hour, with the unit asked for", () => {
  const events = Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json"))
  const info = { station: VANCOUVER, distanceKm: 3.2, events }
  const rows = Tides.dayTides(info, "2026-10-05", PDT, false, false).rows
  assert.deepEqual(rows.map(r => [r.label, r.value]),
    [["Low", "07:39 · 1.2 m"], ["High", "15:20 · 4.5 m"], ["Low", "21:26 · 3.0 m"]])
  const imperial = Tides.dayTides(info, "2026-10-05", PDT, true, true).rows
  assert.deepEqual(imperial.map(r => r.value), ["7:39 AM · 3.8 ft", "3:20 PM · 14.6 ft", "9:26 PM · 9.9 ft"])
})

test("each tide row has its time and height as separate cells", () => {
  const events = Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json"))
  const info = { station: VANCOUVER, distanceKm: 3.2, events }
  const metric = Tides.dayTides(info, "2026-10-05", PDT, false, false).rows
  assert.deepEqual(metric.map(r => [r.label, r.time, r.height]),
    [["Low", "07:39", "1.2 m"], ["High", "15:20", "4.5 m"], ["Low", "21:26", "3.0 m"]])
  const long = Tides.dayTides({ station: SF, distanceKm: 1, events: [{ time: Date.UTC(2026, 9, 5, 19, 30), type: "high", height: 3.8 }] },
    "2026-10-05", 0, true, true).rows[0]
  assert.deepEqual([long.time, long.height], ["7:30 PM", "12.5 ft"])
  const dash = Tides.dayTides({ station: SF, distanceKm: 1, events: [] }, "2026-10-05", PDT, false, false).rows[0]
  assert.equal(dash.time, undefined)
})

test("a day with no events, or no events loaded, shows a dash", () => {
  const info = { station: SF, distanceKm: 1, events: [] }
  assert.deepEqual(Tides.dayTides(info, "2026-10-05", PDT, false, false).rows, [{ key: "tides", label: "Tides", value: "—" }])
  const loading = Tides.dayTides({ station: SF, distanceKm: 1, events: null }, "2026-10-05", PDT, false, false)
  assert.deepEqual(loading.rows, [{ key: "tides", label: "Tides", value: "—" }])
  assert.match(loading.station, /San Francisco/)
})

test("the card names the station, its distance, the datum and the source", () => {
  const info = { station: SF, distanceKm: 12.4, events: [] }
  const metric = Tides.dayTides(info, "2026-10-05", PDT, false, false)
  assert.equal(metric.station, "San Francisco · 12 km")
  assert.equal(Tides.dayTides(info, "2026-10-05", PDT, true, false).station, "San Francisco · 7.7 mi")
  assert.equal(Tides.dayTides({ station: SF, distanceKm: 40, events: [] }, "2026-10-05", PDT, true, false).station, "San Francisco · 25 mi")
  assert.match(metric.datum, /MLLW/)
  assert.match(metric.credit, /NOAA/)
  const dfo = Tides.dayTides({ station: VANCOUVER, distanceKm: 0.5, events: [] }, "2026-10-05", PDT, false, false)
  assert.match(dfo.datum, /Chart Datum/)
  assert.match(dfo.credit, /Fisheries and Oceans Canada/)
  assert.equal(dfo.station, "Vancouver · 0.5 km")
})

test("no station or no usable offset means no tide card", () => {
  assert.equal(Tides.dayTides(null, "2026-10-05", PDT, false, false), null)
  assert.equal(Tides.dayTides({ station: null, events: [] }, "2026-10-05", PDT, false, false), null)
  assert.equal(Tides.dayTides({ station: SF, distanceKm: 1, events: [] }, "2026-10-05", NaN, false, false), null)
  assert.equal(Tides.dayTides({ station: SF, distanceKm: 1, events: [] }, "bad", PDT, false, false), null)
})

// ---- heights ------------------------------------------------------------

test("heights are metres or feet, one decimal, never a negative zero", () => {
  assert.equal(Tides.formatHeight(1.721, false), "1.7 m")
  assert.equal(Tides.formatHeight(1.721, true), "5.6 ft")
  assert.equal(Tides.formatHeight(0, false), "0.0 m")
  assert.equal(Tides.formatHeight(-0.027, false), "0.0 m")
  assert.equal(Tides.formatHeight(-0.027, true), "-0.1 ft")
  assert.equal(Tides.formatHeight(-0.5, true), "-1.6 ft")
  assert.equal(Tides.formatHeight(12.04, false), "12.0 m")
})

test("a missing or malformed height is a dash", () => {
  for (const bad of [null, undefined, NaN, Infinity, "1.2", [], {}, true]) {
    assert.equal(Tides.formatHeight(bad, false), "—", String(bad))
  }
})

// ---- the shipped station index ------------------------------------------

test("the station index is valid, small, and covers both providers", () => {
  assert.ok(statSync(INDEX_PATH).size < 150 * 1024, "index over 150 KB")
  const stations = realIndex()
  assert.ok(stations.length > 1000)
  assert.ok(stations.some(s => s.provider === "noaa"))
  assert.ok(stations.some(s => s.provider === "dfo"))
  const keys = new Set()
  for (const s of stations) {
    assert.ok(s.name.length > 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180, JSON.stringify(s))
    assert.ok(Tides.PROVIDERS[s.provider].request(s.id, 0, 1) !== null, "unsafe id " + s.id)
    assert.ok(!keys.has(s.provider + ":" + s.id), "duplicate " + s.id)
    keys.add(s.provider + ":" + s.id)
  }
})

test("parseIndex keeps valid rows and drops bad ones", () => {
  const text = JSON.stringify({ version: 1, noaa: [["9414290", "SF", 37.8, -122.4], ["bad id", "x", 1, 1], ["1", "y", 91, 0],
    ["2", "z", "1", 1], [3, "w", 1, 1], null, "x", ["4", "ok", 0, 0]], dfo: "no", extra: [] })
  assert.deepEqual(Tides.parseIndex(text).map(s => s.provider + ":" + s.id), ["noaa:9414290", "noaa:4"])
  for (const bad of ["", "nope", "null", "[]", "42", "{}"]) assert.deepEqual(Tides.parseIndex(bad), [])
})

// ---- nearest station ----------------------------------------------------

test("great-circle distance is right on known pairs", () => {
  assert.ok(Math.abs(Tides.distanceKm(0, 0, 0, 1) - 111.19) < 0.1)
  assert.ok(Math.abs(Tides.distanceKm(51.5, -0.12, 48.85, 2.35) - 343.6) < 2)
  assert.ok(Math.abs(Tides.distanceKm(0, 179.9, 0, -179.9) - 22.2) < 0.1)
  assert.equal(Tides.distanceKm(10, 10, 10, 10), 0)
})

test("the nearest real station is found for places on both providers' coasts", () => {
  const stations = realIndex()
  const sf = Tides.nearestStation(stations, 37.7749, -122.4194, 40)
  assert.equal(sf.station.provider, "noaa")
  assert.ok(sf.km < 15)
  const vancouver = Tides.nearestStation(stations, 49.2827, -123.1207, 40)
  assert.equal(vancouver.station.provider, "dfo")
  assert.ok(vancouver.km < 10, "km " + vancouver.km)
  assert.equal(Tides.nearestStation(stations, 21.3069, -157.8583, 40).station.provider, "noaa")
  assert.equal(Tides.nearestStation(stations, 48.4284, -123.3656, 40).station.provider, "dfo")
})

test("places with no station in range have none, including far from any coast", () => {
  const stations = realIndex()
  for (const [name, lat, lon] of [["Sydney", -33.8688, 151.2093], ["Longyearbyen", 78.2232, 15.6267],
    ["Denver", 39.7392, -104.9903], ["mid-Pacific", 0, -140], ["South Pole", -90, 0], ["north pole", 90, 0]]) {
    assert.equal(Tides.nearestStation(stations, lat, lon, Tides.AUTO_MAX_KM), null, name)
  }
})

test("the nearest of several wins, across the antimeridian too", () => {
  const stations = [
    { provider: "noaa", id: "1", name: "far", lat: 0, lon: 170 },
    { provider: "noaa", id: "2", name: "near", lat: 0, lon: 179.9 },
    { provider: "dfo", id: "3".repeat(24), name: "mid", lat: 0, lon: 175 }
  ]
  assert.equal(Tides.nearestStation(stations, 0, -179.95, 40).station.id, "2")
})

test("bad coordinates or range give no station", () => {
  const stations = [SF]
  for (const [lat, lon, km] of [[NaN, 0, 40], [91, 0, 40], [0, 181, 40], ["37", -122, 40], [null, 0, 40], [37.8, -122.4, NaN],
    [37.8, -122.4, -1], [37.8, -122.4, "40"]]) {
    assert.equal(Tides.nearestStation(stations, lat, lon, km), null, JSON.stringify([lat, lon, km]))
  }
  assert.equal(Tides.nearestStation(null, 37.8, -122.4, 40), null)
  assert.equal(Tides.nearestStation([], 37.8, -122.4, 40), null)
})

// ---- the one `tides` setting: auto, on, off ----------------------------------

// A place whose nearest station (SF, 37.806 -122.465) is the given distance due north.
const northOfSf = km => ({ lat: 37.806 + km / 111.195, lon: -122.465 })

test("the auto threshold is a named constant of 100 km, not a setting", () => {
  assert.equal(Tides.AUTO_MAX_KM, 100)
})

test("the setting has three values and anything else means auto", () => {
  for (const v of ["auto", "on", "off"]) assert.equal(Tides.normalizeMode(v), v)
  for (const bad of [undefined, null, "", "ON", "true", true, false, 1, {}, [], "auto "]) assert.equal(Tides.normalizeMode(bad), "auto", String(bad))
})

test("auto: a station just inside 100 km shows, just outside shows nothing", () => {
  const stations = [SF]
  const inside = northOfSf(99.5)
  const outside = northOfSf(100.5)
  assert.ok(Math.abs(Tides.distanceKm(inside.lat, inside.lon, SF.lat, SF.lon) - 99.5) < 0.05)
  assert.ok(Math.abs(Tides.distanceKm(outside.lat, outside.lon, SF.lat, SF.lon) - 100.5) < 0.05)
  const found = Tides.stationFor(stations, inside.lat, inside.lon, "auto")
  assert.equal(found.station.id, "9414290")
  assert.ok(found.km < 100)
  assert.equal(Tides.stationFor(stations, outside.lat, outside.lon, "auto"), null)
})

test("auto: exactly 100 km is still in range, and the default is auto", () => {
  const exactly = northOfSf(100)
  const km = Tides.distanceKm(exactly.lat, exactly.lon, SF.lat, SF.lon)
  assert.equal(Tides.stationFor([SF], exactly.lat, exactly.lon, "auto") !== null, km <= 100)
  assert.ok(Tides.stationFor([SF], 37.8, -122.4, undefined) !== null)
  assert.equal(Tides.stationFor([SF], -33.9, 151.2, undefined), null)
})

test("on: the nearest station at any distance", () => {
  const stations = realIndex()
  const sydney = Tides.stationFor(stations, -33.8688, 151.2093, "on")
  assert.ok(sydney !== null && sydney.km > 1000)
  const outside = northOfSf(250)
  assert.equal(Tides.stationFor([SF], outside.lat, outside.lon, "auto"), null)
  assert.equal(Tides.stationFor([SF], outside.lat, outside.lon, "on").station.id, "9414290")
  const antipode = Tides.stationFor([SF], -37.8, 57.5, "on")
  assert.ok(antipode.km > 19000)
})

test("on with no station in the index at all is still nothing", () => {
  assert.equal(Tides.stationFor([], 37.8, -122.4, "on"), null)
  assert.equal(Tides.stationFor(null, 37.8, -122.4, "on"), null)
})

test("off: never a station, however close", () => {
  assert.equal(Tides.stationFor([SF], SF.lat, SF.lon, "off"), null)
  assert.equal(Tides.stationFor(realIndex(), 37.7749, -122.4194, "off"), null)
})

test("bad coordinates give no station in any mode", () => {
  for (const mode of ["auto", "on", "off"]) {
    for (const [lat, lon] of [[NaN, 0], [91, 0], [0, 181], ["37", -122], [null, 0], [undefined, undefined]]) {
      assert.equal(Tides.stationFor([SF], lat, lon, mode), null, mode + JSON.stringify([lat, lon]))
    }
  }
})

test("the cache never lets a nearby place borrow another's answer across the 100 km line", () => {
  const inside = { lat: SF.lat + 0.899, lon: SF.lon }
  const outside = { lat: SF.lat + 0.8994, lon: SF.lon }
  const km = p => Tides.distanceKm(p.lat, p.lon, SF.lat, SF.lon)
  assert.ok(km(inside) < 100 && km(outside) > 100, `${km(inside)} ${km(outside)}`)
  // Both call orders, in fresh index arrays so no earlier entry is reused.
  const a = [SF]
  assert.ok(Tides.stationFor(a, inside.lat, inside.lon, "auto") !== null)
  assert.equal(Tides.stationFor(a, outside.lat, outside.lon, "auto"), null)
  const b = [SF, { provider: "noaa", id: "ZZZ", name: "far away", lat: -80, lon: 0 }]
  assert.equal(Tides.stationFor(b, outside.lat, outside.lon, "auto"), null)
  assert.ok(Tides.stationFor(b, inside.lat, inside.lon, "auto") !== null)
  // The distance reported is that place's own.
  assert.ok(Math.abs(Tides.stationFor(a, inside.lat, inside.lon, "auto").km - km(inside)) < 1e-9)
  assert.ok(Math.abs(Tides.stationFor(a, outside.lat, outside.lon, "on").km - km(outside)) < 1e-9)
})

test("the choice is cached per place and mode, including no station", () => {
  const stations = [SF]
  const before = Tides.choiceCacheSize()
  const first = Tides.stationFor(stations, 37.71, -122.31, "auto")
  assert.equal(first, Tides.stationFor(stations, 37.71, -122.31, "auto"))
  assert.equal(Tides.choiceCacheSize(), before + 1)
  assert.equal(Tides.stationFor(stations, -33.91, 151.21, "auto"), null)
  assert.equal(Tides.stationFor(stations, -33.91, 151.21, "auto"), null)
  assert.equal(Tides.choiceCacheSize(), before + 2)
  // The same place under another mode is another question.
  Tides.stationFor(stations, -33.91, 151.21, "on")
  assert.equal(Tides.choiceCacheSize(), before + 3)
})

test("the choice cache stays bounded", () => {
  for (let i = 0; i < 400; i++) Tides.stationFor([SF], 10 + i / 100, 20, "auto")
  assert.ok(Tides.choiceCacheSize() <= 128)
})

// ---- the once-a-day cache -----------------------------------------------

const NOW = Date.UTC(2026, 9, 5, 12)
const HOUR = 3600 * 1000

test("with no entry a fetch is needed; within a day it is not; after a day it is", () => {
  const key = "noaa:9414290"
  let cache = Tides.parseCache("")
  assert.equal(Tides.needsFetch(cache, key, NOW), true)
  cache = Tides.withEntry(cache, key, [{ time: 1, type: "high", height: 1 }], NOW)
  assert.equal(Tides.needsFetch(cache, key, NOW + 23 * HOUR), false)
  assert.equal(Tides.needsFetch(cache, key, NOW + 24 * HOUR), true)
  assert.equal(Tides.needsFetch(cache, "noaa:other", NOW), true)
  assert.equal(Tides.needsFetch(cache, key, NOW - HOUR), false)
})

test("an entry from the future is not trusted", () => {
  const cache = Tides.withEntry(Tides.parseCache(""), "noaa:1", [], NOW)
  assert.equal(Tides.needsFetch(cache, "noaa:1", NOW - 3 * 24 * HOUR), true)
})

test("cache entries are kept per station", () => {
  let cache = Tides.withEntry(Tides.parseCache(""), "noaa:1", [{ time: 1, type: "high", height: 1 }], NOW)
  cache = Tides.withEntry(cache, "dfo:2", [{ time: 2, type: "low", height: 2 }], NOW)
  assert.deepEqual(Tides.eventsFor(cache, "noaa:1"), [{ time: 1, type: "high", height: 1 }])
  assert.deepEqual(Tides.eventsFor(cache, "dfo:2"), [{ time: 2, type: "low", height: 2 }])
  assert.equal(Tides.eventsFor(cache, "noaa:3"), null)
  assert.equal(Tides.eventsFor(null, "noaa:1"), null)
})

test("the cache survives a round trip and drops anything malformed", () => {
  let cache = Tides.withEntry(Tides.parseCache(""), "noaa:1", [{ time: 5, type: "high", height: 1.5 }], NOW)
  const back = Tides.parseCache(Tides.serializeCache(cache))
  assert.deepEqual(Tides.eventsFor(back, "noaa:1"), [{ time: 5, type: "high", height: 1.5 }])
  assert.equal(Tides.needsFetch(back, "noaa:1", NOW + HOUR), false)

  for (const bad of ["", "nope", "null", "[]", "42", "{}", '{"stations":[]}', '{"version":1,"stations":"x"}']) {
    assert.equal(Tides.eventsFor(Tides.parseCache(bad), "noaa:1"), null, bad)
  }
  const dirty = JSON.stringify({ version: 1, stations: {
    "noaa:1": { fetchedAt: NOW, events: [{ time: 5, type: "high", height: 1.5 }, { time: "x", type: "high", height: 1 },
      { time: 6, type: "sideways", height: 1 }, { time: 7, type: "low", height: null }, null] },
    "noaa:2": { fetchedAt: "yesterday", events: [] },
    "noaa:3": { fetchedAt: NOW, events: "none" },
    "bad key": { fetchedAt: NOW, events: [] },
    "noaa:4": null
  } })
  const parsed = Tides.parseCache(dirty)
  assert.deepEqual(Tides.eventsFor(parsed, "noaa:1"), [{ time: 5, type: "high", height: 1.5 }])
  for (const key of ["noaa:2", "noaa:3", "bad key", "noaa:4"]) assert.equal(Tides.eventsFor(parsed, key), null, key)
})

test("the cache keeps only the most recently fetched stations", () => {
  let cache = Tides.parseCache("")
  for (let i = 0; i < 30; i++) cache = Tides.withEntry(cache, "noaa:" + i, [], NOW + i * 1000)
  assert.equal(Tides.eventsFor(cache, "noaa:29") !== null, true)
  assert.equal(Tides.eventsFor(cache, "noaa:0"), null)
  assert.ok(Object.keys(cache.stations).length <= 12)
})

test("withEntry does not change the cache it was given", () => {
  const original = Tides.parseCache("")
  Tides.withEntry(original, "noaa:1", [], NOW)
  assert.equal(Tides.eventsFor(original, "noaa:1"), null)
})

// ---- a response answers only the question that was asked ----------------

test("a response is used only if its station is still the one wanted", () => {
  const asked = { key: "noaa:9414290" }
  assert.equal(Tides.isCurrent(asked, "noaa:9414290"), true)
  assert.equal(Tides.isCurrent(asked, "noaa:9414291"), false)
  assert.equal(Tides.isCurrent(asked, "dfo:9414290"), false)
  assert.equal(Tides.isCurrent(asked, ""), false)
  assert.equal(Tides.isCurrent(asked, null), false)
  assert.equal(Tides.isCurrent(null, "noaa:9414290"), false)
  assert.equal(Tides.isCurrent({}, "noaa:9414290"), false)
  assert.equal(Tides.isCurrent({ key: "" }, ""), false)
})

// ---- window and file path -----------------------------------------------

test("the request window covers every forecast day plus a day either side, in UTC", () => {
  const report = { utc_offset_seconds: PDT, daily: { time: ["2026-10-05", "2026-10-06", "2026-10-14"] } }
  const win = Tides.windowFor(report)
  // Local midnight 2026-10-05 in PDT is 07:00 UTC.
  assert.equal(win.fromMs, Date.UTC(2026, 9, 5, 7) - 24 * HOUR)
  assert.equal(win.toMs, Date.UTC(2026, 9, 14, 7) + 48 * HOUR)
})

test("no usable forecast days or offset means no window", () => {
  for (const bad of [null, {}, { daily: { time: [] }, utc_offset_seconds: 0 }, { daily: { time: ["2026-10-05"] } },
    { daily: { time: ["nope"] }, utc_offset_seconds: 0 }, { daily: { time: "x" }, utc_offset_seconds: 0 },
    { daily: { time: ["2026-10-05"] }, utc_offset_seconds: "0" }]) {
    assert.equal(Tides.windowFor(bad), null, JSON.stringify(bad))
  }
})


// ---- the card -------------------------------------------------------------

test("the day card carries tide rows when it is given a station", () => {
  const report = {
    utc_offset_seconds: PDT,
    daily: { time: ["2026-10-05"], temperature_2m_max: [20], temperature_2m_min: [10] }
  }
  const events = Tides.PROVIDERS.dfo.parse(fixture("dfo-07735-wlp-hilo.json"))
  const card = Detail.dayDetail(report, 0, false, false, undefined, { station: VANCOUVER, distanceKm: 3.2, events })
  assert.equal(card.tides.rows.length, 3)
  assert.equal(card.tides.station, "Vancouver · 3.2 km")
  assert.equal(Detail.dayDetail(report, 0, false, false).tides, null)
  assert.equal(Detail.dayDetail(report, 0, false, false, undefined, null).tides, null)
})

// ---- when to fetch: whenever the open forecast view has a station to show ------

const ready = () => ({ opened: true, view: "forecast", key: "noaa:9414290", cacheLoaded: true, running: false,
  retryAt: 0, cache: Tides.parseCache(""), now: NOW })

test("the panel opening on the forecast view with a station and no cached tides fetches", () => {
  assert.equal(Tides.wantsFetch(ready()), true)
})

test("it fetches without any day card being open", () => {
  // There is no day card in the state at all; opening the forecast is enough.
  assert.equal("detail" in ready(), false)
  assert.equal(Tides.wantsFetch(ready()), true)
})

test("no fetch while the panel is closed or showing settings", () => {
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { opened: false })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { view: "settings" })), false)
})

test("no fetch when tides are inactive: no station means an empty key", () => {
  for (const key of ["", null, undefined]) assert.equal(Tides.wantsFetch(Object.assign(ready(), { key })), false)
})

test("no fetch while the cache is fresh, one fetch once it is a day old", () => {
  const cache = Tides.withEntry(Tides.parseCache(""), "noaa:9414290", [{ time: 1, type: "high", height: 1 }], NOW - 3 * HOUR)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cache })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cache, now: NOW + 20 * HOUR })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cache, now: NOW + 21 * HOUR })), true)
  const other = Tides.withEntry(Tides.parseCache(""), "dfo:123", [], NOW)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cache: other })), true)
})

test("no fetch before the cache file has been read, while one is running, or during back-off", () => {
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cacheLoaded: false })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { running: true })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { retryAt: NOW + 1 })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { retryAt: NOW })), true)
})

test("a malformed state never fetches", () => {
  for (const bad of [null, undefined, {}, [], 5, "x"]) assert.equal(Tides.wantsFetch(bad), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { now: NaN })), false)
  assert.equal(Tides.wantsFetch(Object.assign(ready(), { cache: null })), true)
})

// ---- the one line of text below the hourly cards ------------------------------

const CDT_ZONE = -5 * 3600 // Weeks Bay, Alabama, in October
const WEEKS_BAY = { provider: "noaa", id: "8765148", name: "Weeks Bay", lat: 30.4, lon: -87.8 }
const weeksBayEvents = () => Tides.PROVIDERS.noaa.parse(fixture("noaa-8765148-gmt.json"))
const pick = (opts, key, fallback) => (key in opts ? opts[key] : fallback)
const line = (now, opts = {}) => Tides.nextLine(pick(opts, "station", WEEKS_BAY), pick(opts, "events", weeksBayEvents()), now,
  pick(opts, "zone", CDT_ZONE), pick(opts, "imperial", true), pick(opts, "twelve", true))

test("falling: the next event is a low", () => {
  // 12:00 local on 2026-10-05; the next event is the low at 21:34 local that evening.
  assert.equal(line(Date.UTC(2026, 9, 5, 17)), "TIDE · Weeks Bay · Falling · Low 9:34 PM (0.0 ft)")
})

test("rising: the next event is a high", () => {
  // 00:00 local; the next event is the high at 05:37 local.
  assert.equal(line(Date.UTC(2026, 9, 5, 5)), "TIDE · Weeks Bay · Rising · High 5:37 AM (1.6 ft)")
})

test("both clock settings", () => {
  assert.equal(line(Date.UTC(2026, 9, 5, 17), { twelve: false }), "TIDE · Weeks Bay · Falling · Low 21:34 (0.0 ft)")
  assert.equal(line(Date.UTC(2026, 9, 5, 5), { twelve: false }), "TIDE · Weeks Bay · Rising · High 05:37 (1.6 ft)")
})

test("both unit settings, one decimal", () => {
  assert.equal(line(Date.UTC(2026, 9, 5, 5), { imperial: false }), "TIDE · Weeks Bay · Rising · High 5:37 AM (0.5 m)")
  assert.equal(line(Date.UTC(2026, 9, 5, 17), { imperial: false }), "TIDE · Weeks Bay · Falling · Low 9:34 PM (0.0 m)")
  const big = [{ time: Date.UTC(2026, 9, 5, 18), type: "high", height: 12.04 }]
  assert.equal(line(Date.UTC(2026, 9, 5, 17), { events: big, imperial: false }), "TIDE · Weeks Bay · Rising · High 1:00 PM (12.0 m)")
  assert.equal(line(Date.UTC(2026, 9, 5, 17), { events: big }), "TIDE · Weeks Bay · Rising · High 1:00 PM (39.5 ft)")
})

test("a next event on a later local day carries the short weekday", () => {
  // 22:00 local on Mon Oct 5; the next event is the high at 06:00 local on Tue Oct 6.
  assert.equal(line(Date.UTC(2026, 9, 6, 3)), "TIDE · Weeks Bay · Rising · High Tue 6:00 AM (1.4 ft)")
  assert.equal(line(Date.UTC(2026, 9, 6, 3), { twelve: false }), "TIDE · Weeks Bay · Rising · High Tue 06:00 (1.4 ft)")
})

test("today is judged in the forecast's zone, not in UTC", () => {
  // 18:00 local on the 5th is already the 6th in UTC, and so is the event at 02:34Z; locally both are the 5th.
  assert.equal(line(Date.UTC(2026, 9, 5, 23)), "TIDE · Weeks Bay · Falling · Low 9:34 PM (0.0 ft)")
  // The same instants read in UTC would be the same day too, but an eastern zone moves the event to the next day.
  const east = line(Date.UTC(2026, 9, 5, 23), { zone: 10 * 3600 })
  assert.equal(east, "TIDE · Weeks Bay · Falling · Low 12:34 PM (0.0 ft)")
  const nextDayEast = line(Date.UTC(2026, 9, 5, 12), { zone: 10 * 3600 })
  assert.match(nextDayEast, /Low Tue 12:34 PM/)
})

test("across a clock change the line follows the zone's wall clock", () => {
  const zone = nyZone()
  const events = [{ time: Date.UTC(2026, 10, 1, 6, 30), type: "low", height: 0.5 }, { time: Date.UTC(2026, 10, 2, 5, 30), type: "high", height: 1.5 }]
  assert.equal(Tides.nextLine(SF, events, Date.UTC(2026, 10, 1, 4), zone, false, false), "TIDE · San Francisco · Falling · Low 01:30 (0.5 m)")
  assert.equal(Tides.nextLine(SF, events, Date.UTC(2026, 10, 1, 7), zone, false, false), "TIDE · San Francisco · Rising · High Mon 00:30 (1.5 m)")
})

test("the next event is strictly after now, whatever order the events come in", () => {
  const shuffled = weeksBayEvents().reverse()
  assert.equal(line(Date.UTC(2026, 9, 5, 5), { events: shuffled }), "TIDE · Weeks Bay · Rising · High 5:37 AM (1.6 ft)")
  // At the very instant of an event, that event is no longer next.
  assert.equal(line(Date.UTC(2026, 9, 5, 10, 37)), "TIDE · Weeks Bay · Falling · Low 9:34 PM (0.0 ft)")
  assert.match(line(Date.UTC(2026, 9, 5, 10, 36, 59)), /Rising · High 5:37 AM/)
})

test("no line when there is no event after now", () => {
  assert.equal(line(Date.UTC(2026, 9, 20)), "")
  assert.equal(line(Date.UTC(2026, 9, 7, 21, 49)), "")
  assert.equal(line(Date.UTC(2026, 9, 5), { events: [] }), "")
})

test("no line, and no throw, for missing or malformed inputs", () => {
  const now = Date.UTC(2026, 9, 5, 17)
  for (const events of [null, undefined, "x", 5, {}, [null, 7, "y", [], {}], [{ time: "x", type: "high", height: 1 }]]) {
    assert.equal(line(now, { events }), "", JSON.stringify(events))
  }
  for (const bad of [{ type: "sideways", height: 1 }, { type: "high", height: NaN }, { type: "high", height: "1" }, { type: "high", height: null }]) {
    assert.equal(line(now, { events: [Object.assign({ time: Date.UTC(2026, 9, 5, 20) }, bad)] }), "", JSON.stringify(bad))
  }
  assert.equal(line(NaN), "")
  assert.equal(line("x"), "")
  assert.equal(line(null), "")
  assert.equal(line(now, { zone: "x" }), "")
  assert.equal(line(now, { zone: null }), "")
})

test("an unusable event is skipped, the next good one is used", () => {
  const events = [{ time: Date.UTC(2026, 9, 5, 18), type: "high", height: NaN }, { time: Date.UTC(2026, 9, 5, 20), type: "low", height: 0.3 }]
  assert.equal(line(Date.UTC(2026, 9, 5, 17), { events }), "TIDE · Weeks Bay · Falling · Low 3:00 PM (1.0 ft)")
})

test("the station name is cleaned, and left out when unusable", () => {
  const now = Date.UTC(2026, 9, 5, 17)
  assert.match(line(now, { station: { name: "  Point Atkinson \n" } }), /^TIDE · Point Atkinson · Falling/)
  assert.match(line(now, { station: { name: "a\u0000b\u001fc" } }), /^TIDE · abc · Falling/)
  for (const station of [null, undefined, {}, { name: "" }, { name: "   " }, { name: 5 }, "Weeks Bay", []]) {
    assert.match(line(now, { station }), /^TIDE · Falling · Low 9:34 PM/, JSON.stringify(station))
  }
  assert.ok(line(now, { station: { name: "x".repeat(200) } }).length < 100)
})

test("the curve and its geometry are gone", () => {
  for (const gone of ["wave", "waveHeight", "waveLayout", "waveLabel", "markLabel", "waveMarkViews", "waveBandHeight", "hourEpochs",
    "heightIn", "sortedEvents", "MAX_WAVE_INTERVAL_MS", "MAX_WAVE_GAP_MS", "WAVE_BAND_TOP", "WAVE_BAND_BOTTOM"]) {
    assert.equal(Tides[gone], undefined, gone)
  }
})
