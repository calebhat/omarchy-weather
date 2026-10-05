// Moon phase, illumination, rise and set, computed locally. Reference values
// are from the US Naval Observatory's API (aa.usno.navy.mil/api), fetched
// 2026-10-05:
//   moon/phases/date?date=2026-9-1&nump=12   New Moon 2026-10-10 15:50 UT,
//                                            Full Moon 2026-10-26 04:12 UT,
//                                            Last Quarter 2026-10-03 13:25 UT
//   rstt/oneday 2026-10-05 Denver (tz -6)    rise 01:21, set 16:09
//   rstt/oneday 2026-10-05 Sydney (tz +11)   rise 03:05, set 13:15
//   rstt/oneday 78.2232,15.6267 (tz +1)      2026-12-24 continuously above the
//                                            horizon, 100% Full Moon;
//                                            2026-12-10 continuously below it

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary } = require("./load.js")

const Moon = loadLibrary("Moon.js")

const MIN = 60 * 1000
const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

test("a known new moon is about 0% illuminated and named New Moon", () => {
  const at = Moon.illuminationAt(Date.UTC(2026, 9, 10, 15, 50))
  assert.ok(at.fraction < 0.01, `fraction ${at.fraction}`)
  assert.equal(Moon.phaseName(at.phase), "New Moon")
})

test("a known full moon is about 100% illuminated and named Full Moon", () => {
  for (const when of [Date.UTC(2026, 9, 26, 4, 12), Date.UTC(2026, 11, 24, 12, 0)]) {
    const at = Moon.illuminationAt(when)
    assert.ok(at.fraction > 0.99, `fraction ${at.fraction}`)
    assert.equal(Moon.phaseName(at.phase), "Full Moon")
  }
})

test("a known last quarter is about half lit and named Last Quarter", () => {
  const at = Moon.illuminationAt(Date.UTC(2026, 9, 3, 13, 25))
  assert.ok(Math.abs(at.fraction - 0.5) < 0.03, `fraction ${at.fraction}`)
  assert.equal(Moon.phaseName(at.phase), "Last Quarter")
})

test("the eight phase names follow the cycle and wrap", () => {
  const names = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map(Moon.phaseName)
  assert.deepEqual(names, ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
    "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent", "New Moon"])
  assert.equal(Moon.phaseName(0.03), "New Moon")
  assert.equal(Moon.phaseName(0.04), "Waxing Crescent")
  assert.equal(Moon.phaseName(0.96), "Waning Crescent")
  assert.equal(Moon.phaseName(0.97), "New Moon")
  assert.equal(Moon.phaseName(0.806), "Waning Crescent")
})

test("mid-latitude moonrise and moonset match the Naval Observatory within 7 minutes", () => {
  const day = Moon.dayInfo("2026-10-05", 39.7392, -104.9903, -6 * 3600, false)
  assert.ok(Math.abs(minutesOf(day.rise) - minutesOf("01:21")) <= 7,`rise ${day.rise}`)
  assert.ok(Math.abs(minutesOf(day.set) - minutesOf("16:09")) <= 7,`set ${day.set}`)
  assert.equal(day.status, "")
  assert.equal(day.name, "Waning Crescent")
})

test("the Naval Observatory's Sydney day is also a waning crescent", () => {
  const day = Moon.dayInfo("2026-10-05", -33.8688, 151.2093, 11 * 3600, false)
  assert.equal(day.name, "Waning Crescent")
  assert.ok(Math.abs(day.percent - 34) <= 3, `percent ${day.percent}`)
})

test("southern-hemisphere rise and set match the Naval Observatory within 7 minutes", () => {
  const day = Moon.dayInfo("2026-10-05", -33.8688, 151.2093, 11 * 3600, false)
  assert.ok(Math.abs(minutesOf(day.rise) - minutesOf("03:05")) <= 7,`rise ${day.rise}`)
  assert.ok(Math.abs(minutesOf(day.set) - minutesOf("13:15")) <= 7,`set ${day.set}`)
})

test("times are shown in the location's clock, 12 or 24 hour", () => {
  const day = Moon.dayInfo("2026-10-05", 39.7392, -104.9903, -6 * 3600, true)
  assert.match(day.rise, /^1:2\d AM$/)
  assert.match(day.set, /^4:(0[3-9]|1\d|2[0-3]) PM$/)
})

// New York across the end of daylight-saving time (Nov 1 2026, 06:00 UTC). The
// forecast was fetched on Oct 26, so its single offset is EDT, -4h. Reference,
// US Naval Observatory rstt/oneday coords=40.7128,-74.006, fetched 2026-10-05:
//   2026-10-31 (tz -4) set 13:30, rise 22:59
//   2026-11-01 (tz -5) set 13:07, rise 23:14
//   2026-11-02 (tz -5) set 13:37, no rise that day
const { readFileSync } = require("node:fs")
const { join } = require("node:path")
const Zone = loadLibrary("Zone.js")
const NY_REPORT = { latitude: 40.7128, longitude: -74.006, timezone: "America/New_York", utc_offset_seconds: -14400 }
function nyZone() {
  const table = Zone.parseTable(readFileSync(join(__dirname, "..", "tz-transitions.json"), "utf8"))
  return Zone.forReport(NY_REPORT, table, Date.UTC(2026, 9, 26))
}
const nyDay = date => Moon.dayInfo(date, 40.7128, -74.006, nyZone(), false)
// SunCalc is low precision: at 40.7N moonrise ran 9-11 minutes early here, moonset 0-4 off.
const near = (text, hhmm, tolerance = 7) => Math.abs(minutesOf(text) - minutesOf(hhmm)) <= tolerance

test("New York before the change reads in EDT", () => {
  const day = nyDay("2026-10-31")
  assert.ok(near(day.set, "13:30"), day.set)
  assert.ok(near(day.rise, "22:59", 12), day.rise)
})

