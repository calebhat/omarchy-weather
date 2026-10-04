// A downloaded response can claim any `length` it likes. The parsers must only
// loop over real arrays, or a tiny payload can make them build 100,000 rows.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary, RadarModel } = require("./load.js")

const Model = loadLibrary("Model.js")

// Claims a huge length and throws if anything indexes into it, so a parser
// that loops over it fails at once instead of quietly building empty rows.
const FAKE = new Proxy({ length: 1e9 }, {
  get(target, key) {
    if (typeof key === "string" && /^\d+$/.test(key)) throw new Error(`indexed fake collection at ${key}`)
    return target[key]
  }
})
// A fake that has been through JSON is a plain object; its loop is caught by
// the empty result instead.
const FAKE_JSON = { length: 100000 }
const NOW = "2026-10-04T10:00"

test("minutelyPrecipForecast ignores a fake-length time series", () => {
  assert.deepEqual(Model.minutelyPrecipForecast({ minutely_15: { time: FAKE } }, 7200), [])
})

test("minutelyPrecipForecast still reads a real array", () => {
  const soon = new Date(Date.now() + 900 * 1000).toISOString().slice(0, 16)
  const out = Model.minutelyPrecipForecast({
    utc_offset_seconds: 0,
    minutely_15: { time: [soon], precipitation: [1.5], precipitation_probability: [40] }
  }, 7200)
  assert.equal(out.length, 1)
  assert.equal(out[0].precipMm, 1.5)
  assert.equal(out[0].precipProb, "40")
})

test("hourlyForecastToday ignores a fake-length time series", () => {
  assert.deepEqual(Model.hourlyForecastToday({ hourly: { time: FAKE } }, NOW), [])
})

test("hourlyForecastToday still reads a real array", () => {
  const out = Model.hourlyForecastToday({
    hourly: {
      time: ["2026-10-04T09:00", "2026-10-04T11:00", "2026-10-05T01:00"],
      temperature_2m: [10, 20, 5]
    }
  }, NOW)
  assert.equal(out.length, 1)
  assert.equal(out[0].tempC, "20")
})

test("hourlyForecast ignores a fake-length time series", () => {
  assert.deepEqual(Model.hourlyForecast({ hourly: { time: FAKE } }, NOW), [])
})

test("hourlyForecast still reads a real array", () => {
  const out = Model.hourlyForecast({
    hourly: { time: ["2026-10-04T09:00", "2026-10-04T11:00"], temperature_2m: [10, 20] }
  }, NOW)
  assert.equal(out.length, 1)
  assert.equal(out[0].tempC, "20")
})

test("dailyForecast ignores a fake-length time series", () => {
  assert.deepEqual(Model.dailyForecast({ daily: { time: FAKE } }, "2026-10-04", 5), [])
})

test("dailyForecast still reads a real array", () => {
  const out = Model.dailyForecast({
    daily: { time: ["2026-10-04", "2026-10-05"], temperature_2m_max: [20, 22] }
  }, "2026-10-04", 5)
  assert.equal(out.length, 2)
  assert.equal(out[0].isToday, true)
  assert.equal(out[1].maxC, "22")
})

test("openMeteoForecastDays ignores a fake-length time series", () => {
  assert.deepEqual(Model.openMeteoForecastDays({ daily: { time: FAKE } }, "2026-10-04"), [])
})

test("openMeteoForecastDays still reads a real array", () => {
  const out = Model.openMeteoForecastDays({
    daily: { time: ["2026-10-04", "2026-10-05"], temperature_2m_max: [20, 22] }
  }, "2026-10-04")
  assert.equal(out.length, 1)
  assert.equal(out[0].date, "2026-10-05")
})

test("parseGeocodingResults ignores a fake-length results list", () => {
  assert.deepEqual(Model.parseGeocodingResults(JSON.stringify({ results: FAKE_JSON })), [])
})

test("parseGeocodingResults still reads a real array", () => {
  const out = Model.parseGeocodingResults(JSON.stringify({
    results: [{ name: "Paris", latitude: 48.8, longitude: 2.3, country: "France" }]
  }))
  assert.equal(out.length, 1)
  assert.equal(out[0].name, "Paris")
})

test("wttrNextForecastDays ignores a fake-length weather list", () => {
  assert.deepEqual(Model.wttrNextForecastDays({ weather: FAKE }, "2026-10-04"), [])
})

test("wttrNextForecastDays still reads a real array", () => {
  const days = [{ date: "2026-10-04" }, { date: "2026-10-05" }]
  assert.deepEqual(Model.wttrNextForecastDays({ weather: days }, "2026-10-04"), [days[1]])
})

test("dayIcon ignores a fake-length hourly list", () => {
  assert.equal(Model.dayIcon({ hourly: FAKE }), "")
})

test("dayIcon still reads a real array", () => {
  const day = { hourly: [{ time: "1200", weatherCode: 113 }] }
  assert.equal(Model.dayIcon(day), Model.iconForCode(113, false))
})

test("nwsAlertOutlook ignores a fake-length features list", () => {
  assert.deepEqual(RadarModel.nwsAlertOutlook({ features: FAKE }), { level: 0, event: "" })
})

test("nwsAlertOutlook still reads a real array", () => {
  const out = RadarModel.nwsAlertOutlook({
    features: [{ properties: { event: "Flash Flood Warning" } }]
  })
  assert.ok(out.level > 0)
  assert.equal(out.event, "Flash Flood Warning")
})

test("nwsMaxPop ignores a fake-length periods list", () => {
  const data = { properties: { periods: FAKE } }
  assert.equal(RadarModel.nwsMaxPop(data, 100000), -1)
})

test("nwsMaxPop still reads a real array", () => {
  const data = { properties: { periods: [
    { probabilityOfPrecipitation: { value: 20 } },
    { probabilityOfPrecipitation: { value: 60 } }
  ] } }
  assert.equal(RadarModel.nwsMaxPop(data, 2), 60)
})
