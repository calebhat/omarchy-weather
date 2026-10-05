// Time zones. Open-Meteo prints every time in a response in one fixed offset, so
// per-date wall clock comes from tz-transitions.json (generated from the system
// tz database by scripts/build-tz-transitions.py).
//
// Live check, 2026-10-05: forecast for Sydney with past_days=3 gave
// sunrise "2026-10-03T06:30" and "2026-10-04T06:28" with utc_offset_seconds
// 39600 -- the real sunrise on Oct 3 (UTC+10) is about 05:30, so the response
// does not follow the daylight-saving change that happened on Oct 4.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync, statSync } = require("node:fs")
const { join } = require("node:path")
const { loadLibrary } = require("./load.js")

const Zone = loadLibrary("Zone.js")

const TABLE_PATH = join(__dirname, "..", "tz-transitions.json")
const table = () => Zone.parseTable(readFileSync(TABLE_PATH, "utf8"))
const H = 3600 * 1000

function newYork() {
  const report = { timezone: "America/New_York", utc_offset_seconds: -14400 }
  return Zone.forReport(report, table(), Date.UTC(2026, 9, 26))
}

test("the table is small and parses to named zones", () => {
  assert.ok(statSync(TABLE_PATH).size < 80 * 1024)
  const zones = table()
  assert.ok(zones["America/New_York"] && zones["Australia/Sydney"] && zones["Europe/London"])
  assert.equal(zones["Asia/Kathmandu"], undefined)
})

test("US daylight-saving ends on Nov 1 2026 at 06:00 UTC", () => {
  const zone = newYork()
  assert.equal(Zone.offsetAt(zone, Date.UTC(2026, 10, 1, 5, 59)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(2026, 10, 1, 6, 0)), -18000)
  assert.equal(Zone.offsetAt(zone, Date.UTC(2026, 9, 26)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(2026, 11, 25)), -18000)
})

test("a southern zone springs forward on Oct 4 2026 and Lord Howe moves by half an hour", () => {
  const syd = Zone.forReport({ timezone: "Australia/Sydney", utc_offset_seconds: 39600 }, table(), Date.UTC(2026, 9, 5))
  assert.equal(Zone.offsetAt(syd, Date.UTC(2026, 9, 3, 15, 59)), 36000)
  assert.equal(Zone.offsetAt(syd, Date.UTC(2026, 9, 3, 16, 0)), 39600)
  const lh = Zone.forReport({ timezone: "Australia/Lord_Howe", utc_offset_seconds: 39600 }, table(), Date.UTC(2026, 9, 5))
  assert.equal(Zone.offsetAt(lh, Date.UTC(2026, 6, 1)), 37800)
})

test("midnight of a date uses the offset in force then, and day lengths follow", () => {
  const zone = newYork()
  assert.equal(Zone.midnight(zone, "2026-10-26"), Date.UTC(2026, 9, 26, 4))
  assert.equal(Zone.midnight(zone, "2026-11-01"), Date.UTC(2026, 10, 1, 4))
  assert.equal(Zone.midnight(zone, "2026-11-02"), Date.UTC(2026, 10, 2, 5))
  // Nov 1 is 25 hours long.
  assert.equal((Zone.midnight(zone, "2026-11-02") - Zone.midnight(zone, "2026-11-01")) / H, 25)
  assert.equal((Zone.midnight(zone, "2026-03-09") - Zone.midnight(zone, "2026-03-08")) / H, 23)
})

// ---- N1: a date begins at the first instant whose local date is that date ----

const tableZone = (name, offset, nowMs) => Zone.forReport({ timezone: name, utc_offset_seconds: offset }, table(), nowMs)
const NOW = Date.UTC(2026, 9, 5)

