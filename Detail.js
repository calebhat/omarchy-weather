// Detail cards: a forecast report plus an hour or day index become a plain
// object of display strings for HourDetail.qml and DayDetail.qml. Everything in
// the report is downloaded data, so a value is used only when it is a finite
// number in a plausible range; anything else is a dash, never zero.
.pragma library
.import "Model.js" as Model
.import "Moon.js" as Moon
.import "Tides.js" as Tides
.import "Zone.js" as Zone

var DASH = "—"
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

// Finite number at series[i] within [min, max], else null.
function num(series, i, min, max) {
  if (!Array.isArray(series)) return null
  var v = series[i]
  if (typeof v !== "number" || !isFinite(v)) return null
  if (v < min || v > max) return null
  return v
}

function compass(deg) {
  if (typeof deg !== "number" || !isFinite(deg) || deg < 0 || deg > 360) return ""
  return COMPASS[Math.round(deg / 22.5) % 16]
}

function temp(c, useImperial) {
  if (c === null) return DASH
  return Math.round(useImperial ? c * 9 / 5 + 32 : c) + "°"
}

function percent(v) {
  return v === null ? DASH : Math.round(v) + "%"
}

function speed(kmh, useImperial) {
  if (kmh === null) return DASH
  return useImperial ? Math.round(kmh * 0.621371) + " mph" : Math.round(kmh) + " km/h"
}

function pressure(hpa, useImperial) {
  if (hpa === null) return DASH
  return useImperial ? (hpa * 0.02953).toFixed(2) + " inHg" : Math.round(hpa) + " hPa"
}

function visibility(m, useImperial) {
  if (m === null) return DASH
  var v = useImperial ? m / 1609.344 : m / 1000
  return (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) + (useImperial ? " mi" : " km")
}

function uv(v) {
  if (v === null) return DASH
  var info = Model.uvInfo(v)
  return Math.round(v) + (info ? " " + info.label : "")
}

function withDirection(speedText, deg) {
  if (speedText === DASH) return DASH
  var dir = compass(deg)
  return dir ? speedText + " " + dir : speedText
}

function duration(seconds) {
  if (seconds === null) return DASH
  var minutes = Math.round(seconds / 60)
  return Math.floor(minutes / 60) + "h " + Model.pad2(minutes % 60) + "m"
}

// Sunrise or sunset text. Open-Meteo leaves them out when the sun does not
// cross the horizon, and the day length says which way it stayed.
function sunEvent(iso, daylightSec, twelveHour) {
  var hhmm = typeof iso === "string" ? Model.timeOf(iso) : ""
  if (hhmm) return Model.formatClock(hhmm, twelveHour, false)
  if (daylightSec !== null && daylightSec >= 86400) return "Up all day"
  if (daylightSec === 0) return "Down all day"
  return DASH
}

function weekday(dateString) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString || ""))
  if (!m) return ""
  // UTC keeps the weekday of the written date whatever zone this runs in.
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()]
}

function row(key, label, value) {
  return { key: key, label: label, value: value }
}

function validIndex(list, i) {
  return Array.isArray(list) && typeof i === "number" && i >= 0 && i < list.length && Math.floor(i) === i
}

// Which card is open after an item is clicked: the same item closes it,
// another item swaps it, so only one is ever open.
function nextSelection(current, kind, index) {
  var closed = { kind: "", index: -1 }
  if (kind !== "hour" && kind !== "day") return closed
  if (typeof index !== "number" || !isFinite(index) || index < 0) return closed
  if (current && current.kind === kind && current.index === index) return closed
  return { kind: kind, index: index }
}

function hourDetail(report, i, useImperial, twelveHour) {
  var h = report && report.hourly
  if (!h || !validIndex(h.time, i)) return null

  var t = String(h.time[i])
  var clock = Model.formatClock(Model.timeOf(t), twelveHour, false)
  var title = (weekday(t) + " " + clock).replace(/^\s+/, "")
  var chance = num(h.precipitation_probability, i, 0, 100)

  return {
    title: title,
    rows: [
      row("temp", "Temperature", temp(num(h.temperature_2m, i, -100, 100), useImperial)),
      row("feels", "Feels like", temp(num(h.apparent_temperature, i, -100, 100), useImperial)),
      row("rainChance", "Rain chance", percent(chance)),
      row("rainAmount", "Rain amount", Model.formatPrecipAmount(Model.amountMm(h.precipitation, i), useImperial)),
      row("wind", "Wind", withDirection(speed(num(h.wind_speed_10m, i, 0, 500), useImperial),
        num(h.wind_direction_10m, i, 0, 360))),
      row("gusts", "Gusts", speed(num(h.wind_gusts_10m, i, 0, 500), useImperial)),
      row("humidity", "Humidity", percent(num(h.relative_humidity_2m, i, 0, 100))),
      row("dewPoint", "Dew point", temp(num(h.dew_point_2m, i, -100, 100), useImperial)),
      row("cloud", "Cloud cover", percent(num(h.cloud_cover, i, 0, 100))),
      row("pressure", "Pressure", pressure(num(h.pressure_msl, i, 800, 1100), useImperial)),
      row("visibility", "Visibility", visibility(num(h.visibility, i, 0, 1000000), useImperial)),
      row("uv", "UV index", uv(num(h.uv_index, i, 0, 20)))
    ]
  }
}

