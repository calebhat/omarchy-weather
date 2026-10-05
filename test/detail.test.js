// Detail cards: forecast data plus an hour or day index become a plain object
// of display strings. Missing or malformed values are dashes, never zeros.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary } = require("./load.js")

const Detail = loadLibrary("Detail.js")
const Model = loadLibrary("Model.js")
const Moon = loadLibrary("Moon.js")

function report() {
  const times = []
  for (let h = 0; h < 24; h++) times.push("2026-10-05T" + String(h).padStart(2, "0") + ":00")
  for (let h = 0; h < 24; h++) times.push("2026-10-06T" + String(h).padStart(2, "0") + ":00")
  const fill = v => times.map(() => v)
  const precip = fill(0)
  precip[14] = 2.5
  precip[15] = 0.3
  return {
    hourly: {
      time: times,
      temperature_2m: fill(20),
      apparent_temperature: fill(18.4),
      precipitation_probability: fill(40),
      precipitation: precip,
      wind_speed_10m: fill(10),
      wind_gusts_10m: fill(25),
      wind_direction_10m: fill(225),
      relative_humidity_2m: fill(65),
      dew_point_2m: fill(12.4),
      cloud_cover: fill(80),
      pressure_msl: fill(1013.25),
      visibility: fill(24140),
      uv_index: fill(6.2)
    },
    daily: {
      time: ["2026-10-05", "2026-10-06"],
      temperature_2m_max: [22.4, 19],
      temperature_2m_min: [11.6, 9],
      apparent_temperature_max: [23, 18],
      apparent_temperature_min: [10.4, 7],
      precipitation_probability_max: [70, 20],
      precipitation_sum: [2.8, 0],
      wind_speed_10m_max: [30, 12],
      wind_gusts_10m_max: [50, 20],
      wind_direction_10m_dominant: [315, 90],
      uv_index_max: [6.2, 3],
      sunrise: ["2026-10-05T06:58", "2026-10-06T06:59"],
      sunset: ["2026-10-05T18:21", "2026-10-06T18:19"],
      daylight_duration: [41689.52, 41530.7]
    }
  }
}

const row = (card, key) => card.rows.find(r => r.key === key).value

test("compass names cover 16 points and wrap at north", () => {
  const cases = [[0, "N"], [11, "N"], [12, "NNE"], [45, "NE"], [90, "E"], [135, "SE"], [180, "S"],
    [225, "SW"], [270, "W"], [315, "NW"], [337, "NNW"], [348.75, "N"], [359, "N"], [360, "N"]]
  for (const [deg, name] of cases) assert.equal(Detail.compass(deg), name, String(deg))
})

test("compass is empty for missing, malformed or out-of-range degrees", () => {
  for (const bad of [null, undefined, NaN, Infinity, "90", [], {}, true, -1, 361]) {
    assert.equal(Detail.compass(bad), "", JSON.stringify(bad))
  }
})

test("hour card shows every field in metric", () => {
  const card = Detail.hourDetail(report(), 14, false, false)
  assert.equal(card.title, "Mon 14:00")
  assert.equal(row(card, "temp"), "20°")
  assert.equal(row(card, "feels"), "18°")
  assert.equal(row(card, "rainChance"), "40%")
  assert.equal(row(card, "rainAmount"), "2.5mm")
  assert.equal(row(card, "wind"), "10 km/h SW")
  assert.equal(row(card, "gusts"), "25 km/h")
  assert.equal(row(card, "humidity"), "65%")
  assert.equal(row(card, "dewPoint"), "12°")
  assert.equal(row(card, "cloud"), "80%")
  assert.equal(row(card, "pressure"), "1013 hPa")
  assert.equal(row(card, "visibility"), "24 km")
  assert.equal(row(card, "uv"), "6 High")
})

test("hour card shows every field in imperial with a 12-hour title", () => {
  const card = Detail.hourDetail(report(), 14, true, true)
  assert.equal(card.title, "Mon 2:00 PM")
  assert.equal(row(card, "temp"), "68°")
  assert.equal(row(card, "feels"), "65°")
  assert.equal(row(card, "rainAmount"), "0.10\"")
  assert.equal(row(card, "wind"), "6 mph SW")
  assert.equal(row(card, "gusts"), "16 mph")
  assert.equal(row(card, "dewPoint"), "54°")
  assert.equal(row(card, "pressure"), "29.92 inHg")
  assert.equal(row(card, "visibility"), "15 mi")
})