test("a repeated midnight (Havana, Nov 1 2026) starts the date at the earlier instant", () => {
  const havana = tableZone("America/Havana", -14400, NOW)
  assert.equal(Zone.midnight(havana, "2026-11-01"), Date.UTC(2026, 10, 1, 4))
  assert.equal(Zone.clock(havana, Zone.midnight(havana, "2026-11-01")), "00:00")
  // The date after starts at the second midnight's 05:00Z in CST.
  assert.equal(Zone.midnight(havana, "2026-11-02"), Date.UTC(2026, 10, 2, 5))
  // So a tide at 04:30Z belongs to Nov 1, not Oct 31.
  assert.ok(Date.UTC(2026, 10, 1, 4, 30) >= Zone.midnight(havana, "2026-11-01"))
  assert.ok(Date.UTC(2026, 10, 1, 4, 30) < Zone.midnight(havana, "2026-11-02"))
  assert.equal(Zone.midnight(havana, "2026-10-31"), Date.UTC(2026, 9, 31, 4))
})

test("a skipped midnight (Santiago, Sep 6 2026) starts the date at the transition", () => {
  const santiago = tableZone("America/Santiago", -10800, Date.UTC(2026, 8, 20))
  // Chile moved from UTC-4 to UTC-3 at 04:00Z, skipping 00:00-01:00 local.
  assert.equal(Zone.midnight(santiago, "2026-09-06"), Date.UTC(2026, 8, 6, 4))
  assert.equal(Zone.clock(santiago, Zone.midnight(santiago, "2026-09-06")), "01:00")
  assert.equal(Zone.midnight(santiago, "2026-09-05"), Date.UTC(2026, 8, 5, 4))
  assert.equal(Zone.midnight(santiago, "2026-09-07"), Date.UTC(2026, 8, 7, 3))
  assert.equal((Zone.midnight(santiago, "2026-09-07") - Zone.midnight(santiago, "2026-09-06")) / H, 23)
})

test("an ordinary transition (New York, Nov 1, 02:00 local) still gives the 25-hour day", () => {
  const zone = newYork()
  assert.equal(Zone.midnight(zone, "2026-11-01"), Date.UTC(2026, 10, 1, 4))
  assert.equal(Zone.midnight(zone, "2026-11-02"), Date.UTC(2026, 10, 2, 5))
  assert.equal(Zone.midnight(zone, "2026-03-08"), Date.UTC(2026, 2, 8, 5))
  assert.equal(Zone.midnight(zone, "2026-03-09"), Date.UTC(2026, 2, 9, 4))
})

test("a half-hour zone (Lord Howe) and a fixed quarter-hour zone get the right midnights", () => {
  const lh = tableZone("Australia/Lord_Howe", 39600, NOW)
  // Oct 4 2026: +10:30 until 02:00 local, then +11.
  assert.equal(Zone.midnight(lh, "2026-10-04"), Date.UTC(2026, 9, 3, 13, 30))
  assert.equal(Zone.midnight(lh, "2026-10-05"), Date.UTC(2026, 9, 4, 13))
  assert.equal(Zone.clock(lh, Date.UTC(2026, 9, 3, 15, 29)), "01:59")
  assert.equal(Zone.clock(lh, Date.UTC(2026, 9, 3, 15, 30)), "02:30")
  const nepal = Zone.forReport({ timezone: "Asia/Kathmandu", utc_offset_seconds: 20700 }, table(), NOW)
  assert.equal(Zone.midnight(nepal, "2026-10-05"), Date.UTC(2026, 9, 5) - 20700 * 1000)
  assert.equal(Zone.midnight(20700, "2026-10-05"), Date.UTC(2026, 9, 5) - 20700 * 1000)
})

test("every date of every zone in the table begins at midnight or just after a skipped one", () => {
  const zones = table()
  let checked = 0
  for (const name of Object.keys(zones)) {
    const zone = zones[name]
    for (const t of zone.transitions.slice(0, 6)) {
      for (const delta of [-2, -1, 0, 1]) {
        const date = new Date(t.utc + delta * 86400000).toISOString().slice(0, 10)
        const start = Zone.midnight(zone, date)
        const clock = Zone.clock(zone, start)
        // Either exactly 00:00, or a skipped midnight so the first minute is later that same day.
        assert.ok(clock === "00:00" || clock < "06:00", `${name} ${date} starts at ${clock}`)
        // The date really is that date at its first instant, and not at the minute before.
        const day = new Date(start + Zone.offsetAt(zone, start) * 1000).toISOString().slice(0, 10)
        assert.equal(day, date, `${name} ${date}`)
        const prev = new Date(start - 1 + Zone.offsetAt(zone, start - 1) * 1000).toISOString().slice(0, 10)
        assert.ok(prev < date, `${name} ${date} minute before is ${prev}`)
        checked++
      }
    }
  }
  assert.ok(checked > 1000)
})

