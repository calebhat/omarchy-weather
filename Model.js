// Caps on remote bodies. Timeouts do not stop a fast oversized response
// from filling RAM; curl --max-filesize honours Content-Length, and the
// collectors still refuse anything over the cap before JSON.parse.
var MAX_JSON_BYTES = 1048576
var MAX_PLACE_NAME_BYTES = 4096

function curlGet(url, maxTimeSec, maxBytes) {
  var cap = parseInt(maxBytes, 10)
  if (!isFinite(cap) || cap < 1) cap = MAX_JSON_BYTES
  var secs = parseInt(maxTimeSec, 10)
  if (!isFinite(secs) || secs < 1) secs = 5
  return ["curl", "-fsS", "--max-time", String(secs), "--max-filesize", String(cap), url]
}

function rejectOversized(raw, maxBytes) {
  var cap = parseInt(maxBytes, 10)
  if (!isFinite(cap) || cap < 1) cap = MAX_JSON_BYTES
  return String(raw || "").length > cap
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n
}

function isoLocalToEpoch(iso, offsetSec) {
  var s = String(iso || "").replace(" ", "T")
  if (s.length < 16) return 0
  var utcGuess = Date.parse(s + "Z")
  if (!isFinite(utcGuess)) return 0
  var off = Number(offsetSec)
  if (!isFinite(off)) off = 0
  return Math.floor(utcGuess / 1000) - off
}

// Upcoming 15-minute precipitation at this location (Open-Meteo).
function minutelyPrecipForecast(report, horizonSec) {
  var m = report && report.minutely_15
  if (!m || !m.time) return []
  var nowEpoch = Math.floor(Date.now() / 1000)
  var horizon = parseInt(horizonSec, 10)
  if (!isFinite(horizon) || horizon < 1) horizon = 7200
  var offset = report.utc_offset_seconds
  var out = []
  for (var i = 0; i < m.time.length; i++) {
    var epoch = isoLocalToEpoch(m.time[i], offset)
    if (!isFinite(epoch) || epoch <= 0) continue
    if (epoch <= nowEpoch) continue
    if (epoch > nowEpoch + horizon) break
    var mm = m.precipitation ? Number(m.precipitation[i]) : 0
    if (!isFinite(mm)) mm = 0
    out.push({
      time: epoch,
      path: "",
      kind: "forecast",
      precipMm: mm,
      precipProb: m.precipitation_probability ? roundedTemp(m.precipitation_probability[i]) : ""
    })
  }
  return out
}

// Open-Meteo hourly stamps are in the location timezone (timezone=auto).
function nowIsoForReport(report, fallbackIso) {
  var offset = report && report.utc_offset_seconds
  if (offset === undefined || offset === null || !isFinite(Number(offset)))
    return fallbackIso
  var shifted = new Date(Date.now() + Number(offset) * 1000)
  return shifted.getUTCFullYear() + "-" + pad2(shifted.getUTCMonth() + 1) + "-" + pad2(shifted.getUTCDate())
    + "T" + pad2(shifted.getUTCHours()) + ":" + pad2(shifted.getUTCMinutes())
}

// weather.json holds {"name": ..., "latitude": ..., "longitude": ...} (see
// omarchy-weather-location, which owns the format). Missing, blank, or
// unparseable means the location is auto-detected from the IP address.
function parseLocationFile(raw) {
  var unset = { name: "", latitude: null, longitude: null }
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return unset

    var latitude = parseFloat(data.latitude)
    var longitude = parseFloat(data.longitude)
    var hasCoordinates = !isNaN(latitude) && !isNaN(longitude)
    return {
      name: typeof data.name === "string" ? data.name.replace(/^\s+|\s+$/g, "") : "",
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null
    }
  } catch (e) {
    return unset
  }
}

// wttr.in path segment for a configured location: exact coordinates when
// both are present, the URL-encoded name as a fallback (hand-edited
// weather.loc files may only carry a name), empty for IP auto-detect.
function wttrLocationQuery(location, latitude, longitude) {
  var lat = parseFloat(String(latitude))
  var lon = parseFloat(String(longitude))
  if (!isNaN(lat) && !isNaN(lon)) return lat + "," + lon

  var name = String(location || "").replace(/^\s+|\s+$/g, "")
  return name === "" ? "" : encodeURIComponent(name)
}

