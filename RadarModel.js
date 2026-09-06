// Saved radar websites, location parsing, and alert helpers.
//
// There is no in-panel radar map. Open radar launches a user-saved https
// site. Alert sampling still uses a few nearby coordinates so a town is not
// treated as a single grid cell.

.pragma library

var GLYPH = String.fromCodePoint(0xF0437)   // nf-md-radar
var MAX_ALERT_JSON_BYTES = 1048576
var ALERT_INTERVAL_SEC = 600
var FRAME_INTERVAL_SEC = ALERT_INTERVAL_SEC

function curlGet(url, maxTimeSec, maxBytes) {
  var cap = parseInt(maxBytes, 10)
  if (!isFinite(cap) || cap < 1) cap = MAX_ALERT_JSON_BYTES
  var secs = parseInt(maxTimeSec, 10)
  if (!isFinite(secs) || secs < 1) secs = 10
  return ["curl", "-fsS", "--max-time", String(secs), "--max-filesize", String(cap), url]
}

function rejectOversized(raw, maxBytes) {
  var cap = parseInt(maxBytes, 10)
  if (!isFinite(cap) || cap < 1) cap = MAX_ALERT_JSON_BYTES
  return String(raw || "").length > cap
}

function stripUrlQueryAndFragment(url) {
  var text = String(url || "")
  var end = text.length
  var query = text.indexOf("?")
  var hash = text.indexOf("#")
  if (query !== -1 && query < end) end = query
  if (hash !== -1 && hash < end) end = hash
  return text.slice(0, end)
}

function hostnameFromHttpsUrl(url) {
  var text = stripUrlQueryAndFragment(url)
  if (text.indexOf("https://") !== 0) return ""
  var rest = text.slice(8)
  var slash = rest.indexOf("/")
  var hostname = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase()
  if (hostname === "" || hostname.indexOf("@") !== -1 || hostname.indexOf(":") !== -1) return ""
  return hostname
}

var BROWSER_RADAR_HOST = "https://www.rainviewer.com/map.html"
var RADAR_SITES = ["RainViewer", "NOAA", "Windy", "Weather Underground", "Custom"]

function browserRadarUrl(latitude, longitude) {
  var lat = parseFloat(latitude)
  var lon = parseFloat(longitude)
  if (!isFinite(lat) || !isFinite(lon)) return BROWSER_RADAR_HOST
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return BROWSER_RADAR_HOST
  return BROWSER_RADAR_HOST + "?loc=" + lat.toFixed(4) + "," + lon.toFixed(4) + ",7"
}

function noaaRadarUrl(latitude, longitude) {
  var lat = parseFloat(latitude)
  var lon = parseFloat(longitude)
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return "https://radar.weather.gov/"
  return "https://radar.weather.gov/?lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4)
}

function windyRadarUrl(latitude, longitude) {
  var lat = parseFloat(latitude)
  var lon = parseFloat(longitude)
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return "https://www.windy.com/-Radar-radar"
  return "https://www.windy.com/" + lat.toFixed(4) + "/" + lon.toFixed(4)
    + "?radar," + lat.toFixed(4) + "," + lon.toFixed(4) + ",8"
}

function wundergroundRadarUrl(latitude, longitude) {
  var lat = parseFloat(latitude)
  var lon = parseFloat(longitude)
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return "https://www.wunderground.com/wundermap"
  return "https://www.wunderground.com/wundermap?lat=" + lat.toFixed(4)
    + "&lon=" + lon.toFixed(4) + "&zoom=8&radar=1"
}

function sanitizeCustomRadarUrl(template, latitude, longitude) {
  var url = String(template || "").trim()
  var lat = parseFloat(latitude)
  var lon = parseFloat(longitude)
  if (isFinite(lat) && isFinite(lon)) {
    url = url.split("{lat}").join(lat.toFixed(4))
    url = url.split("{lon}").join(lon.toFixed(4))
  }
  if (url.indexOf("https://") !== 0) return ""
  if (url.length > 2048 || /\s/.test(url) || url.indexOf("\\") !== -1) return ""
  var lower = url.toLowerCase()
  if (lower.indexOf("javascript:") !== -1 || lower.indexOf("data:") !== -1 || lower.indexOf("file:") !== -1) return ""
  if (hostnameFromHttpsUrl(url) === "") return ""
  return url
}

function resolveRadarUrl(site, customTemplate, latitude, longitude) {
  var name = String(site || "RainViewer")
  if (name === "NOAA") return noaaRadarUrl(latitude, longitude)
  if (name === "Windy") return windyRadarUrl(latitude, longitude)
  if (name === "Weather Underground") return wundergroundRadarUrl(latitude, longitude)
  if (name === "Custom") return sanitizeCustomRadarUrl(customTemplate, latitude, longitude)
  return browserRadarUrl(latitude, longitude)
}