// ---- N2: the table covers a range and expires -------------------------------

const range = () => JSON.parse(readFileSync(TABLE_PATH, "utf8"))

test("the table records the years it covers", () => {
  const { from, to } = range()
  assert.ok(Number.isInteger(from) && Number.isInteger(to) && to - from >= 6)
})

test("outside the covered years the zone gives the response's own offset, not the last table offset", () => {
  const { from, to } = range()
  const zone = tableZone("America/New_York", -14400, NOW)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to + 1, 6, 1)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to + 5, 0, 15)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(from - 1, 0, 15)), -14400)
  // Inside the range the table still decides.
  assert.equal(Zone.offsetAt(zone, Date.UTC(from + 1, 0, 15)), -18000)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to, 6, 1)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to, 0, 15)), -18000)
})

test("a date outside the range is a plain day in the response's offset", () => {
  const { to } = range()
  const zone = tableZone("America/New_York", -14400, NOW)
  assert.equal(Zone.midnight(zone, `${to + 1}-07-01`), Date.UTC(to + 1, 6, 1, 4))
})

test("at runtime the table is trusted for every date inside its covered range, even in its last year", () => {
  const { to } = range()
  const endsAt = Date.UTC(to + 1, 0, 1)
  // A forecast fetched in the final summer (EDT), looking at dates after the clocks go back.
  for (const now of [Date.UTC(to, 0, 15), Date.UTC(to, 6, 1), endsAt - 400 * 86400000, endsAt - 200 * 86400000, endsAt - 86400000]) {
    const base = Zone.offsetAt(newYorkAt(now), now)
    const zone = Zone.forReport({ timezone: "America/New_York", utc_offset_seconds: base }, table(), now)
    assert.equal(Zone.offsetAt(zone, Date.UTC(to, 6, 1)), -14400, `summer, now ${new Date(now).toISOString()}`)
    assert.equal(Zone.offsetAt(zone, Date.UTC(to, 10, 15)), -18000, `after the change, now ${new Date(now).toISOString()}`)
    assert.equal(Zone.midnight(zone, `${to}-11-15`), Date.UTC(to, 10, 15, 5))
  }
})

// What New York's offset is at a given instant in the table's covered years.
function newYorkAt(now) {
  return table()["America/New_York"]
}

test("outside the covered range the report's own offset is used, however the table ends", () => {
  const { to } = range()
  const zone = Zone.forReport({ timezone: "America/New_York", utc_offset_seconds: -14400 }, table(), Date.UTC(to, 6, 1))
  assert.equal(Zone.offsetAt(zone, Date.UTC(to + 1, 0, 15)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to + 1, 10, 15)), -14400)
  assert.equal(Zone.offsetAt(zone, Date.UTC(to, 11, 31, 23, 59)), -18000)
})

test("the early-warning expiry is not part of the runtime code", () => {
  assert.equal(Zone.tableExpired, undefined)
})

test("a table whose range is missing is not used at all", () => {
  assert.deepEqual(Zone.parseTable(JSON.stringify({ zones: { "A/Good": [0, 100, 3600] } })), {})
  assert.deepEqual(Zone.parseTable(JSON.stringify({ from: "x", to: 2030, zones: { "A/Good": [0, 100, 3600] } })), {})
  assert.deepEqual(Zone.parseTable(JSON.stringify({ from: 2030, to: 2020, zones: { "A/Good": [0, 100, 3600] } })), {})
})

test("clock reads the wall time at that instant, across the change", () => {
  const zone = newYork()
  assert.equal(Zone.clock(zone, Date.UTC(2026, 10, 2, 4, 30)), "23:30")
  assert.equal(Zone.clock(zone, Date.UTC(2026, 10, 1, 4, 30)), "00:30")
  assert.equal(Zone.clock(zone, Date.UTC(2026, 10, 1, 6, 30)), "01:30")
})