// Open-Meteo geocoding response → suggestion rows for the location picker.
function parseGeocodingResults(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var results = data.results
    if (!results || !results.length) return []

    var out = []
    for (var i = 0; i < results.length; i++) {
      var r = results[i]
      if (!r || !r.name || r.latitude === undefined || r.longitude === undefined) continue
      var region = [r.admin1, r.country].filter(function(part) { return !!part }).join(", ")
      out.push({
        name: String(r.name),
        description: region,
        latitude: r.latitude,
        longitude: r.longitude
      })
    }
    return out
  } catch (e) {
    return []
  }
}

function locationCommit(text, suggestions, selectedIndex, picked) {
  var name = String(text || "").replace(/^\s+|\s+$/g, "")
  if (name === "") return { name: "", latitude: null, longitude: null, empty: true }

  var choices = suggestions || []
  if (choices.length === 1) return choices[0]
  if (picked === true && choices.length > 0) {
    var index = Math.max(0, Math.min(parseInt(selectedIndex, 10) || 0, choices.length - 1))
    if (choices[index]) return choices[index]
  }

  return { name: name, latitude: null, longitude: null, needsPick: true }
}

function isFutureForecastDate(dateString, todayString) {
  if (!dateString) return false
  return String(dateString).slice(0, 10) > String(todayString || "")
}

function roundedTemp(value) {
  if (value === undefined || value === null || value === "") return ""
  var n = parseFloat(String(value))
  return isNaN(n) ? "" : String(Math.round(n))
}

function celsiusToFahrenheit(value) {
  if (value === undefined || value === null || value === "") return ""
  var n = parseFloat(String(value))
  return isNaN(n) ? "" : (n * 9 / 5) + 32
}

function formatTemp(value, useImperial) {
  if (value === undefined || value === null || value === "") return ""
  return value + "°" + (useImperial ? "F" : "C")
}

function normalizedUnit(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "").toLowerCase()
}

function localeUsesImperial(localeName) {
  var name = String(localeName || "").replace(".", "_")
  return /^en[_-]US($|[_.-])/.test(name) || /^en[_-]LR($|[_.-])/.test(name) || /^my($|[_.-])/.test(name)
}

function countryUsesImperial(countryName) {
  var country = String(countryName || "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/[._-]+/g, " ")
    .toLowerCase()
  if (!country) return null
  if (country === "us" || country === "usa" || country === "united states" || country === "united states of america") return true
  if (country === "liberia" || country === "myanmar" || country === "burma") return true
  return false
}

function shouldUseImperial(unitOverride, localeName, countryName) {
  var unit = normalizedUnit(unitOverride)
  if (unit === "imperial") return true
  if (unit === "metric") return false

  var countryPreference = countryUsesImperial(countryName)
  if (countryPreference !== null) return countryPreference

  return localeUsesImperial(localeName)
}

function dayName(dateString, formatter) {
  if (!dateString) return ""
  var d = new Date(dateString + "T12:00:00")
  if (isNaN(d.getTime())) return ""
  if (formatter) return formatter(d)
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]
}

function openMeteoForecastDays(dailyForecastReport, todayString) {
  var daily = dailyForecastReport && dailyForecastReport.daily ? dailyForecastReport.daily : null
  if (!daily || !daily.time) return []

  var result = []
  for (var i = 0; i < daily.time.length && result.length < 3; ++i) {
    var date = daily.time[i]
    if (!isFutureForecastDate(date, todayString)) continue

    var maxC = daily.temperature_2m_max ? daily.temperature_2m_max[i] : ""
    var minC = daily.temperature_2m_min ? daily.temperature_2m_min[i] : ""
    result.push({
      date: date,
      maxtempC: roundedTemp(maxC),
      mintempC: roundedTemp(minC),
      maxtempF: roundedTemp(celsiusToFahrenheit(maxC)),
      mintempF: roundedTemp(celsiusToFahrenheit(minC)),
      openMeteoWeatherCode: daily.weather_code ? daily.weather_code[i] : null
    })
  }
  return result
}