function parseLocationFile(raw) {
  var unset = { name: "", latitude: null, longitude: null, valid: false }
  var text = String(raw || "").trim()
  if (text === "") return unset

  var data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return unset
  }
  if (!data) return unset

  var latitude = parseFloat(data.latitude)
  var longitude = parseFloat(data.longitude)
  var valid = isFinite(latitude) && isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180

  return {
    name: String(data.name || ""),
    latitude: valid ? latitude : null,
    longitude: valid ? longitude : null,
    valid: valid
  }
}

var SAMPLE_RADIUS_KM = 5

function samplePoints(lat, lon, km) {
  lat = parseFloat(lat)
  lon = parseFloat(lon)
  if (!isFinite(lat) || !isFinite(lon)) return []

  var radius = km || SAMPLE_RADIUS_KM
  var dLat = radius / 111.32
  var cos = Math.cos(lat * Math.PI / 180)
  var dLon = Math.abs(cos) < 0.01 ? 0 : radius / (111.32 * cos)

  return [
    { latitude: lat, longitude: lon },
    { latitude: clampLat(lat + dLat), longitude: lon },
    { latitude: clampLat(lat - dLat), longitude: lon },
    { latitude: lat, longitude: wrapLon(lon + dLon) },
    { latitude: lat, longitude: wrapLon(lon - dLon) }
  ]
}

function clampLat(lat) {
  return Math.max(-90, Math.min(90, lat))
}

function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180
}

// ---------------------------------------------------------------------------
// NWS corroboration (United States)
// ---------------------------------------------------------------------------
//
// Why a second source at all. The quantitative reading above comes from
// Open-Meteo, and for this location Open-Meteo answers out of a global model on
// a grid tens of kilometres wide. A grid that coarse cannot hold a
// thunderstorm: it spreads one over a cell and, an hour later, takes it back.
// Observed 2026-09-06 — 5 mm dropped into the 19:30 quarter-hour slot, read as
// 20 mm/h, promoted to Severe, and revised to 0.0 before the hour was out. The
// sky over Atlanta stayed clear the whole time. Asking `models=ncep_hrrr_conus`
// for the convection-resolving model returns figures identical to
// `gfs_seamless`, so there is no storm-scale model behind that number to switch
// to.
//
// api.weather.gov is the United States' own forecast: a 2.5 km grid from the
// National Blend of Models, plus the watches and warnings the local office
// issues by hand. For Atlanta that office is Peachtree City, and the gridpoint
// is named for the neighbourhood rather than the metro.
//
// It is used to corroborate rather than to replace. The model keeps deciding
// how hard it will rain and when, because that is the question it answers in
// millimetres; the local office decides whether to believe rain is coming at
// all. Outside NWS coverage nothing changes — see `corroborate`, which passes
// the model reading through untouched whenever there is no local opinion to
// weigh it against.

var NWS_HOST = "https://api.weather.gov"

// api.weather.gov refuses a request that does not identify its caller, and asks
// for a contact address in the string.
var NWS_USER_AGENT = "omarchy-detailed-weather (https://github.com/calebhat/omarchy-weather)"

// How old the local office's opinion may be and still be allowed to overrule a
// model reading. The hourly grid is reissued about hourly; past this the
// silence is ours, not theirs, and a stale "no rain expected" must not mute a
// storm that arrived since.
var NWS_MAX_AGE_MS = 45 * 60 * 1000

// Probability of precipitation, in percent, across the same window the model is
// read over. Above CONFIRM the office agrees something is coming and the model
// reading stands as it is. Between the two the office thinks it is possible but
// not likely, which is not enough to interrupt somebody over — the reading is
// capped below the default alert threshold instead of being thrown away, so the
// bar still shows it. Below PARTIAL the office expects essentially nothing, and
// a lone model spike there is the failure this whole section exists for.
var NWS_POP_CONFIRM = 50
var NWS_POP_PARTIAL = 30

// Four decimal places because api.weather.gov redirects anything longer, and a
// redirect is a second round trip to learn what we already knew.
function nwsPoint(lat, lon) {
  return Number(lat).toFixed(4) + "," + Number(lon).toFixed(4)
}

function nwsPointsUrl(lat, lon) {
  return NWS_HOST + "/points/" + nwsPoint(lat, lon)
}

function nwsAlertsUrl(lat, lon) {
  return NWS_HOST + "/alerts/active?point=" + nwsPoint(lat, lon)
}

// `--compressed` because the hourly grid is about 160 kB of JSON and roughly a
// tenth of that gzipped. The cap and the timeout are the same bounded-stream
// discipline every other request here follows.
function nwsCurlGet(url, maxTimeSec, maxBytes) {
  var command = curlGet(url, maxTimeSec, maxBytes)
  return command.slice(0, command.length - 1).concat(
    ["--compressed", "-H", "User-Agent: " + NWS_USER_AGENT, "-H", "Accept: application/geo+json", url])
}

