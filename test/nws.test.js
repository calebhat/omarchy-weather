// The corroboration gate: what the local forecast office is allowed to do to a
// model reading, and — more importantly — what it is never allowed to do.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { RadarModel } = require("./load.js")

const SEVERE = 4
const HEAVY = 3
const MODERATE = 2

const covered = extra => Object.assign(
  { supported: true, fresh: true, alertLevel: 0, alertEvent: "", maxPop: 80 }, extra)

// --- the observed false alarm ------------------------------------------------

test("a lone model spike is suppressed when the office expects almost nothing", () => {
  // 2026-09-06 over Atlanta: the model put 5 mm into one quarter-hour slot and
  // called it severe; NWS Peachtree City had 27% and no alert in force.
  const verdict = RadarModel.corroborate(SEVERE, covered({ maxPop: 27 }))
  assert.equal(verdict.level, 0)
  assert.equal(verdict.source, "suppressed")
})

test("a possible-but-not-likely afternoon is capped below the alert threshold", () => {
  const verdict = RadarModel.corroborate(SEVERE, covered({ maxPop: 40 }))
  assert.equal(verdict.level, MODERATE)
  assert.equal(verdict.source, "downgraded")
  assert.ok(verdict.level < HEAVY, "must sit under the default Heavy threshold")
})

test("a model reading the office agrees with passes through untouched", () => {
  const verdict = RadarModel.corroborate(SEVERE, covered({ maxPop: 85 }))
  assert.equal(verdict.level, SEVERE)
  assert.equal(verdict.source, "model")
})

// --- never mute --------------------------------------------------------------
//
// Every one of these is a way the second source can be absent. An absent
// source declines to help; it must never be read as "no weather".

for (const [name, nws] of [
  ["outside NWS coverage", covered({ supported: false, maxPop: 0 })],
  ["data too old to trust", covered({ fresh: false, maxPop: 0 })],
  ["no opinion in the response", covered({ maxPop: -1 })],
  ["no data at all", null],
]) {
  test(`a severe model reading survives ${name}`, () => {
    assert.equal(RadarModel.corroborate(SEVERE, nws).level, SEVERE)
  })
}

// --- the office can raise as well as lower -----------------------------------

test("a warning in force raises a reading the coarse model missed", () => {
  const verdict = RadarModel.corroborate(0, covered({
    alertLevel: 4, alertEvent: "Severe Thunderstorm Warning", maxPop: 20 }))
  assert.equal(verdict.level, SEVERE)
  assert.equal(verdict.source, "nws")
  assert.equal(verdict.event, "Severe Thunderstorm Warning")
})

test("a warning never lowers a worse model reading", () => {
  const verdict = RadarModel.corroborate(SEVERE, covered({
    alertLevel: 2, alertEvent: "Flood Advisory", maxPop: 10 }))
  assert.equal(verdict.level, SEVERE)
})

// --- reading the alerts feed -------------------------------------------------

test("a heat advisory is not a forecast of rain", () => {
  // Live response shape from api.weather.gov for Atlanta, 2026-09-06.
  const feed = { features: [{ properties: {
    event: "Heat Advisory",
    headline: "Heat Advisory issued September 6 at 3:21AM EDT by NWS Peachtree City GA" } }] }
  assert.equal(RadarModel.nwsAlertOutlook(feed).level, 0)
})

test("the worst precipitation alert in force is the one that counts", () => {
  const feed = { features: [
    { properties: { event: "Heat Advisory" } },
    { properties: { event: "Flood Advisory" } },
    { properties: { event: "Severe Thunderstorm Warning" } },
  ] }
  const outlook = RadarModel.nwsAlertOutlook(feed)
  assert.equal(outlook.level, SEVERE)
  assert.equal(outlook.event, "Severe Thunderstorm Warning")
})

test("an empty feed is silence, not a verdict", () => {
  assert.equal(RadarModel.nwsAlertOutlook({ features: [] }).level, 0)
  assert.equal(RadarModel.nwsAlertOutlook(null).level, 0)
})

// --- reading the hourly grid -------------------------------------------------

test("probability is peaked across the lead window only", () => {
  const grid = { properties: { periods: [
    { probabilityOfPrecipitation: { value: 27 } },
    { probabilityOfPrecipitation: { value: 22 } },
    { probabilityOfPrecipitation: { value: 90 } },   // beyond a two-hour window
  ] } }
  assert.equal(RadarModel.nwsMaxPop(grid, 2), 27)
  assert.equal(RadarModel.nwsMaxPop(grid, 3), 90)
})

test("a missing probability is skipped rather than counted as zero", () => {
  const grid = { properties: { periods: [
    { probabilityOfPrecipitation: { value: null } },
    { probabilityOfPrecipitation: { value: 65 } },
  ] } }
  assert.equal(RadarModel.nwsMaxPop(grid, 2), 65)
})

test("no periods means no opinion, which is not zero", () => {
  assert.equal(RadarModel.nwsMaxPop({ properties: { periods: [] } }, 2), -1)
  assert.equal(RadarModel.nwsMaxPop(null, 2), -1)
})

// --- request construction ----------------------------------------------------

test("coordinates are rounded to what the service accepts without redirecting", () => {
  assert.equal(RadarModel.nwsPointsUrl(33.8800000001, -84.36),
    "https://api.weather.gov/points/33.8800,-84.3600")
})

test("every NWS request identifies itself and stays bounded", () => {
  const command = RadarModel.nwsCurlGet("https://api.weather.gov/x", 12, 1024)
  assert.ok(command.includes("--compressed"))
  assert.ok(command.some(a => a.startsWith("User-Agent: ")))
  assert.deepEqual(command.slice(-1), ["https://api.weather.gov/x"])
  assert.ok(command.includes("--max-filesize") && command.includes("1024"))
  assert.ok(command.includes("--max-time") && command.includes("12"))
  assert.equal(command.filter(a => a === "https://api.weather.gov/x").length, 1)
})

test("a point outside the United States is not covered", () => {
  assert.equal(RadarModel.parseNwsPoints({}).supported, false)
  assert.equal(RadarModel.parseNwsPoints(null).supported, false)
  // Anything not served by api.weather.gov itself is refused rather than fetched.
  assert.equal(RadarModel.parseNwsPoints(
    { properties: { forecastHourly: "https://elsewhere.example/x" } }).supported, false)
})

test("a covered point yields the office's own hourly grid", () => {
  const parsed = RadarModel.parseNwsPoints({ properties: {
    forecastHourly: "https://api.weather.gov/gridpoints/FFC/51,93/forecast/hourly" } })
  assert.equal(parsed.supported, true)
  assert.equal(parsed.hourlyUrl, "https://api.weather.gov/gridpoints/FFC/51,93/forecast/hourly")
})