// Open-Meteo bundles current conditions with the daily forecast request and
// answers far faster than wttr.in. Normalize them to wttr's
// current_condition shape so the panel can use either source
// interchangeably. Open-Meteo reports metric (°C, km/h).
function openMeteoCurrentCondition(dailyForecastReport) {
  var current = dailyForecastReport && dailyForecastReport.current ? dailyForecastReport.current : null
  if (!current || current.temperature_2m === undefined || current.temperature_2m === null) return null
  return {
    temp_C: roundedTemp(current.temperature_2m),
    temp_F: roundedTemp(celsiusToFahrenheit(current.temperature_2m)),
    FeelsLikeC: roundedTemp(current.apparent_temperature),
    FeelsLikeF: roundedTemp(celsiusToFahrenheit(current.apparent_temperature)),
    windspeedKmph: roundedTemp(current.wind_speed_10m),
    windspeedMiles: roundedTemp(current.wind_speed_10m * 0.621371),
    windDirection: current.wind_direction_10m,
    // Observed sky state. The forecast orbit's cloud deck renders these
    // directly, so a clear afternoon looks clear and a 30 mph south wind
    // actually pushes the banks north across the stage.
    cloudCover: current.cloud_cover,
    precipitation: current.precipitation,
    humidity: roundedTemp(current.relative_humidity_2m),
    pressureMb: roundedTemp(current.surface_pressure),
    openMeteoWeatherCode: current.weather_code,
    isDay: current.is_day
  }
}

// Compass label for a wind direction in degrees. 8-point, empty when the
// value is missing or out of range (Open-Meteo reports degrees from north).
function windDirectionLabel(deg) {
  var d = Number(deg)
  if (!isFinite(d) || d < 0 || d > 360) return ""
  var labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
  return labels[Math.round(d / 45) % 8]
}

// UV index bucket: { label, level }. Level drives the accent color in the panel.
function uvInfo(uv) {
  var u = Number(uv)
  if (!isFinite(u) || u < 0) return null
  if (u <= 2) return { label: "Low", level: 0 }
  if (u <= 5) return { label: "Moderate", level: 1 }
  if (u <= 7) return { label: "High", level: 2 }
  if (u <= 10) return { label: "Very High", level: 3 }
  return { label: "Extreme", level: 4 }
}

// US AQI bucket: { label, level }. Level drives the badge color in the panel.
function aqiInfo(aqi) {
  var a = Number(aqi)
  if (!isFinite(a)) return null
  if (a <= 50) return { label: "Good", level: 0 }
  if (a <= 100) return { label: "Moderate", level: 1 }
  if (a <= 150) return { label: "Unhealthy (sensitive)", level: 2 }
  if (a <= 200) return { label: "Unhealthy", level: 3 }
  if (a <= 300) return { label: "Very Unhealthy", level: 4 }
  return { label: "Hazardous", level: 5 }
}

// "2026-08-17T14:00" -> "14:00". Open-Meteo returns local wall-clock times
// with timezone=auto, so the substring is already in the user's timezone.
function timeOf(iso) {
  var s = String(iso || "")
  return s.length >= 16 ? s.slice(11, 16) : ""
}

function formatClock(hhmm, twelveHour, compact) {
  var s = String(hhmm || "")
  if (!twelveHour) return s
  var parts = s.split(":")
  var h = parseInt(parts[0], 10)
  var m = parts.length > 1 ? parts[1] : "00"
  if (!isFinite(h)) return s
  var suffix = h >= 12 ? "PM" : "AM"
  var h12 = h % 12
  if (h12 === 0) h12 = 12
  if (compact) {
    if (m === "00") return h12 + suffix.charAt(0).toLowerCase()
    return h12 + ":" + m + suffix.charAt(0).toLowerCase()
  }
  return h12 + ":" + m + " " + suffix
}

// Human-readable condition label for an Open-Meteo WMO weather code.
function conditionLabel(code) {
  var c = parseInt(String(code === undefined || code === null ? "0" : code), 10)
  var map = {
    0: "Clear sky",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm",
    99: "Thunderstorm"
  }
  return map[c] || "Overcast"
}