test("hour card dashes missing series and malformed values", () => {
  const r = report()
  delete r.hourly.apparent_temperature
  r.hourly.wind_speed_10m[3] = "10"
  r.hourly.wind_gusts_10m[3] = null
  r.hourly.relative_humidity_2m[3] = 140
  r.hourly.dew_point_2m = "oops"
  r.hourly.cloud_cover[3] = -5
  r.hourly.pressure_msl[3] = NaN
  r.hourly.visibility[3] = Infinity
  r.hourly.uv_index[3] = -1
  r.hourly.wind_direction_10m[3] = 400
  const card = Detail.hourDetail(r, 3, false, false)
  for (const key of ["feels", "gusts", "humidity", "dewPoint", "cloud", "pressure", "visibility", "uv"]) {
    assert.equal(row(card, key), "—", key)
  }
  assert.equal(row(card, "wind"), "—")
  assert.equal(row(card, "temp"), "20°")
})

test("wind with a speed but no direction shows the speed alone", () => {
  const r = report()
  r.hourly.wind_direction_10m[3] = null
  assert.equal(row(Detail.hourDetail(r, 3, false, false), "wind"), "10 km/h")
})

test("hour card for a bad index or report is null, not a crash", () => {
  assert.equal(Detail.hourDetail(report(), 999, false, false), null)
  assert.equal(Detail.hourDetail(report(), -1, false, false), null)
  assert.equal(Detail.hourDetail(report(), 1.5, false, false), null)
  assert.equal(Detail.hourDetail(null, 0, false, false), null)
  assert.equal(Detail.hourDetail({ hourly: { time: "nope" } }, 0, false, false), null)
})

test("day card shows every field in metric", () => {
  const card = Detail.dayDetail(report(), 0, false, false)
  assert.equal(card.title, "Mon Oct 5")
  assert.equal(row(card, "highLow"), "22° / 12°")
  assert.equal(row(card, "feelsRange"), "23° / 10°")
  assert.equal(row(card, "rainChance"), "70%")
  assert.equal(row(card, "rainTotal"), "2.8mm")
  assert.equal(row(card, "wind"), "30 km/h NW")
  assert.equal(row(card, "gusts"), "50 km/h")
  assert.equal(row(card, "uv"), "6 High")
  assert.equal(row(card, "sunrise"), "06:58")
  assert.equal(row(card, "sunset"), "18:21")
  assert.equal(row(card, "daylight"), "11h 35m")
})

test("day card in imperial with a 12-hour clock", () => {
  const card = Detail.dayDetail(report(), 0, true, true)
  assert.equal(row(card, "highLow"), "72° / 53°")
  assert.equal(row(card, "feelsRange"), "73° / 51°")
  assert.equal(row(card, "rainTotal"), "0.11\"")
  assert.equal(row(card, "wind"), "19 mph NW")
  assert.equal(row(card, "gusts"), "31 mph")
  assert.equal(row(card, "sunrise"), "6:58 AM")
  assert.equal(row(card, "sunset"), "6:21 PM")
})

test("day card rain strip is that day's 24 hours, with unknown hours kept unknown", () => {
  const r = report()
  r.hourly.precipitation[5] = "x"
  const strip = Detail.dayDetail(r, 0, false, false).rainStrip
  assert.equal(strip.length, 24)
  assert.equal(strip[14].mm, 2.5)
  assert.equal(strip[14].hour, 14)
  assert.equal(strip[0].mm, 0)
  assert.equal(strip[5].mm, null)
  assert.equal(strip[15].mm, 0.3)
  assert.equal(Detail.dayDetail(r, 1, false, false).rainStrip.length, 24)
})

test("a flood of samples for one hour makes exactly 24 slots, the first valid sample wins", () => {
  const r = report()
  const n = 40000
  r.hourly.time = r.hourly.time.concat(Array(n).fill("2026-10-05T00:00"))
  r.hourly.precipitation = r.hourly.precipitation.concat(Array(n).fill(9))
  const strip = Detail.dayDetail(r, 0, false, false).rainStrip
  assert.equal(strip.length, 24)
  assert.deepEqual(strip.map(s => s.hour), Array.from({ length: 24 }, (_, h) => h))
  assert.equal(strip[0].mm, 0)
})