test("the response's own offset is used when the zone is unknown, absent or stale", () => {
  const report = { timezone: "Asia/Kathmandu", utc_offset_seconds: 20700 }
  const zone = Zone.forReport(report, table(), Date.UTC(2026, 9, 5))
  assert.equal(Zone.offsetAt(zone, Date.UTC(2026, 11, 1)), 20700)
  for (const r of [{ utc_offset_seconds: -14400 }, { timezone: "Nowhere/Land", utc_offset_seconds: -14400 },
    { timezone: 5, utc_offset_seconds: -14400 }, { timezone: "../../etc/passwd", utc_offset_seconds: -14400 }]) {
    assert.equal(Zone.offsetAt(Zone.forReport(r, table(), Date.UTC(2026, 9, 5)), Date.UTC(2026, 10, 2)), -14400)
  }
  // A table that disagrees with the response about the current offset is not trusted.
  const wrong = Zone.forReport({ timezone: "America/New_York", utc_offset_seconds: -3600 }, table(), Date.UTC(2026, 9, 5))
  assert.equal(Zone.offsetAt(wrong, Date.UTC(2026, 10, 2)), -3600)
})

test("no usable offset means no zone", () => {
  for (const bad of [null, undefined, {}, { utc_offset_seconds: "x" }, { utc_offset_seconds: NaN }, { utc_offset_seconds: 1e9 }]) {
    assert.equal(Zone.forReport(bad, table(), 0), null, JSON.stringify(bad))
    assert.equal(Zone.of(bad), null)
  }
})

test("a zone is made from a number, or passed through", () => {
  assert.equal(Zone.offsetAt(Zone.normalize(-21600), 0), -21600)
  const z = newYork()
  assert.equal(Zone.normalize(z), z)
  for (const bad of ["x", NaN, null, {}, { base: "1", transitions: [] }, 1e9]) assert.equal(Zone.normalize(bad), null)
})

test("a report carries its zone, and Zone.of finds it or falls back to the fixed offset", () => {
  const report = { timezone: "America/New_York", utc_offset_seconds: -14400, latitude: 40.7 }
  const zoned = Zone.attach(report, newYork())
  assert.equal(Zone.of(zoned), zoned.zone)
  assert.equal(zoned.latitude, 40.7)
  assert.equal(report.zone, undefined)
  assert.equal(Zone.offsetAt(Zone.of(report), Date.UTC(2026, 10, 2)), -14400)
  assert.equal(Zone.attach(null, newYork()), null)
})

test("a malformed table parses to nothing, and bad rows are dropped", () => {
  for (const bad of ["", "nope", "null", "[]", "{}", '{"zones":[]}', '{"zones":"x"}']) assert.deepEqual(Zone.parseTable(bad), {})
  const dirty = JSON.stringify({ from: 2026, to: 2032, zones: {
    "A/Good": [0, 100, 3600],
    "B/Odd": [0, 100],
    "C/String": [0, "100", 3600],
    "D/Huge": [0, 100, 1e9],
    "E/Unsorted": [0, 200, 3600, 100, 0],
    "bad name!": [0, 100, 3600],
    "F/Null": null
  } })
  assert.deepEqual(Object.keys(Zone.parseTable(dirty)), ["A/Good"])
})

test("a file URL becomes a path", () => {
  assert.equal(Zone.localPath("file:///home/tim/.config/omarchy/plugins/x/tz-transitions.json"),
    "/home/tim/.config/omarchy/plugins/x/tz-transitions.json")
  assert.equal(Zone.localPath("file:///a%20b/c.json"), "/a b/c.json")
  assert.equal(Zone.localPath("/already/a/path.json"), "/already/a/path.json")
  assert.equal(Zone.localPath("file:///bad%zz"), "")
  assert.equal(Zone.localPath(""), "")
  assert.equal(Zone.localPath(null), "")
})

test("next date rolls month and year", () => {
  assert.equal(Zone.nextDate("2026-10-31"), "2026-11-01")
  assert.equal(Zone.nextDate("2026-12-31"), "2027-01-01")
  assert.equal(Zone.nextDate("2028-02-28"), "2028-02-29")
  assert.equal(Zone.nextDate("nope"), null)
})