// Whether this coordinate is inside NWS coverage, and where its hourly grid
// lives. A point outside the United States answers 404, which is not a failure
// to report — it is the answer, and it means "carry on with the model alone".
function parseNwsPoints(data) {
  if (!data || !data.properties) return { supported: false, hourlyUrl: "" }
  var url = String(data.properties.forecastHourly || "")
  if (url.indexOf(NWS_HOST + "/") !== 0) return { supported: false, hourlyUrl: "" }
  return { supported: true, hourlyUrl: url }
}

// What an alert headline is worth, in this plugin's own bands.
//
// Only weather that falls out of the sky counts. A Heat Advisory is a real
// alert about a real hazard and says nothing whatever about rain; letting it
// through would turn a hot afternoon into a storm warning. The default is
// therefore zero, and events earn a band by being named.
function nwsEventLevel(event) {
  var name = String(event || "").toLowerCase()

  if (name.indexOf("tornado warning") !== -1) return 4
  if (name.indexOf("severe thunderstorm warning") !== -1) return 4
  if (name.indexOf("flash flood warning") !== -1) return 4
  if (name.indexOf("extreme wind warning") !== -1) return 4

  if (name.indexOf("tornado watch") !== -1) return 3
  if (name.indexOf("severe thunderstorm watch") !== -1) return 3
  if (name.indexOf("flash flood watch") !== -1) return 3
  if (name.indexOf("flood warning") !== -1) return 3
  if (name.indexOf("winter storm warning") !== -1) return 3
  if (name.indexOf("blizzard warning") !== -1) return 3
  if (name.indexOf("ice storm warning") !== -1) return 3

  if (name.indexOf("flood advisory") !== -1) return 2
  if (name.indexOf("flood watch") !== -1) return 2
  if (name.indexOf("winter weather advisory") !== -1) return 2
  if (name.indexOf("special weather statement") !== -1) return 2

  return 0
}

// The worst precipitation alert currently in force over the point, and its name.
function nwsAlertOutlook(data) {
  var features = data && data.features ? data.features : []
  var level = 0
  var event = ""
  for (var i = 0; i < features.length; i++) {
    var properties = features[i] ? features[i].properties : null
    if (!properties) continue
    var candidate = nwsEventLevel(properties.event)
    if (candidate > level) {
      level = candidate
      event = String(properties.event || "")
    }
  }
  return { level: level, event: event }
}

// Highest probability of precipitation the local office gives across the lead
// window. Returns -1 for "no opinion available", which reads as no veto rather
// than as a forecast of nothing — the distinction the whole gate turns on.
function nwsMaxPop(data, hours) {
  var periods = data && data.properties ? data.properties.periods : null
  if (!periods || periods.length === 0) return -1

  var span = Math.max(1, Math.min(periods.length, Math.ceil(Number(hours) || 1)))
  var highest = -1
  for (var i = 0; i < span; i++) {
    var slot = periods[i] ? periods[i].probabilityOfPrecipitation : null
    var value = slot ? Number(slot.value) : NaN
    if (!isFinite(value)) continue
    if (value > highest) highest = value
  }
  return highest
}

// Weigh a model reading against the local office.
//
// `nws` carries: supported, fresh, alertLevel, alertEvent, maxPop.
//
// Every path that lacks a local opinion returns the model reading unchanged.
// That direction is deliberate and it is the one this function must never get
// wrong: an alert that fails to fire is indistinguishable from fair weather,
// so a source being unreachable, uncovered or stale can only ever decline to
// help — never mute. The one path that lowers a reading is the one where the
// office has actually looked and expects nothing.
function corroborate(modelLevel, nws) {
  var level = Number(modelLevel) || 0
  if (!nws || !nws.supported || !nws.fresh) return { level: level, source: "model", event: "" }

  // A warning in force outranks the model in both directions. It can raise a
  // quiet reading, which is the case the model misses — a storm the office can
  // see on radar and a coarse grid has not resolved.
  var alertLevel = Number(nws.alertLevel) || 0
  if (alertLevel > 0) {
    return {
      level: Math.max(level, alertLevel),
      source: "nws",
      event: String(nws.alertEvent || "")
    }
  }

  var pop = Number(nws.maxPop)
  if (!isFinite(pop) || pop < 0) return { level: level, source: "model", event: "" }
  if (pop >= NWS_POP_CONFIRM) return { level: level, source: "model", event: "" }
  if (pop >= NWS_POP_PARTIAL) return { level: Math.min(level, 2), source: "downgraded", event: "" }
  return { level: 0, source: "suppressed", event: "" }
}