test("a first sample that is invalid does not block a later valid one for that hour", () => {
  const r = report()
  r.hourly.time.push("2026-10-05T03:00")
  r.hourly.precipitation[3] = "x"
  r.hourly.precipitation.push(1.5)
  assert.equal(Detail.dayDetail(r, 0, false, false).rainStrip[3].mm, 1.5)
})

test("an hour with no sample is an empty slot, and bad hours are ignored", () => {
  const r = report()
  r.hourly.time[7] = "2026-10-05T25:00"
  r.hourly.time[8] = "2026-10-05Tab:00"
  const strip = Detail.dayDetail(r, 0, false, false).rainStrip
  assert.equal(strip.length, 24)
  assert.equal(strip[7].mm, null)
  assert.equal(strip[8].mm, null)
  assert.equal(strip[9].mm, 0)
})

test("day card heading is the weekday and a short date, or the caller's locale format", () => {
  assert.equal(Detail.dayDetail(report(), 0, false, false).title, "Mon Oct 5")
  assert.equal(Detail.dayDetail(report(), 1, false, false).title, "Tue Oct 6")
  const seen = []
  const card = Detail.dayDetail(report(), 0, false, false, d => { seen.push(d); return "lun. 5 oct." })
  assert.equal(card.title, "lun. 5 oct.")
  assert.equal(seen[0].getFullYear(), 2026)
  assert.equal(seen[0].getMonth(), 9)
  assert.equal(seen[0].getDate(), 5)
  assert.equal(Detail.dayDetail(report(), 0, false, false, () => 5).title, "Mon Oct 5")
})

test("day card with no hourly data has an empty strip", () => {
  const r = report()
  delete r.hourly
  assert.deepEqual(Detail.dayDetail(r, 0, false, false).rainStrip, [])
})

test("day card dashes missing and malformed values", () => {
  const r = report()
  r.daily.apparent_temperature_max[0] = null
  r.daily.wind_gusts_10m_max = "x"
  r.daily.uv_index_max[0] = NaN
  r.daily.sunrise[0] = ""
  r.daily.sunset = null
  r.daily.daylight_duration[0] = -5
  r.daily.precipitation_sum[0] = -1
  const card = Detail.dayDetail(r, 0, false, false)
  assert.equal(row(card, "feelsRange"), "— / 10°")
  assert.equal(row(card, "gusts"), "—")
  assert.equal(row(card, "uv"), "—")
  assert.equal(row(card, "sunrise"), "—")
  assert.equal(row(card, "sunset"), "—")
  assert.equal(row(card, "daylight"), "—")
  assert.equal(row(card, "rainTotal"), "—")
})

test("polar day and night say so instead of showing a dash", () => {
  const r = report()
  r.daily.sunrise[0] = null
  r.daily.sunset[0] = null
  r.daily.daylight_duration[0] = 86400
  let card = Detail.dayDetail(r, 0, false, false)
  assert.equal(row(card, "sunrise"), "Up all day")
  assert.equal(row(card, "sunset"), "Up all day")
  assert.equal(row(card, "daylight"), "24h 00m")
  r.daily.daylight_duration[0] = 0
  card = Detail.dayDetail(r, 0, false, false)
  assert.equal(row(card, "sunrise"), "Down all day")
  assert.equal(row(card, "daylight"), "0h 00m")
})

test("day card has no moon without a place, and leaves the tide slot empty", () => {
  const card = Detail.dayDetail(report(), 0, false, false)
  assert.ok("moon" in card && card.moon === null)
  assert.ok("tides" in card && card.tides === null)
})

test("day card carries the moon for the forecast's own place and zone", () => {
  const r = report()
  r.latitude = 39.74
  r.longitude = -104.99
  r.utc_offset_seconds = -21600
  const card = Detail.dayDetail(r, 0, false, true)
  assert.equal(card.moon.glyph, Moon.dayInfo("2026-10-05", 39.74, -104.99, -21600, true).glyph)
  assert.equal(card.moon.phase, "Waning Crescent · 26%")
  assert.deepEqual(card.moon.rows.map(x => x.key), ["moonrise", "moonset"])
  assert.match(card.moon.rows.find(x => x.key === "moonrise").value, /^1:\d\d AM$/)
  assert.match(card.moon.rows.find(x => x.key === "moonset").value, /^4:\d\d PM$/)
})

test("day card moon is polar-aware", () => {
  const r = report()
  r.daily.time[0] = "2026-12-24"
  r.latitude = 78.22
  r.longitude = 15.63
  r.utc_offset_seconds = 3600
  const moon = Detail.dayDetail(r, 0, false, false).moon
  assert.equal(moon.rows.find(x => x.key === "moonrise").value, "Up all day")
})