// The day's rain amounts as exactly 24 slots, hour 0 to 23. A slot takes the
// first usable sample for its hour; repeats are ignored, so a response with
// thousands of samples for one hour still draws 24 bars. An hour with no usable
// sample stays null so the strip can leave a gap rather than draw a dry hour.
function rainStrip(report, date) {
  var h = report && report.hourly
  if (!h || !Array.isArray(h.time)) return []
  var out = []
  for (var hour = 0; hour < 24; hour++) out.push({ hour: hour, mm: null })
  for (var i = 0; i < h.time.length; i++) {
    var t = h.time[i]
    if (typeof t !== "string" || t.slice(0, 10) !== date) continue
    var hr = /^\d{2}:00/.test(t.slice(11)) ? parseInt(t.slice(11, 13), 10) : -1
    if (hr < 0 || hr > 23 || out[hr].mm !== null) continue
    out[hr].mm = Model.amountMm(h.precipitation, i)
  }
  return out
}

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "Mon Oct 5". A caller can supply a formatter for a Date at local noon of that
// day (the panel passes Qt's locale-aware one); a result that is not a
// non-empty string is ignored.
function dayTitle(date, formatDate) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return date
  if (typeof formatDate === "function") {
    var text = formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
    if (typeof text === "string" && text !== "") return text
  }
  return (weekday(date) + " " + MONTHS[Number(m[2]) - 1] + " " + Number(m[3])).replace(/^\s+/, "")
}

function moonDetail(report, date, twelveHour) {
  var day = Moon.reportDay(report, date, twelveHour)
  if (!day) return null
  return {
    glyph: day.glyph,
    phase: day.name + " · " + day.percent + "%",
    rows: [
      row("moonrise", "Moonrise", day.riseText),
      row("moonset", "Moonset", day.setText)
    ]
  }
}

// formatDate is an optional locale formatter for the heading. tideInfo is
// { station, distanceKm, events } from the panel, or null when tides are off or
// no station is in range.
function dayDetail(report, i, useImperial, twelveHour, formatDate, tideInfo) {
  var d = report && report.daily
  if (!d || !validIndex(d.time, i)) return null

  var date = String(d.time[i])
  var daylight = num(d.daylight_duration, i, 0, 86400)
  var range = function(hi, lo) { return temp(hi, useImperial) + " / " + temp(lo, useImperial) }

  return {
    title: dayTitle(date, formatDate),
    rows: [
      row("highLow", "High / low", range(num(d.temperature_2m_max, i, -100, 100), num(d.temperature_2m_min, i, -100, 100))),
      row("feelsRange", "Feels like", range(num(d.apparent_temperature_max, i, -100, 100), num(d.apparent_temperature_min, i, -100, 100))),
      row("rainChance", "Rain chance", percent(num(d.precipitation_probability_max, i, 0, 100))),
      row("rainTotal", "Rain total", Model.formatPrecipAmount(Model.amountMm(d.precipitation_sum, i), useImperial)),
      row("wind", "Max wind", withDirection(speed(num(d.wind_speed_10m_max, i, 0, 500), useImperial),
        num(d.wind_direction_10m_dominant, i, 0, 360))),
      row("gusts", "Max gusts", speed(num(d.wind_gusts_10m_max, i, 0, 500), useImperial)),
      row("uv", "UV index", uv(num(d.uv_index_max, i, 0, 20))),
      row("sunrise", "Sunrise", sunEvent(Array.isArray(d.sunrise) ? d.sunrise[i] : null, daylight, twelveHour)),
      row("sunset", "Sunset", sunEvent(Array.isArray(d.sunset) ? d.sunset[i] : null, daylight, twelveHour)),
      row("daylight", "Daylight", duration(daylight))
    ],
    rainStrip: rainStrip(report, date),
    moon: moonDetail(report, date, twelveHour),
    tides: Tides.dayTides(tideInfo, date, Zone.of(report), useImperial, twelveHour)
  }
}