// Full-word compass label for a wind direction in degrees ("Northwest").
function windDirectionName(deg) {
  var d = Number(deg)
  if (!isFinite(d) || d < 0 || d > 360) return ""
  var labels = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"]
  return labels[Math.round(d / 45) % 8]
}

function humidityLabel(h) {
  var v = Number(h)
  if (!isFinite(v)) return ""
  if (v < 30) return "Dry"
  if (v < 50) return "Comfortable"
  if (v < 70) return "Humid"
  return "Very humid"
}

function pressureLabel(p) {
  var v = Number(p)
  if (!isFinite(v)) return ""
  if (v < 1000) return "Low"
  if (v <= 1025) return "Normal"
  return "High"
}

// Highest temperature (metric or imperial) across the hourly window, as a
// display string ("24°") for the "Day Max" header.
function hourlyMaxTemp(hourly, useImperial) {
  var max = null
  var list = hourly || []
  for (var i = 0; i < list.length; i++) {
    var raw = useImperial ? list[i].tempF : list[i].tempC
    var n = parseFloat(String(raw))
    if (isFinite(n) && (max === null || n > max)) max = n
  }
  return max === null ? "" : Math.round(max) + "°"
}

// Remaining hours of the current local day from the daily-forecast report.
// Each entry: time, tempC/tempF, precipProb, code, night.
function hourlyForecastToday(report, nowIso) {
  var hourly = report && report.hourly ? report.hourly : null
  if (!hourly || !hourly.time) return []

  var now = String(nowIso || "")
  var today = now.length >= 10 ? now.slice(0, 10) : ""
  var out = []
  for (var i = 0; i < hourly.time.length; i++) {
    var t = String(hourly.time[i] || "")
    if (today && t.slice(0, 10) !== today) {
      if (out.length > 0) break
      continue
    }
    if (t && now && t < now) continue
    var c = hourly.temperature_2m ? hourly.temperature_2m[i] : ""
    out.push({
      time: timeOf(t),
      tempC: roundedTemp(c),
      tempF: roundedTemp(celsiusToFahrenheit(c)),
      precipProb: hourly.precipitation_probability ? roundedTemp(hourly.precipitation_probability[i]) : "",
      code: hourly.weather_code ? hourly.weather_code[i] : null,
      night: hourly.is_day ? Number(hourly.is_day[i]) === 0 : false
    })
  }
  return out
}

// Next 24 hours of hourly data from the daily-forecast report (which now also
// carries hourly fields). Each entry: time, tempC/tempF, precipProb, code, night.
function hourlyForecast(report, nowIso) {
  var hourly = report && report.hourly ? report.hourly : null
  if (!hourly || !hourly.time) return []

  var now = String(nowIso || "")
  var out = []
  for (var i = 0; i < hourly.time.length && out.length < 24; i++) {
    var t = String(hourly.time[i] || "")
    if (t && now && t < now) continue
    var c = hourly.temperature_2m ? hourly.temperature_2m[i] : ""
    out.push({
      time: timeOf(t),
      tempC: roundedTemp(c),
      tempF: roundedTemp(celsiusToFahrenheit(c)),
      precipProb: hourly.precipitation_probability ? roundedTemp(hourly.precipitation_probability[i]) : "",
      code: hourly.weather_code ? hourly.weather_code[i] : null,
      night: hourly.is_day ? Number(hourly.is_day[i]) === 0 : false
    })
  }
  return out
}

// Daily forecast (today + following days) from the daily-forecast report.
function dailyForecast(report, todayString, maxDays) {
  var daily = report && report.daily ? report.daily : null
  if (!daily || !daily.time) return []

  var limit = parseInt(maxDays, 10)
  if (!isFinite(limit) || limit < 1) limit = 5

  var out = []
  for (var i = 0; i < daily.time.length && out.length < limit; i++) {
    var date = String(daily.time[i] || "")
    var maxC = daily.temperature_2m_max ? daily.temperature_2m_max[i] : ""
    var minC = daily.temperature_2m_min ? daily.temperature_2m_min[i] : ""
    out.push({
      date: date,
      isToday: todayString ? date === String(todayString) : i === 0,
      code: daily.weather_code ? daily.weather_code[i] : null,
      maxC: roundedTemp(maxC),
      maxF: roundedTemp(celsiusToFahrenheit(maxC)),
      minC: roundedTemp(minC),
      minF: roundedTemp(celsiusToFahrenheit(minC)),
      precipProb: daily.precipitation_probability_max ? roundedTemp(daily.precipitation_probability_max[i]) : "",
      uv: daily.uv_index_max ? Number(daily.uv_index_max[i]) : null,
      sunrise: daily.sunrise ? timeOf(daily.sunrise[i]) : "",
      sunset: daily.sunset ? timeOf(daily.sunset[i]) : ""
    })
  }
  return out
}

