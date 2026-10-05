// Time zones for the forecast place.
//
// Open-Meteo writes every time in a response in one fixed offset, the one in
// force when it was fetched, even when the days it covers cross a daylight-saving
// change. So the wall clock on each date comes from tz-transitions.json
// (scripts/build-tz-transitions.py) looked up by the response's IANA `timezone`.
// A zone that is not in the table, or that the table contradicts, keeps the
// response's single offset.
//
// A zone is { before, transitions: [{ utc, offset }], key } plus, for a zone from
// the table, `from` and `until` (the epoch ms the table covers) and `fallback`
// (the report's own offset, used outside that range): `before` is the offset
// ahead of the first transition, offsets are seconds east of UTC, `utc` is epoch
// ms, and `key` names it for caches. Outside the table's years a zone answers
// with the report's own offset.
.pragma library

var DAY_MS = 86400000
var MAX_OFFSET = 86400
var ZONE_NAME = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function isInteger(v) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v
}

function validOffset(v) {
  return typeof v === "number" && isFinite(v) && v >= -MAX_OFFSET && v <= MAX_OFFSET
}

function fixed(offsetSec) {
  if (!validOffset(offsetSec)) return null
  return { before: offsetSec, transitions: [], key: "f" + offsetSec }
}

function normalize(zoneOrOffset) {
  if (typeof zoneOrOffset === "number") return fixed(zoneOrOffset)
  if (isObject(zoneOrOffset) && validOffset(zoneOrOffset.before) && Array.isArray(zoneOrOffset.transitions)
      && typeof zoneOrOffset.key === "string") return zoneOrOffset
  return null
}

// The zone as consecutive [start, end) segments, each with one offset. Outside
// the table's covered range there is one segment in the report's own offset.
function segments(zone) {
  if (zone.segs) return zone.segs
  var hasRange = typeof zone.from === "number" && typeof zone.until === "number"
  var fallback = hasRange && validOffset(zone.fallback) ? zone.fallback : null
  var segs = []
  var cursor = -Infinity
  var current = zone.before
  if (fallback !== null) {
    segs.push({ start: -Infinity, end: zone.from, offset: fallback })
    cursor = zone.from
  }
  for (var i = 0; i < zone.transitions.length; i++) {
    segs.push({ start: cursor, end: zone.transitions[i].utc, offset: current })
    cursor = zone.transitions[i].utc
    current = zone.transitions[i].offset
  }
  segs.push({ start: cursor, end: fallback !== null ? zone.until : Infinity, offset: current })
  if (fallback !== null) segs.push({ start: zone.until, end: Infinity, offset: fallback })
  zone.segs = segs
  return segs
}

function offsetAt(zoneOrOffset, ms) {
  var zone = normalize(zoneOrOffset)
  if (zone === null) return null
  var segs = segments(zone)
  for (var i = 0; i < segs.length; i++) {
    if (ms >= segs[i].start && ms < segs[i].end) return segs[i].offset
  }
  return segs[segs.length - 1].offset
}

// tz-transitions.json text -> { "Zone/Name": { before, transitions, key } }.
// Rows that are not well-formed are dropped.
function parseTable(text) {
  var out = {}
  var body
  try {
    body = JSON.parse(String(text))
  } catch (e) {
    return out
  }
  if (!isObject(body) || !isObject(body.zones)) return out
  var years = body.from
  var last = body.to
  if (!isInteger(years) || !isInteger(last) || years > last || years < 1900 || last > 3000) return out
  for (var name in body.zones) {
    var row = body.zones[name]
    if (!ZONE_NAME.test(name) || !Array.isArray(row) || row.length < 3 || row.length % 2 === 0) continue
    var ok = validOffset(row[0])
    var transitions = []
    var previous = -Infinity
    for (var i = 1; ok && i < row.length; i += 2) {
      var minute = row[i]
      var offset = row[i + 1]
      if (typeof minute !== "number" || !isFinite(minute) || minute <= previous || !validOffset(offset)) ok = false
      else transitions.push({ utc: minute * 60000, offset: offset })
      previous = minute
    }
    if (ok) {
      out[name] = {
        before: row[0], transitions: transitions, key: name + "|" + row.length + "|" + row[1],
        from: Date.UTC(years, 0, 1), until: Date.UTC(last + 1, 0, 1), fallback: null
      }
    }
  }
  return out
}