test("the day the clocks go back is read in the offset in force, not the fetch-time one", () => {
  const day = nyDay("2026-11-01")
  assert.ok(near(day.set, "13:07"), `set ${day.set}`)
  assert.ok(near(day.rise, "23:14", 12), `rise ${day.rise}`)
})

test("the day after has the moonset an hour earlier than a fixed EDT offset would say, and no moonrise", () => {
  const day = nyDay("2026-11-02")
  assert.ok(near(day.set, "13:37"), `set ${day.set}`)
  assert.equal(day.rise, "")
  assert.equal(day.riseText, "—")
  // The old single-offset reading, for contrast: an hour late.
  const fixed = Moon.dayInfo("2026-11-02", 40.7128, -74.006, -14400, false)
  assert.ok(Math.abs(minutesOf(fixed.set) - minutesOf("13:37")) >= 50, fixed.set)
})

test("a report carries its zone, so reportDay follows it", () => {
  const zoned = Zone.attach(NY_REPORT, nyZone())
  assert.ok(near(Moon.reportDay(zoned, "2026-11-02", false).set, "13:37"))
  assert.ok(!near(Moon.reportDay(NY_REPORT, "2026-11-02", false).set, "13:37"))
})

test("a moonrise or moonset in the 25-hour day is not lost, and none lands on the wrong day", () => {
  const first = nyDay("2026-11-01")
  const next = nyDay("2026-11-02")
  assert.notEqual(first.rise, "")
  assert.equal(next.rise, "")
})

test("the cache tells zones apart", () => {
  const a = Moon.dayCore("2026-11-02", 40.7128, -74.006, nyZone())
  const b = Moon.dayCore("2026-11-02", 40.7128, -74.006, -14400)
  assert.notEqual(a, b)
  assert.equal(a, Moon.dayCore("2026-11-02", 40.7128, -74.006, nyZone()))
})

test("polar night with the moon up all day says Up all day", () => {
  const day = Moon.dayInfo("2026-12-24", 78.2232, 15.6267, 3600, false)
  assert.equal(day.status, "Up all day")
  assert.equal(day.riseText, "Up all day")
  assert.equal(day.setText, "Up all day")
  assert.equal(day.name, "Full Moon")
  assert.ok(day.percent >= 99)
})

test("polar night with the moon down all day says Down all day", () => {
  const day = Moon.dayInfo("2026-12-10", 78.2232, 15.6267, 3600, false)
  assert.equal(day.status, "Down all day")
  assert.equal(day.riseText, "Down all day")
  assert.equal(day.setText, "Down all day")
})

test("a day with a rise but no set shows a dash for the set, not zero", () => {
  const day = Moon.dayInfo("2026-12-17", 78.2232, 15.6267, 3600, false)
  assert.equal(day.status, "")
  assert.match(day.riseText, /^\d\d:\d\d$/)
  assert.equal(day.setText, "—")
})

test("the glyph is mirrored in the southern hemisphere", () => {
  const north = Moon.glyph(0.125, 40)
  const south = Moon.glyph(0.125, -34)
  assert.notEqual(north, south)
  assert.equal(south, Moon.glyph(0.875, 40))
  assert.equal(Moon.glyph(0.5, 40), Moon.glyph(0.5, -34))
  assert.equal(Moon.glyph(0, 40), Moon.glyph(0, -34))
  assert.equal(new Set([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(p => Moon.glyph(p, 40))).size, 8)
})

test("percent is a whole number from 0 to 100", () => {
  const day = Moon.dayInfo("2026-10-05", 39.7392, -104.9903, -6 * 3600, false)
  assert.equal(day.percent, Math.round(day.percent))
  assert.ok(day.percent >= 0 && day.percent <= 100)
  assert.ok(Math.abs(day.percent - 26) <= 3, `percent ${day.percent}`)
})

test("bad coordinates, offsets or dates give no moon, not a made-up one", () => {
  const bad = [
    ["2026-10-05", NaN, 0, 0], ["2026-10-05", 91, 0, 0], ["2026-10-05", 0, 181, 0],
    ["2026-10-05", "40", 0, 0], ["2026-10-05", null, 0, 0], ["2026-10-05", 40, -105, "x"],
    ["2026-10-05", 40, -105, Infinity], ["nope", 40, -105, 0], ["", 40, -105, 0], [null, 40, -105, 0],
    ["2026-13-45", 40, -105, 0]
  ]
  for (const args of bad) assert.equal(Moon.dayInfo(...args, false), null, JSON.stringify(args))
})

test("a report supplies its own place and offset; one without them has no moon", () => {
  const report = { latitude: 39.74, longitude: -104.99, utc_offset_seconds: -21600 }
  const day = Moon.reportDay(report, "2026-10-05", false)
  assert.equal(day.name, "Waning Crescent")
  for (const broken of [null, {}, { latitude: 39, longitude: -105 }, { latitude: "39", longitude: -105, utc_offset_seconds: 0 }]) {
    assert.equal(Moon.reportDay(broken, "2026-10-05", false), null)
  }
})

test("the same date and place is computed once", () => {
  const first = Moon.dayCore("2026-10-06", 39.7392, -104.9903, -6 * 3600)
  const again = Moon.dayCore("2026-10-06", 39.7392, -104.9903, -6 * 3600)
  assert.equal(first, again)
  assert.notEqual(first, Moon.dayCore("2026-10-06", 39.7392, -104.9903, -7 * 3600))
})

test("the cache stays bounded", () => {
  for (let i = 0; i < 400; i++) Moon.dayCore("2026-10-05", 10 + i / 100, 20, 0)
  assert.ok(Moon.cacheSize() <= 128)
})