// Today's key from the daily-forecast report (sunrise/sunset/uv max), or null.
function todayExtras(report) {
  var daily = report && report.daily ? report.daily : null
  if (!daily || !daily.time || daily.time.length === 0) return null
  return {
    sunrise: daily.sunrise ? timeOf(daily.sunrise[0]) : "",
    sunset: daily.sunset ? timeOf(daily.sunset[0]) : "",
    uv: daily.uv_index_max ? Number(daily.uv_index_max[0]) : null
  }
}

// Air quality summary from the air-quality report: US AQI plus PM2.5/PM10.
function aqiSummary(report) {
  var current = report && report.current ? report.current : null
  if (!current || current.us_aqi === undefined || current.us_aqi === null) return null
  var aqi = Number(current.us_aqi)
  if (!isFinite(aqi)) return null
  return {
    aqi: Math.round(aqi),
    pm25: current.pm2_5 !== undefined && current.pm2_5 !== null ? roundedTemp(current.pm2_5) : "",
    pm10: current.pm10 !== undefined && current.pm10 !== null ? roundedTemp(current.pm10) : "",
    info: aqiInfo(aqi)
  }
}

function currentIcon(current, fallback) {
  if (!current) return fallback || ""
  if (current.openMeteoWeatherCode !== undefined && current.openMeteoWeatherCode !== null)
    return iconForOpenMeteoCode(current.openMeteoWeatherCode, Number(current.isDay) === 0)
  if (current.weatherCode !== undefined && current.weatherCode !== null)
    return iconForCode(current.weatherCode, false)
  return fallback || ""
}

// wttr.in has no day/night flag. Use its icon only to fill an empty initial
// state, never to replace a day/night-aware icon resolved by Open-Meteo.
function provisionalCurrentIcon(current, resolvedIcon) {
  return resolvedIcon || currentIcon(current, "")
}

function weatherResponseCompletesSave(hasConfiguredCoordinates, source) {
  return hasConfiguredCoordinates ? source === "open-meteo" : source === "wttr"
}

function wttrNextForecastDays(report, todayString) {
  var days = report && report.weather ? report.weather : []
  var result = []
  for (var i = 0; i < days.length && result.length < 3; ++i) {
    if (isFutureForecastDate(days[i].date, todayString)) result.push(days[i])
  }
  return result
}

function buildForecastDays(report, dailyForecastReport, todayString) {
  var days = openMeteoForecastDays(dailyForecastReport, todayString)
  return days.length > 0 ? days : wttrNextForecastDays(report, todayString)
}

function bareTempForDay(day, kind, useImperial) {
  if (!day) return ""
  // dailyForecast() reports maxC/maxF/minC/minF; openMeteoForecastDays()
  // (the 3-day fallback) uses the maxtempC/… names. Accept both so one
  // helper serves both shapes.
  var isMax = kind === "max"
  var v = useImperial
    ? (isMax ? day.maxF : day.minF)
    : (isMax ? day.maxC : day.minC)
  if (v === undefined || v === null || v === "")
    v = useImperial
      ? (isMax ? day.maxtempF : day.mintempF)
      : (isMax ? day.maxtempC : day.mintempC)
  if (v === undefined || v === null || v === "") return ""
  return v + "°"
}

