// Rain amounts next to rain chances: a 60% hour with 0.01" and a 60% hour
// with half an inch are different days, and the panel has to say which.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary } = require("./load.js")

const Model = loadLibrary("Model.js")

const report = {
  hourly: {
    time: ["2026-10-04T10:00", "2026-10-04T11:00", "2026-10-04T12:00", "2026-10-05T00:00"],
    temperature_2m: [24, 25, 26, 22],
    precipitation_probability: [10, 40, 70, 5],
    precipitation: [0, 0.3, 12.7, 0],
    weather_code: [3, 61, 63, 3],
    is_day: [1, 1, 1, 0]
  },
  daily: {
    time: ["2026-10-04", "2026-10-05"],
    weather_code: [63, 3],
    temperature_2m_max: [26, 28],
    temperature_2m_min: [21, 20],
    precipitation_probability_max: [70, 5],
    precipitation_sum: [13.0, 0]
  }
}

test("hourly entries carry the forecast rain amount in millimetres", () => {
  const hours = Model.hourlyForecastToday(report, "2026-10-04T11:00")
  assert.deepEqual(hours.map(h => h.precipMm), [0.3, 12.7])
})

test("daily entries carry the day's rain total in millimetres", () => {
  const days = Model.dailyForecast(report, "2026-10-04", 10)
  assert.deepEqual(days.map(d => d.precipMm), [13, 0])
})

test("a report without amounts leaves them unknown, not dry", () => {
  const bare = JSON.parse(JSON.stringify(report))
  delete bare.hourly.precipitation
  delete bare.daily.precipitation_sum
  assert.equal(Model.hourlyForecastToday(bare, "2026-10-04T11:00")[0].precipMm, null)
  assert.equal(Model.dailyForecast(bare, "2026-10-04", 10)[0].precipMm, null)
  assert.equal(Model.formatPrecipAmount(null, true), "—")
  assert.equal(Model.formatPrecipAmount(undefined, false), "—")
})

test("imperial amounts are inches with the inch mark", () => {
  assert.equal(Model.formatPrecipAmount(0, true), "0\"")
  assert.equal(Model.formatPrecipAmount(0.1, true), "<0.01\"")
  assert.equal(Model.formatPrecipAmount(1.0, true), "0.04\"")
  assert.equal(Model.formatPrecipAmount(12.7, true), "0.50\"")
  assert.equal(Model.formatPrecipAmount(300, true), "11.8\"")
})

test("metric amounts are millimetres", () => {
  assert.equal(Model.formatPrecipAmount(0, false), "0mm")
  assert.equal(Model.formatPrecipAmount(0.04, false), "<0.1mm")
  assert.equal(Model.formatPrecipAmount(0.3, false), "0.3mm")
  assert.equal(Model.formatPrecipAmount(12.66, false), "12.7mm")
  assert.equal(Model.formatPrecipAmount(123.4, false), "123mm")
})

test("malformed or negative amounts are unknown, never dry", () => {
  for (const bad of [false, true, [], [1], {}, "", "0", -1, NaN, Infinity]) {
    assert.equal(Model.amountMm([bad], 0), null, `amountMm(${JSON.stringify(bad)})`)
    assert.equal(Model.formatPrecipAmount(bad, false), "—", `format(${JSON.stringify(bad)})`)
  }
})