test("day card for a bad index is null", () => {
  assert.equal(Detail.dayDetail(report(), 2, false, false), null)
  assert.equal(Detail.dayDetail(null, 0, false, false), null)
})

const segments = (card, key) => card.rows.find(r => r.key === key).segments

test("hour card marks rain amount and UV with a tone, and nothing else", () => {
  const card = Detail.hourDetail(report(), 14, false, false)
  assert.deepEqual(segments(card, "rainAmount"), [{ text: "2.5mm", tone: "rainAmount" }])
  assert.deepEqual(segments(card, "uv"), [{ text: "6 High", tone: "uv2" }])
  for (const key of ["temp", "feels", "wind", "gusts", "humidity", "pressure", "visibility"]) {
    assert.equal(segments(card, key), undefined, key)
  }
})

test("UV tones follow the bands", () => {
  const r = report()
  const tone = uv => {
    r.hourly.uv_index[3] = uv
    return segments(Detail.hourDetail(r, 3, false, false), "uv")[0].tone
  }
  assert.deepEqual([0, 2, 3, 5, 6, 7, 8, 10, 11, 14].map(tone),
    ["uv0", "uv0", "uv1", "uv1", "uv2", "uv2", "uv3", "uv3", "uv4", "uv4"])
})

test("a missing amount or UV has no tone, so a dash is not coloured", () => {
  const r = report()
  r.hourly.precipitation[3] = null
  r.hourly.uv_index[3] = "x"
  const card = Detail.hourDetail(r, 3, false, false)
  assert.deepEqual(segments(card, "rainAmount"), [{ text: "—", tone: "" }])
  assert.deepEqual(segments(card, "uv"), [{ text: "—", tone: "" }])
})

test("day card colours the high warm and the low cool, in both ranges", () => {
  const card = Detail.dayDetail(report(), 0, false, false)
  assert.deepEqual(segments(card, "highLow"), [
    { text: "22°", tone: "tempHigh" }, { text: " / ", tone: "" }, { text: "12°", tone: "tempLow" }])
  assert.deepEqual(segments(card, "feelsRange").map(s => s.tone), ["tempHigh", "", "tempLow"])
  assert.equal(segments(card, "highLow").map(s => s.text).join(""), row(card, "highLow"))
  assert.equal(segments(card, "feelsRange").map(s => s.text).join(""), row(card, "feelsRange"))
})

test("a missing high or low is a dash with no tone", () => {
  const r = report()
  r.daily.temperature_2m_max[0] = null
  const parts = segments(Detail.dayDetail(r, 0, false, false), "highLow")
  assert.deepEqual(parts, [{ text: "—", tone: "" }, { text: " / ", tone: "" }, { text: "12°", tone: "tempLow" }])
})

test("day card marks rain total and UV with a tone", () => {
  const card = Detail.dayDetail(report(), 0, false, false)
  assert.deepEqual(segments(card, "rainTotal"), [{ text: "2.8mm", tone: "rainAmount" }])
  assert.deepEqual(segments(card, "uv"), [{ text: "6 High", tone: "uv2" }])
  assert.equal(segments(card, "wind"), undefined)
  assert.equal(segments(card, "sunrise"), undefined)
})

test("selecting an item opens it, the same item again closes it, another swaps", () => {
  const open = Detail.nextSelection(null, "hour", 5)
  assert.deepEqual(open, { kind: "hour", index: 5 })
  assert.deepEqual(Detail.nextSelection(open, "hour", 5), { kind: "", index: -1 })
  assert.deepEqual(Detail.nextSelection(open, "hour", 6), { kind: "hour", index: 6 })
  assert.deepEqual(Detail.nextSelection(open, "day", 5), { kind: "day", index: 5 })
  assert.deepEqual(Detail.nextSelection(open, "day", -1), { kind: "", index: -1 })
  assert.deepEqual(Detail.nextSelection(open, "week", 1), { kind: "", index: -1 })
})

test("report entries carry their report index for the cards", () => {
  const hours = Model.hourlyForecastToday(report(), "2026-10-05T10:00")
  assert.equal(hours[0].reportIndex, 10)
  const days = Model.dailyForecast(report(), "2026-10-05", 10)
  assert.deepEqual(days.map(d => d.reportIndex), [0, 1])
})