function dayIcon(day) {
  if (!day) return ""
  if (day.openMeteoWeatherCode !== undefined && day.openMeteoWeatherCode !== null)
    return iconForOpenMeteoCode(day.openMeteoWeatherCode)
  if (!day.hourly || day.hourly.length === 0) return ""

  var best = day.hourly[0]
  var bestDist = 9999
  for (var i = 0; i < day.hourly.length; ++i) {
    var t = parseInt(String(day.hourly[i].time || "0"), 10)
    var dist = Math.abs(t - 1200)
    if (dist < bestDist) {
      bestDist = dist
      best = day.hourly[i]
    }
  }
  return iconForCode(best.weatherCode, false)
}

function iconForOpenMeteoCode(code, night) {
  var c = parseInt(String(code || "0"), 10)
  if (c === 0) return iconForCode(113, night)
  if (c === 1 || c === 2) return iconForCode(116, night)
  if (c === 3) return iconForCode(119, night)
  if (c === 45 || c === 48) return iconForCode(143, night)
  if (c === 51 || c === 53 || c === 55 || c === 56 || c === 57 || c === 61) return iconForCode(266, night)
  if (c === 63 || c === 65 || c === 66 || c === 67 || c === 80 || c === 81 || c === 82) return iconForCode(308, night)
  if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return iconForCode(338, night)
  if (c === 95 || c === 96 || c === 99) return iconForCode(389, night)
  return iconForCode(119, night)
}

function iconForCode(code, night) {
  var c = parseInt(String(code || "0"), 10)
  switch (c) {
    case 113: return night ? "" : ""
    case 116: return night ? "" : ""
    case 119: case 122: return ""
    case 143: case 248: case 260: return night ? "\ue346" : "\ue313"
    case 176: case 263: case 353: return night ? "" : ""
    case 179: case 227: case 230: case 323: case 326: case 368: return night ? "" : ""
    case 182: case 185: case 281: case 284: case 311: case 314:
    case 317: case 320: case 350: case 362: case 365: case 374: case 377: return ""
    case 200: case 386: case 389: case 392: case 395: return ""
    case 266: case 293: case 296: case 299: case 302: case 305: case 308: case 356: case 359: return ""
    case 329: case 332: case 335: case 338: case 371: return ""
    default: return ""
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    parseLocationFile: parseLocationFile,
    MAX_JSON_BYTES: MAX_JSON_BYTES,
    MAX_PLACE_NAME_BYTES: MAX_PLACE_NAME_BYTES,
    curlGet: curlGet,
    rejectOversized: rejectOversized,
    nowIsoForReport: nowIsoForReport,
    minutelyPrecipForecast: minutelyPrecipForecast,
    wttrLocationQuery: wttrLocationQuery,
    parseGeocodingResults: parseGeocodingResults,
    locationCommit: locationCommit,
    isFutureForecastDate: isFutureForecastDate,
    roundedTemp: roundedTemp,
    celsiusToFahrenheit: celsiusToFahrenheit,
    formatTemp: formatTemp,
    normalizedUnit: normalizedUnit,
    localeUsesImperial: localeUsesImperial,
    countryUsesImperial: countryUsesImperial,
    shouldUseImperial: shouldUseImperial,
    dayName: dayName,
    openMeteoForecastDays: openMeteoForecastDays,
    openMeteoCurrentCondition: openMeteoCurrentCondition,
    currentIcon: currentIcon,
    provisionalCurrentIcon: provisionalCurrentIcon,
    weatherResponseCompletesSave: weatherResponseCompletesSave,
    wttrNextForecastDays: wttrNextForecastDays,
    buildForecastDays: buildForecastDays,
    bareTempForDay: bareTempForDay,
    dayIcon: dayIcon,
    iconForOpenMeteoCode: iconForOpenMeteoCode,
    iconForCode: iconForCode,
    windDirectionLabel: windDirectionLabel,
    windDirectionName: windDirectionName,
    conditionLabel: conditionLabel,
    humidityLabel: humidityLabel,
    pressureLabel: pressureLabel,
    hourlyMaxTemp: hourlyMaxTemp,
    uvInfo: uvInfo,
    aqiInfo: aqiInfo,
    timeOf: timeOf,
    formatClock: formatClock,
    hourlyForecast: hourlyForecast,
    hourlyForecastToday: hourlyForecastToday,
    dailyForecast: dailyForecast,
    todayExtras: todayExtras,
    aqiSummary: aqiSummary
  }
}