// The zone for a forecast report. The table is used only when it knows the
// report's `timezone` and agrees with the report's own offset at `nowMs`. It is
// trusted for every date inside the years it covers; the report's own offset
// covers any date outside them. Otherwise the report's single offset stands.
// Null if the report has none. (A table nearing its end is flagged by the
// Python staleness test, not here, so it keeps working until it runs out.)
function forReport(report, table, nowMs) {
  if (!isObject(report) || !validOffset(report.utc_offset_seconds)) return null
  var plain = fixed(report.utc_offset_seconds)
  var name = report.timezone
  if (typeof name !== "string" || !ZONE_NAME.test(name) || !isObject(table) || !table.hasOwnProperty(name)) return plain
  var source = table[name]
  var zone = {
    before: source.before, transitions: source.transitions, from: source.from, until: source.until,
    fallback: report.utc_offset_seconds, key: source.key + "|" + report.utc_offset_seconds
  }
  return offsetAt(zone, nowMs) === report.utc_offset_seconds ? zone : plain
}

// A copy of the report that carries its zone.
function attach(report, zone) {
  if (!isObject(report)) return null
  var copy = {}
  for (var key in report) copy[key] = report[key]
  copy.zone = zone
  return copy
}

// The report's zone: the attached one, or its single offset.
function of(report) {
  if (!isObject(report)) return null
  return normalize(report.zone) || fixed(report.utc_offset_seconds)
}

// A QML file URL as a filesystem path ("" if it cannot be one).
function localPath(url) {
  if (typeof url !== "string") return ""
  if (url.indexOf("file://") !== 0) return url
  try {
    return decodeURIComponent(url.slice(7))
  } catch (e) {
    return ""
  }
}

function parseDate(dateString) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateString === "string" ? dateString : "")
  if (!m) return null
  var utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  var back = new Date(utc)
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null
  return utc
}

function nextDate(dateString) {
  var utc = parseDate(dateString)
  if (utc === null) return null
  var d = new Date(utc + DAY_MS)
  return d.getUTCFullYear() + "-" + (d.getUTCMonth() < 9 ? "0" : "") + (d.getUTCMonth() + 1)
    + "-" + (d.getUTCDate() < 10 ? "0" : "") + d.getUTCDate()
}

// The instant a local calendar date begins: the first instant whose local date
// is that date, as epoch ms (null for a bad date or zone). Where midnight is
// repeated (clocks go back at midnight) that is the earlier one; where it is
// skipped (clocks go forward at midnight) it is the moment of the change.
function midnight(zoneOrOffset, dateString) {
  var zone = normalize(zoneOrOffset)
  var wall = parseDate(dateString)
  if (zone === null || wall === null) return null
  var segs = segments(zone)
  var best = null
  for (var i = 0; i < segs.length; i++) {
    var t = wall - segs[i].offset * 1000
    if (t >= segs[i].start && t < segs[i].end && (best === null || t < best)) best = t
  }
  if (best !== null) return best
  for (var j = 0; j < segs.length; j++) {
    if (isFinite(segs[j].start) && segs[j].start + segs[j].offset * 1000 >= wall) return segs[j].start
  }
  return wall - segs[segs.length - 1].offset * 1000
}

// "HH:MM" on the wall clock at an instant, rounded to the minute.
function clock(zoneOrOffset, ms) {
  var offset = offsetAt(zoneOrOffset, ms)
  if (offset === null || typeof ms !== "number" || !isFinite(ms)) return ""
  var minutes = Math.round((ms + offset * 1000) / 60000)
  var inDay = ((minutes % 1440) + 1440) % 1440
  var h = Math.floor(inDay / 60)
  var m = inDay % 60
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m
}
