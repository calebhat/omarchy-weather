import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "RadarModel.js" as RadarModel

Panel {
  id: root
  moduleName: "io.github.calebhat.weather"
  ipcTarget: "io.github.calebhat.weather"
  manageIpc: false

  // A plugin rescan destroys the old bar before every loaded panel is
  // collected. Keep late bindings pointed at a valid palette object during
  // that teardown window instead of producing an unbounded null-error loop.
  QtObject {
    id: fallbackBar
    property color foreground: Color.foreground
    property color barForeground: Color.foreground
    property color urgent: Color.urgent
    property string fontFamily: Style.font.family
  }

  onBarChanged: if (!bar) bar = fallbackBar

  property var anchorItem: null
  property bool openedFromHotkey: false

  // The bar tracks the widget mounted in its slot — BarWidget.qml — not this
  // nested panel. Everything the bar identifies a panel by has to be that
  // widget: the popout coordinator compares against `slot.activeItem`, and
  // switchPanelFrom looks the slot up the same way.
  property var hostWidget: null
  property var radar: null
  readonly property var barIdentity: hostWidget || root
  property string mainView: "forecast"
  readonly property string radarSite: String(setting("radarSite", "RainViewer"))
  readonly property string radarCustomUrl: String(setting("radarUrl", ""))
  readonly property string unitChoice: String(setting("unit", "auto"))
  readonly property bool use12Hour: String(setting("timeFormat", "24")) === "12"
  readonly property bool alertsOn: setting("alertsEnabled", false) === true

  function open() {
    openedFromHotkey = false
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    resetCarousel(true)
    locationFile.reload()
    root.refresh()
  }

  function openFromHotkey() {
    openedFromHotkey = true
    root.controller.show()
    resetCarousel(true)
    locationFile.reload()
    root.refresh()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    carouselEntrance.stop()
    carouselSnap.stop()
    carouselLeanReset.stop()
    weatherWipeCover.stop()
    weatherWipeReveal.stop()
    weatherWipeFallback.stop()
    carouselDragging = false
    carouselSettling = false
    carouselLean = 0
    weatherWipeActive = false
    weatherWipeProgress = 0
    if (root.editingLocation) root.cancelEditingLocation()
    root.mainView = "forecast"
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  // Parsed wttr.in j1 response. Kept on failure so stale data stays visible.
  property var report: null
  property var dailyForecastReport: null
  property var airQualityReport: null
  property string wttrLocation: ""

  // Configured location, read from the weather.json state file (owned by
  // omarchy-weather-location). The query is the wttr.in path segment
  // (coordinates when stored, else the encoded name); empty means IP
  // auto-detect. The watch makes hand edits take effect live.
  property var configuredLocationState: ({ name: "", latitude: null, longitude: null })
  readonly property string configuredLocation: configuredLocationState.name
  readonly property string locationQuery: Model.wttrLocationQuery(configuredLocationState.name, configuredLocationState.latitude, configuredLocationState.longitude)

  onLocationQueryChanged: {
    if (peeking) return
    if (savingLocation) savingLocationQueryStarted = true
    forecastRetries = 0
    dailyForecastRetries = 0
    airQualityRetries = 0
    forecastProc.running = false
    dailyForecastProc.running = false
    airQualityProc.running = false
    forecastRetryTimer.stop()
    dailyForecastRetryTimer.stop()
    airQualityRetryTimer.stop()
    beginWeatherTransition("location")
    Qt.callLater(function() { root.refresh(false) })
  }

  property FileView locationFile: FileView {
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.configuredLocationState = Model.parseLocationFile(text())
    onLoadFailed: root.configuredLocationState = Model.parseLocationFile("")
  }

  // The first read can race shell startup (observed sporadically), leaving a
  // stored location unhonored until the next file write. One delayed reload
  // self-corrects; if the first read was fine it's a no-op, since identical
  // state doesn't change locationQuery and so triggers no refetch.
  Timer {
    interval: 1500
    running: true
    onTriggered: locationFile.reload()
  }

  property int forecastRetries: 0
  property int dailyForecastRetries: 0
  property int airQualityRetries: 0
  property real lastLat: NaN
  property real lastLon: NaN

  // Click-to-edit state for the location label.
  property bool editingLocation: false
  property string locationEditMode: "home"
  property bool savingLocation: false
  property bool savingLocationQueryStarted: false
  property var locationSuggestions: []
  property int suggestionIndex: 0
  property bool suggestionPicked: false
  property string locationPickHint: ""
  property string geocodePendingQuery: ""
  property string geocodeActiveQuery: ""
  property int clockMinute: 0
  property string forecastFetchedAt: ""

  // Temporary city lookup. Never written to weather.json; the bar pill stays
  // on the saved home location until peek is cleared.
  property var peekLocation: null
  readonly property bool peeking: {
    if (!peekLocation) return false
    var lat = parseFloat(String(peekLocation.latitude))
    var lon = parseFloat(String(peekLocation.longitude))
    return isFinite(lat) && isFinite(lon)
  }
  readonly property string peekName: peeking ? String(peekLocation.name || "") : ""
  readonly property string homeName: configuredLocation || wttrLocation || "home"

  // Shared hero/bar icon state, updated with each successful weather response.
  property string label: ""
  property string homeLabel: ""
  readonly property string barLabel: homeLabel || label
  property string homeTempF: ""
  readonly property string barTemperatureF: homeTempF
  readonly property string barConditionGlyph: homeLabel || label

  // The forecast panel can follow the user's unit preference, but the compact
  // outside-temperature readout in the bar is intentionally always Fahrenheit.
  // Keep its value paired with the saved home's icon so peeking at another city
  // cannot quietly replace either half of the bar reading.
  function rememberHomeCurrent(currentCondition, provisionalIcon) {
    if (root.peeking || !currentCondition) return

    var nextIcon = provisionalIcon
      ? Model.provisionalCurrentIcon(currentCondition, root.homeLabel || root.label)
      : Model.currentIcon(currentCondition, root.homeLabel || root.label)
    if (nextIcon !== "") {
      root.label = nextIcon
      root.homeLabel = nextIcon
    }

    var nextTempF = Model.roundedTemp(currentCondition.temp_F)
    if (nextTempF !== "") root.homeTempF = nextTempF
  }

  // wttr's current conditions when available; open-meteo's (bundled with the
  // much faster daily forecast fetch) fill the hero while wttr is in flight.
  readonly property bool hasHomeCoordinates: !isNaN(parseFloat(String(configuredLocationState.latitude))) && !isNaN(parseFloat(String(configuredLocationState.longitude)))
  readonly property bool hasConfiguredCoordinates: peeking || hasHomeCoordinates
  readonly property var openMeteoCurrent: Model.openMeteoCurrentCondition(dailyForecastReport)
  readonly property var current: (hasConfiguredCoordinates && openMeteoCurrent) ? openMeteoCurrent : ((report && report.current_condition && report.current_condition[0]) ? report.current_condition[0] : openMeteoCurrent)
  readonly property var areaInfo: report && report.nearest_area && report.nearest_area[0] ? report.nearest_area[0] : null
  readonly property string reportCountry: areaInfo && areaInfo.country && areaInfo.country[0] ? areaInfo.country[0].value : ""

  readonly property bool useImperial: Model.shouldUseImperial(setting("unit", ""), Qt.locale().name, reportCountry)

  // Auto-refresh interval in minutes; clamped to a sane minimum.
  readonly property int refreshMinutes: Math.max(5, parseInt(setting("refreshMinutes", 15), 10) || 15)

  // Feature toggles.
  readonly property bool showHourly: setting("showHourly", true) !== false
  readonly property bool showAirQuality: setting("showAirQuality", true) !== false
  readonly property bool showMetrics: setting("showMetrics", true) !== false
  readonly property bool showSun: setting("showSun", true) !== false
  readonly property bool showForecast: setting("showForecast", true) !== false
  readonly property bool showFeelsLike: setting("showFeelsLike", true) !== false
  readonly property bool orbitAutoSpin: setting("orbitAutoSpin", true) !== false

  readonly property string reportLocation: peeking ? peekName : (configuredLocation || wttrLocation || (areaInfo && areaInfo.areaName && areaInfo.areaName[0] ? areaInfo.areaName[0].value : ""))
  readonly property string reportTempNum: current ? String(useImperial ? current.temp_F : current.temp_C) : ""
  readonly property string tempUnit: "°" + (useImperial ? "F" : "C")
  property real animatedReportTemp: NaN
  property string animatedTempUnit: ""
  property real temperatureFlash: 0
  property int temperatureDirection: 0
  readonly property string displayedTempNum: isFinite(animatedReportTemp)
    ? String(Math.round(animatedReportTemp))
    : (reportTempNum || "—")
  readonly property color temperatureMotionColor: {
    var base = root.bar ? root.bar.foreground : Color.foreground
    if (temperatureDirection > 0)
      return Qt.tint(base, Qt.rgba(1.0, 0.30, 0.08, temperatureFlash * 0.72))
    if (temperatureDirection < 0)
      return Qt.tint(base, Qt.rgba(0.12, 0.64, 1.0, temperatureFlash * 0.72))
    return base
  }
  readonly property string reportFeels: current ? formatTemp(useImperial ? current.FeelsLikeF : current.FeelsLikeC) : ""
  readonly property string reportWindDir: openMeteoCurrent ? Model.windDirectionLabel(openMeteoCurrent.windDirection) : ""
  readonly property string reportWind: current ? ((useImperial ? (current.windspeedMiles + " mph") : (current.windspeedKmph + " km/h")) + (reportWindDir ? " " + reportWindDir : "")) : ""
  
  // Precipitation chance from the first upcoming hour — the headline question
  // after temperature. Lives in the hero stats instead of the duplicated
  // humidity (which already has its own METRICS card).
  readonly property string reportPrecip: hourly.length > 0 && hourly[0].precipProb !== "" ? (hourly[0].precipProb + "%") : ""

  // Sun / moon + UV come from the daily block (today's row).
  readonly property var todayExtra: Model.todayExtras(dailyForecastReport)
  readonly property string reportSunrise: todayExtra ? Model.formatClock(todayExtra.sunrise, use12Hour) : ""
  readonly property string reportSunset: todayExtra ? Model.formatClock(todayExtra.sunset, use12Hour) : ""
  readonly property var uv: (todayExtra && todayExtra.uv !== null && isFinite(todayExtra.uv)) ? Model.uvInfo(todayExtra.uv) : null
  
  // Forecast + air quality.
  readonly property var hourly: {
    var _tick = clockMinute
    var nowIso = Model.nowIsoForReport(dailyForecastReport, Qt.formatDateTime(new Date(), "yyyy-MM-ddThh:mm"))
    return Model.hourlyForecastToday(dailyForecastReport, nowIso)
  }
  readonly property var precipNowcast: {
    var _tick = clockMinute
    return Model.minutelyPrecipForecast(dailyForecastReport, 7200)
  }
  readonly property var daily: Model.dailyForecast(dailyForecastReport, Qt.formatDate(new Date(), "yyyy-MM-dd"), 10)
  // The ten-day forecast is presented as a circular, directly manipulated
  // orbit. `carouselAngle` is deliberately unbounded: keeping full turns
  // avoids a visible jump when the selected day wraps from day ten to today.
  property real carouselAngle: 90
  property int carouselSelectedIndex: 0
  property int carouselDetailIndex: 0
  property bool carouselDragging: false
  property bool carouselSettling: false
  property bool carouselPointerInside: false
  property int carouselHoverIndex: -1
  property real carouselPressX: 0
  property real carouselLastX: 0
  property real carouselLastMs: 0
  property real carouselVelocity: 0
  property real carouselDragDistance: 0
  property real carouselReveal: 1
  property real carouselLift: 1
  property real carouselDetailReveal: 1
  property real carouselLastInteractionMs: Date.now()
  property real carouselLean: 0
  property real weatherAmbientPhase: 0
  property real weatherWavePhase: 0
  property real weatherCorePhase: 0
  // A two-stage transition: 0→1 covers the old forecast, 1→2 reveals the
  // refreshed one. Direction remembers the user's last orbit gesture, so a
  // refresh feels connected to the same physical surface.
  property real weatherWipeProgress: 0
  property real weatherWipeDirection: 1
  property bool weatherWipeActive: false
  property bool weatherWipeCovered: false
  property bool weatherWipeDataReady: false
  property color weatherWipeAccent: weatherAccent
  property string weatherWipeLabel: "REFRESHING FORECAST"
  readonly property real carouselFocusAngle: 90
  readonly property int carouselCount: daily.length
  readonly property real carouselStep: carouselCount > 0 ? 360 / carouselCount : 36
  readonly property var carouselDay: carouselCount > 0
    ? daily[Math.max(0, Math.min(carouselDetailIndex, carouselCount - 1))]
    : null
  readonly property var carouselUv: carouselDay && carouselDay.uv !== null && isFinite(carouselDay.uv)
    ? Model.uvInfo(carouselDay.uv)
    : null
  readonly property bool carouselStorm: carouselDay ? isStormCode(carouselDay.code) : false
  property color weatherAccent: weatherAccentForCode(carouselDay ? carouselDay.code : -1)
  readonly property var airQuality: Model.aqiSummary(airQualityReport)
  readonly property bool hasAirQuality: airQuality !== null
  // Safe alias: bindings evaluate even when the AQI section is hidden, so the
  // section reads from this never-null object instead of the nullable report.
  readonly property var aq: airQuality ? airQuality : ({ aqi: 0, pm25: "", pm10: "", info: null })

  // True once the current-condition fetches (wttr / open-meteo) have exhausted
  // their retries with no data yet — the placeholder then says it failed rather
  // than claiming it is still fetching. The refresh timer resets the counters
  // and tries again on schedule.
  readonly property bool weatherUnavailable: !root.current && (root.forecastRetries >= 3 || root.dailyForecastRetries >= 3)

  // Secondary text: the theme foreground at reduced opacity. Stock themes
  // define `muted` too dark for text on the dark popup surface (~2:1), and
  // Qt.darker(foreground, n) breaks on light themes — alpha on the primary
  // foreground stays readable on any background and follows theme swaps.
  readonly property color dimText: Util.alpha(root.bar ? root.bar.foreground : Color.foreground, 0.8)

  // Uniform height for every METRICS grid cell, so the filled cards line up
  // in a clean grid regardless of whether a row has a level bar.
  readonly property int metricCellHeight: Style.space(60)

  // All-caps label tracking (location, stat labels, day names). QML
  // letterSpacing is in device pixels, so derive it from the base font to
  // keep the ~0.08em ratio when a theme overrides the font size.
  readonly property real capsLetterSpacing: Math.max(1, Math.round(Style.font.body * 0.08))

  // ---- Metric card values (2x2 grid) --------------------------------------
    readonly property string reportWindSpeed: openMeteoCurrent ? String(useImperial ? openMeteoCurrent.windspeedMiles : openMeteoCurrent.windspeedKmph) : ""
  readonly property string reportWindUnit: useImperial ? "mph" : "km/h"
  readonly property string reportWindDirName: openMeteoCurrent ? Model.windDirectionName(openMeteoCurrent.windDirection) : ""
  readonly property real windDeg: openMeteoCurrent && isFinite(Number(openMeteoCurrent.windDirection)) ? Number(openMeteoCurrent.windDirection) : -1
  // Pressure mapped to a 0..1 bar over the practical 950-1050 hPa span, so a
  // "Normal" reading (~1013 hPa) sits mid-bar and agrees with the Low/Normal/
  // High label rather than near-full (the old all-time-extremes 872-1080 range).
  readonly property real pressureLevel: openMeteoCurrent && openMeteoCurrent.pressureMb !== "" ? Math.max(0, Math.min(1, (Number(openMeteoCurrent.pressureMb) - 950) / (1050 - 950))) : -1
  readonly property real humidityLevel: openMeteoCurrent && openMeteoCurrent.humidity !== "" ? (Number(openMeteoCurrent.humidity) / 100) : -1
  readonly property real uvLevel: todayExtra && todayExtra.uv !== null && isFinite(todayExtra.uv) ? Math.max(0, Math.min(1, todayExtra.uv / 12)) : -1
  readonly property string hourlyMax: Model.hourlyMaxTemp(hourly, useImperial)

  function positiveModulo(value, modulus) {
    if (modulus < 1) return 0
    return ((value % modulus) + modulus) % modulus
  }

  function isStormCode(code) {
    var value = Number(code)
    return isFinite(value) && value >= 95
  }

  function isSnowCode(code) {
    var v = Number(code)
    if (!isFinite(v)) return false
    return (v >= 71 && v <= 77) || v === 85 || v === 86
  }

  // Fallback precipitation intensity, 0..1, for a day we have no observation
  // for. Used for every orbit position except today.
  function precipForCode(code) {
    var v = Number(code)
    if (!isFinite(v)) return 0
    if (v >= 95) return 0.90                 // thunderstorm
    if (v >= 85) return 0.70                 // snow showers
    if (v >= 80) return 0.72                 // rain showers
    if (v >= 71) return 0.55                 // snow
    if (v >= 61) return 0.60                 // rain
    if (v >= 51) return 0.30                 // drizzle
    return 0
  }

  // ---- LIVE SKY. When the orbit is parked on today, the cloud deck stops
  //      guessing from the weather code and renders the actual observation:
  //      measured cloud cover, real wind speed and bearing, real precipitation
  //      rate, and whether the sun is up. Any other day falls back to what the
  //      forecast code implies, because Open-Meteo's daily block carries no
  //      cloud-cover or wind series.
  // ---- SKY PREVIEW. Atlanta is not going to snow on demand, and a state you
  //      cannot see is a state you cannot claim works. Forcing a condition
  //      through IPC makes every branch reachable:
  //        qs ipc call io.github.calebhat.weather sky rain
  //      Modes: clear, night, cloudy, rain, snow, storm, off (back to live).
  property string skyPreview: ""

  readonly property bool skyPreviewOn: root.skyPreview !== ""

  function skyPreviewValue(key) {
    var m = root.skyPreview
    var table = {
      "clear":  { density: 0.04, precip: 0,    storm: false, snow: false, night: false, wind: 5,  sun: 0.38 },
      "night":  { density: 0.04, precip: 0,    storm: false, snow: false, night: true,  wind: 4,  sun: -1 },
      "cloudy": { density: 0.88, precip: 0,    storm: false, snow: false, night: false, wind: 11, sun: 0.38 },
      "rain":   { density: 0.96, precip: 0.75, storm: false, snow: false, night: false, wind: 15, sun: -1 },
      "snow":   { density: 0.90, precip: 0.70, storm: false, snow: true,  night: false, wind: 8,  sun: -1 },
      "storm":  { density: 1.00, precip: 0.95, storm: true,  snow: false, night: false, wind: 28, sun: -1 }
    }
    var row = table[m]
    return row ? row[key] : null
  }

  readonly property bool skyIsLive: root.carouselDay !== null && root.carouselDay !== undefined
    && root.carouselDay.isToday === true && root.openMeteoCurrent !== null

  readonly property real skyCloudCover: {
    if (skyPreviewOn) return skyPreviewValue("density")
    if (skyIsLive && isFinite(Number(root.openMeteoCurrent.cloudCover)))
      return Math.max(0, Math.min(1, Number(root.openMeteoCurrent.cloudCover) / 100))
    return root.carouselDay ? root.cloudinessForCode(root.carouselDay.code) : 0.55
  }

  readonly property real skyPrecip: {
    if (skyPreviewOn) return skyPreviewValue("precip")
    if (skyIsLive && isFinite(Number(root.openMeteoCurrent.precipitation))) {
      // mm/h. 2.5 mm/h is already properly raining, so that saturates.
      var mm = Number(root.openMeteoCurrent.precipitation)
      if (mm > 0) return Math.max(0.12, Math.min(1, mm / 2.5))
      // Measured zero means zero. The daily code can say SHOWERS while the
      // sky outside the window is dry, and the deck answers to the window.
      return 0
    }
    return root.carouselDay ? root.precipForCode(root.carouselDay.code) : 0
  }

  readonly property bool skyStorm: skyPreviewOn ? skyPreviewValue("storm") : root.carouselStorm
  readonly property bool skySnow: skyPreviewOn
    ? skyPreviewValue("snow")
    : (root.carouselDay ? root.isSnowCode(root.carouselDay.code) : false)

  // Where the sun is on its arc for the day on show: 0 at sunrise, 1 at
  // sunset, -1 once it is down. Uses the day's own sunrise/sunset, so a
  // morning panel puts the sun low on the left and noon puts it overhead.
  readonly property real skySunProgress: {
    if (skyPreviewOn) return skyPreviewValue("sun")
    if (skyIsNight) return -1
    if (!root.carouselDay || !root.carouselDay.sunrise || !root.carouselDay.sunset) return 0.5
    var rise = new Date(root.carouselDay.sunrise).getTime()
    var set = new Date(root.carouselDay.sunset).getTime()
    if (!isFinite(rise) || !isFinite(set) || set <= rise) return 0.5
    // Any day but today has no "now" to speak of, so show it at mid-morning
    // rather than pinning an unrelated clock onto it.
    if (!root.carouselDay.isToday) return 0.42
    var p = (Date.now() - rise) / (set - rise)
    return (p < 0 || p > 1) ? -1 : p
  }

  readonly property real skyWindSpeed: skyPreviewOn
    ? skyPreviewValue("wind")
    : (skyIsLive && isFinite(Number(root.openMeteoCurrent.windspeedMiles))
      ? Number(root.openMeteoCurrent.windspeedMiles)
      : 6)

  readonly property real skyWindFromDeg: skyIsLive ? root.windDeg : -1

  readonly property bool skyIsNight: skyPreviewOn
    ? skyPreviewValue("night")
    : root.openMeteoCurrent
    && root.openMeteoCurrent.isDay !== undefined
    && Number(root.openMeteoCurrent.isDay) === 0

  // How thick the drifting cloud deck behind the orbit should be for a given
  // WMO code. Clear days keep a couple of wisps so the layer never pops in or
  // out; anything precipitating fills the stage.
  function cloudinessForCode(code) {
    var value = Number(code)
    if (!isFinite(value)) return 0.55
    if (value >= 95) return 1.0          // thunderstorm
    if (value >= 80) return 0.98         // showers
    if (value >= 71) return 0.90         // snow
    if (value >= 51) return 0.94         // drizzle and rain
    if (value >= 45) return 0.88         // fog
    if (value >= 3) return 0.92          // overcast
    if (value >= 2) return 0.66          // partly cloudy
    if (value >= 1) return 0.40          // mainly clear
    return 0.20                          // clear
  }

  function syncAnimatedTemperature() {
    if (root.reportTempNum === "") return
    var next = Number(root.reportTempNum)
    if (!isFinite(next)) return

    // Unit conversions are not weather changes; snap those without a false
    // warm/cool signal. The first reading also appears immediately.
    if (!isFinite(root.animatedReportTemp) || root.animatedTempUnit !== root.tempUnit) {
      temperatureTween.stop()
      temperatureFlashPulse.stop()
      root.animatedReportTemp = next
      root.animatedTempUnit = root.tempUnit
      root.temperatureDirection = 0
      root.temperatureFlash = 0
      return
    }

    var delta = next - root.animatedReportTemp
    if (Math.abs(delta) < 0.01) return
    root.temperatureDirection = delta > 0 ? 1 : -1
    temperatureTween.stop()
    temperatureFlashPulse.stop()
    temperatureTween.from = root.animatedReportTemp
    temperatureTween.to = next
    temperatureTween.duration = Math.min(980, 420 + Math.abs(delta) * 34)
    root.temperatureFlash = 0
    temperatureTween.start()
    temperatureFlashPulse.start()
  }

  onReportTempNumChanged: syncAnimatedTemperature()
  onTempUnitChanged: Qt.callLater(syncAnimatedTemperature)

  // Keep the shell theme as the base, then tint it toward a recognizable
  // condition family. These colors only appear at low opacity, so the panel
  // stays at home in custom themes instead of becoming a fixed blue weather UI.
  function weatherAccentForCode(code) {
    var value = Number(code)
    if (!isFinite(value) || value < 0) return Color.accent
    if (value >= 95) return Qt.tint(Color.urgent, Qt.rgba(0.58, 0.25, 0.90, 0.28))
    if ((value >= 71 && value <= 86) || value === 66 || value === 67)
      return Qt.tint(Color.accent, Qt.rgba(0.72, 0.90, 1.0, 0.68))
    if ((value >= 51 && value <= 67) || (value >= 80 && value <= 82))
      return Qt.tint(Color.accent, Qt.rgba(0.22, 0.58, 0.96, 0.62))
    if (value === 45 || value === 48)
      return Qt.tint(Color.muted, Qt.rgba(0.72, 0.76, 0.82, 0.42))
    if (value === 0)
      return Qt.tint(Color.accent, Qt.rgba(1.0, 0.72, 0.22, 0.58))
    if (value <= 3)
      return Qt.tint(Color.accent, Qt.rgba(0.54, 0.72, 0.92, 0.30))
    return Color.accent
  }

  Behavior on weatherAccent {
    ColorAnimation { duration: 720; easing.type: Easing.OutCubic }
  }

  NumberAnimation {
    id: temperatureTween
    target: root
    property: "animatedReportTemp"
    easing.type: Easing.OutCubic
  }

  SequentialAnimation {
    id: temperatureFlashPulse
    NumberAnimation {
      target: root
      property: "temperatureFlash"
      from: 0
      to: 1
      duration: 130
      easing.type: Easing.OutCubic
    }
    NumberAnimation {
      target: root
      property: "temperatureFlash"
      to: 0
      duration: 780
      easing.type: Easing.OutQuint
    }
  }

  function selectedIndexForAngle(angle) {
    if (carouselCount < 1) return 0
    return positiveModulo(Math.round((carouselFocusAngle - angle) / carouselStep), carouselCount)
  }

  function syncCarouselSelection() {
    if (carouselCount < 1) return
    var nextIndex = selectedIndexForAngle(carouselAngle)
    if (nextIndex === carouselSelectedIndex) return
    carouselSelectedIndex = nextIndex
    carouselDetailIndex = nextIndex
    carouselDetailReveal = 0.58
    carouselDetailPulse.restart()
  }

  function nearestCarouselTurn(index) {
    if (carouselCount < 1) return 0
    var normalizedIndex = positiveModulo(index, carouselCount)
    var currentTurn = (carouselFocusAngle - carouselAngle) / carouselStep
    return normalizedIndex + Math.round((currentTurn - normalizedIndex) / carouselCount) * carouselCount
  }

  function settleCarousel(rawTurn) {
    if (carouselCount < 1) return
    var turn = Math.round(rawTurn)
    carouselSelectedIndex = positiveModulo(turn, carouselCount)
    carouselDetailIndex = carouselSelectedIndex
    carouselSettling = true
    carouselSnap.stop()
    carouselSnap.from = carouselAngle
    carouselSnap.to = carouselFocusAngle - turn * carouselStep
    carouselSnap.start()
  }

  function focusCarouselDay(index) {
    if (carouselCount < 1) return
    settleCarousel(nearestCarouselTurn(index))
  }

  function stepCarousel(direction) {
    if (carouselCount < 2 || carouselDragging) return
    carouselLastInteractionMs = Date.now()
    weatherWipeDirection = direction >= 0 ? 1 : -1
    carouselLeanReset.stop()
    carouselLean = Math.max(-9, Math.min(9, -direction * 7))
    carouselLeanReset.restart()
    var currentTurn = Math.round((carouselFocusAngle - carouselAngle) / carouselStep)
    settleCarousel(currentTurn + direction)
  }

  function resetCarousel(playEntrance) {
    carouselSnap.stop()
    carouselLeanReset.stop()
    carouselDragging = false
    carouselSettling = false
    carouselVelocity = 0
    carouselLean = 0
    carouselHoverIndex = -1
    carouselSelectedIndex = 0
    carouselDetailIndex = 0
    carouselAngle = carouselFocusAngle
    carouselLastInteractionMs = Date.now()
    carouselReveal = playEntrance ? 0 : 1
    carouselLift = playEntrance ? 0.86 : 1
    if (playEntrance) carouselEntrance.restart()
  }

  function beginWeatherTransition(reason) {
    if (!root.opened || root.mainView !== "forecast") return
    weatherWipeCover.stop()
    weatherWipeReveal.stop()
    weatherWipeFallback.stop()
    weatherWipeAccent = root.weatherAccent
    weatherWipeLabel = reason === "location" ? "CHANGING SKIES" : "REFRESHING FORECAST"
    weatherWipeProgress = 0
    weatherWipeCovered = false
    weatherWipeDataReady = false
    weatherWipeActive = true
    weatherWipeCover.start()
    weatherWipeFallback.restart()
  }

  function completeWeatherTransition() {
    if (!weatherWipeActive) return
    weatherWipeFallback.stop()
    weatherWipeDataReady = true
    weatherWipeAccent = weatherAccentForCode(carouselDay ? carouselDay.code : -1)
    if (weatherWipeCovered) weatherWipeReveal.restart()
  }

  function revealWeatherTransition() {
    if (!weatherWipeActive || !weatherWipeCovered) return
    weatherWipeDataReady = true
    weatherWipeReveal.restart()
  }

  function carouselCardAt(pointX, pointY) {
    var bestIndex = -1
    var bestZ = -999999
    for (var i = 0; i < carouselRepeater.count; i++) {
      var card = carouselRepeater.itemAt(i)
      if (!card || !card.visible) continue
      var local = card.mapFromItem(carouselStage, pointX, pointY)
      if (local.x >= 0 && local.x <= card.width && local.y >= 0 && local.y <= card.height && card.z >= bestZ) {
        bestIndex = i
        bestZ = card.z
      }
    }
    return bestIndex
  }

  function updateCarouselHover(pointX, pointY) {
    carouselHoverIndex = carouselCardAt(pointX, pointY)
  }

  onCarouselAngleChanged: syncCarouselSelection()
  onDailyChanged: {
    if (carouselCount < 1) return
    carouselSelectedIndex = Math.max(0, Math.min(carouselSelectedIndex, carouselCount - 1))
    carouselDetailIndex = carouselSelectedIndex
    focusCarouselDay(carouselSelectedIndex)
  }

  NumberAnimation {
    id: carouselSnap
    target: root
    property: "carouselAngle"
    duration: 620
    easing.type: Easing.OutBack
    easing.overshoot: 1.12
    onFinished: root.carouselSettling = false
  }

  NumberAnimation {
    id: carouselDetailPulse
    target: root
    property: "carouselDetailReveal"
    to: 1
    duration: 240
    easing.type: Easing.OutCubic
  }

  NumberAnimation {
    id: carouselLeanReset
    target: root
    property: "carouselLean"
    to: 0
    duration: 520
    easing.type: Easing.OutBack
    easing.overshoot: 1.08
  }

  NumberAnimation on weatherAmbientPhase {
    from: 0
    to: Math.PI * 2
    duration: 24000
    loops: Animation.Infinite
    running: root.opened && root.mainView === "forecast"
  }

  NumberAnimation on weatherWavePhase {
    from: 0
    to: Math.PI * 2
    duration: 2600
    loops: Animation.Infinite
    running: root.opened && root.mainView === "forecast"
  }

  NumberAnimation on weatherCorePhase {
    from: 0
    to: Math.PI * 2
    duration: 5800
    loops: Animation.Infinite
    running: root.opened && root.mainView === "forecast"
  }

  NumberAnimation {
    id: weatherWipeCover
    target: root
    property: "weatherWipeProgress"
    from: 0
    to: 1
    duration: 307
    easing.type: Easing.InOutCubic
    onFinished: {
      root.weatherWipeCovered = true
      if (root.weatherWipeDataReady) weatherWipeReveal.restart()
    }
  }

  SequentialAnimation {
    id: weatherWipeReveal
    PauseAnimation { duration: 67 }
    NumberAnimation {
      target: root
      property: "weatherWipeProgress"
      from: 1
      to: 2
      duration: 453
      easing.type: Easing.OutQuint
    }
    ScriptAction {
      script: {
        root.weatherWipeActive = false
        root.weatherWipeCovered = false
        root.weatherWipeDataReady = false
        root.weatherWipeProgress = 0
      }
    }
  }

  // A slow provider must never leave the panel hidden. If fresh data has not
  // arrived, reveal the loading state and let the normal retry UI take over.
  Timer {
    id: weatherWipeFallback
    interval: 1200
    onTriggered: root.revealWeatherTransition()
  }

  SequentialAnimation {
    id: carouselEntrance
    ScriptAction {
      script: {
        if (root.carouselCount > 1)
          root.carouselAngle = root.carouselFocusAngle + root.carouselStep * 2.25
      }
    }
    ParallelAnimation {
      NumberAnimation {
        target: root
        property: "carouselAngle"
        to: root.carouselFocusAngle
        duration: 700
        easing.type: Easing.OutBack
        easing.overshoot: 1.08
      }
      NumberAnimation {
        target: root
        property: "carouselReveal"
        to: 1
        duration: 347
        easing.type: Easing.OutCubic
      }
      NumberAnimation {
        target: root
        property: "carouselLift"
        to: 1
        duration: 600
        easing.type: Easing.OutBack
        easing.overshoot: 1.1
      }
    }
    ScriptAction {
      script: {
        root.carouselSelectedIndex = 0
        root.carouselDetailIndex = 0
        root.carouselAngle = root.carouselFocusAngle
      }
    }
  }

  Timer {
    id: carouselIdle
    interval: 1000
    repeat: true
    running: root.opened
      && root.mainView === "forecast"
      && root.carouselCount > 1
      && root.orbitAutoSpin
    onTriggered: {
      if (!root.carouselDragging
          && !root.carouselSettling
          && !root.carouselPointerInside
          && Date.now() - root.carouselLastInteractionMs >= 6500)
        root.stepCarousel(1)
    }
  }


  function refresh(reason) {
    if (reason !== false) beginWeatherTransition(reason === "location" ? "location" : "refresh")
    forecastRetries = 0
    dailyForecastRetries = 0
    airQualityRetries = 0
    // Cancel any pending retries so a refresh can't stack stale requests on
    // top of a fresh cycle.
    forecastRetryTimer.stop()
    dailyForecastRetryTimer.stop()
    airQualityRetryTimer.stop()
    // wttr.in's full j1 fetch only serves the no-coordinates (IP auto-detect)
    // path — with configured coordinates Open-Meteo is authoritative, so skip
    // the extra external request entirely.
    if (!root.peeking && !root.hasHomeCoordinates && !forecastProc.running) forecastProc.running = true
    if (!root.peeking && root.locationQuery === "" && !locationProc.running) locationProc.running = true
    refreshDailyForecast(null)
  }

  function refreshDailyForecast(sourceReport) {
    if (dailyForecastProc.running) return

    var lat = NaN
    var lon = NaN
    if (root.peeking) {
      lat = parseFloat(String(root.peekLocation.latitude))
      lon = parseFloat(String(root.peekLocation.longitude))
    } else {
      lat = parseFloat(String(root.configuredLocationState.latitude))
      lon = parseFloat(String(root.configuredLocationState.longitude))
      if (isNaN(lat) || isNaN(lon)) {
        var area = sourceReport && sourceReport.nearest_area && sourceReport.nearest_area[0] ? sourceReport.nearest_area[0] : root.areaInfo
        if (!area) return
        lat = parseFloat(String(area.latitude || ""))
        lon = parseFloat(String(area.longitude || ""))
      }
    }
    if (isNaN(lat) || isNaN(lon)) return

    root.lastLat = lat
    root.lastLon = lon

    var url = "https://api.open-meteo.com/v1/forecast"
      + "?latitude=" + encodeURIComponent(String(lat))
      + "&longitude=" + encodeURIComponent(String(lon))
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure,weather_code,is_day,cloud_cover,precipitation"
      + "&hourly=temperature_2m,precipitation_probability,weather_code,is_day"
      + "&minutely_15=precipitation,precipitation_probability"
      + "&forecast_minutely_15=16"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max"
      + "&forecast_days=10"
      + "&timezone=auto"
    dailyForecastProc.command = Model.curlGet(url, 5, Model.MAX_JSON_BYTES)
    dailyForecastProc.running = true

    if (root.showAirQuality) refreshAirQuality(lat, lon)
  }

  function refreshAirQuality(lat, lon) {
    if (airQualityProc.running) return
    var url = "https://air-quality-api.open-meteo.com/v1/air-quality"
      + "?latitude=" + encodeURIComponent(String(lat))
      + "&longitude=" + encodeURIComponent(String(lon))
      + "&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone"
      + "&timezone=auto"
    airQualityProc.command = Model.curlGet(url, 5, Model.MAX_JSON_BYTES)
    airQualityProc.running = true
  }

  // ---- Location editing. Clicking the location label swaps it for a search
  //      field; picking a geocoded suggestion persists name + coordinates to
  //      the module's shell.json entry. An empty commit returns to auto.
  function startEditingLocation() {
    if (root.peeking) {
      startPeekSearch()
      return
    }
    locationEditMode = "home"
    editingLocation = true
    savingLocation = false
    savingLocationQueryStarted = false
    locationSuggestions = []
    suggestionIndex = 0
    suggestionPicked = false
    locationPickHint = ""
    Qt.callLater(function() {
      locationField.text = root.configuredLocation
      locationField.selectAll()
      locationField.forceActiveFocus()
    })
  }

  function startPeekSearch() {
    locationEditMode = "peek"
    editingLocation = true
    savingLocation = false
    savingLocationQueryStarted = false
    locationSuggestions = []
    suggestionIndex = 0
    suggestionPicked = false
    locationPickHint = ""
    Qt.callLater(function() {
      locationField.text = ""
      locationField.forceActiveFocus()
    })
  }

  function cancelEditingLocation() {
    editingLocation = false
    locationEditMode = "home"
    savingLocation = false
    savingLocationQueryStarted = false
    locationSuggestions = []
    suggestionPicked = false
    locationPickHint = ""
    geocodeDebounce.stop()
    Qt.callLater(function() { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  function refetchView(playTransition) {
    if (playTransition) beginWeatherTransition("location")
    forecastRetries = 0
    dailyForecastRetries = 0
    airQualityRetries = 0
    forecastRetryTimer.stop()
    dailyForecastRetryTimer.stop()
    airQualityRetryTimer.stop()
    forecastProc.running = false
    dailyForecastProc.running = false
    airQualityProc.running = false
    Qt.callLater(function() { root.refresh(false) })
  }

  function applyPeek(location) {
    if (!location || location.empty === true || location.name === "") {
      cancelEditingLocation()
      return
    }
    if (location.needsPick === true) {
      locationPickHint = "Pick a city from the list"
      return
    }
    var lat = parseFloat(location.latitude)
    var lon = parseFloat(location.longitude)
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      locationPickHint = "Pick a city from the list"
      return
    }
    beginWeatherTransition("location")
    peekLocation = { name: String(location.name || ""), latitude: lat, longitude: lon }
    report = null
    dailyForecastReport = null
    airQualityReport = null
    cancelEditingLocation()
    refetchView(false)
  }

  function clearPeek() {
    if (!peekLocation && !peeking) return
    beginWeatherTransition("location")
    peekLocation = null
    report = null
    dailyForecastReport = null
    airQualityReport = null
    refetchView(false)
  }

  function commitLocation() {
    var location = Model.locationCommit(locationField.text, locationSuggestions, suggestionIndex, suggestionPicked)
    if (location.empty === true) {
      cancelEditingLocation()
      return
    }
    if (locationEditMode === "peek") {
      applyPeek(location)
      return
    }
    if (location.needsPick === true) {
      locationPickHint = "Pick a city from the list"
      return
    }
    var lat = parseFloat(location.latitude)
    var lon = parseFloat(location.longitude)
    if (!isFinite(lat) || !isFinite(lon)) {
      locationPickHint = "Pick a city from the list"
      return
    }
    savingLocation = true
    savingLocationQueryStarted = false
    locationPickHint = ""
    configuredLocationState = {
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude
    }
    persistLocation(location.name, location.latitude, location.longitude)
  }

  function clearLocation() {
    persistLocation("", null, null)
    wttrLocation = ""
    cancelEditingLocation()
  }

  function pickSuggestion(suggestion) {
    if (!suggestion) return
    if (locationEditMode === "peek") {
      applyPeek(suggestion)
      return
    }
    savingLocation = true
    savingLocationQueryStarted = false
    configuredLocationState = {
      name: suggestion.name,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude
    }
    persistLocation(suggestion.name, suggestion.latitude, suggestion.longitude)
  }

  function finishSavingLocation() {
    if (savingLocation && savingLocationQueryStarted) cancelEditingLocation()
  }

  function persistLocation(name, latitude, longitude) {
    var safeName = String(name || "").replace(/^\s+|\s+$/g, "").replace(/^-+/, "")
    var lat = parseFloat(latitude)
    var lon = parseFloat(longitude)
    if (safeName && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      locationSaveProc.command = ["omarchy-weather-location", "--set", safeName, lat + "," + lon]
    else if (safeName)
      locationSaveProc.command = ["omarchy-weather-location", "--set", safeName]
    else
      locationSaveProc.command = ["omarchy-weather-location", "--clear"]
    locationSaveProc.running = true
  }

  function notifyCurrent() {
    var loc = String(root.reportLocation || "").replace(/\s+/g, " ").trim()
    var temp = root.reportTempNum !== "" ? (root.reportTempNum + root.tempUnit) : ""
    var headline = loc !== "" ? loc : "Detailed Weather"
    var description = temp
    if (root.reportWind) description += (description ? " · " : "") + "Wind " + root.reportWind
    if (root.reportPrecip) description += (description ? " · " : "") + "Precip " + root.reportPrecip
    if (!description) return
    if (headline.charAt(0) === "-" || description.charAt(0) === "-") return
    Quickshell.execDetached(["omarchy-notification-send", "-u", "low", headline, description])
  }

  readonly property bool stockWeatherOn: {
    var registry = root.bar && root.bar.shell ? root.bar.shell.pluginRegistry : null
    var _rev = registry && registry.registryRevision
    return !!(registry && typeof registry.inBar === "function" && registry.inBar("omarchy.weather"))
  }

  function hideStockWeather() {
    var registry = root.bar && root.bar.shell ? root.bar.shell.pluginRegistry : null
    if (registry && typeof registry.setEnabled === "function")
      registry.setEnabled("omarchy.weather", false)
  }

  // Debounced geocoding. Only one curl runs at a time; if the query moved on
  // while a fetch was in flight, the latest query is fetched right after.
  function requestGeocode() {
    var query = locationField.text.trim()
    if (query.length < 2) {
      locationSuggestions = []
      return
    }
    geocodePendingQuery = query
    if (!geocodeProc.running) startGeocode()
  }

  function startGeocode() {
    geocodeActiveQuery = geocodePendingQuery
    geocodeProc.command = Model.curlGet(
      "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(geocodeActiveQuery) + "&count=5&language=en&format=json",
      5, Model.MAX_JSON_BYTES)
    geocodeProc.running = true
  }

  function formatTemp(value) {
    return Model.formatTemp(value, useImperial)
  }

  function dayName(dateString) {
    return Model.dayName(dateString, function(date) { return Qt.formatDate(date, "dddd") })
  }

  function dayAbbr(dateString) {
    return Model.dayName(dateString, function(date) { return Qt.formatDate(date, "ddd") })
  }

  function bareTempForDay(day, kind) {
    return Model.bareTempForDay(day, kind, useImperial)
  }

  function iconForOpenMeteoCode(code, night) {
    return Model.iconForOpenMeteoCode(code, night)
  }

  function persistSetting(key, value) {
    if (!root.bar || !root.bar.shell || typeof root.bar.shell.updateEntryInline !== "function") return
    var entry = { id: root.moduleName }
    var current = root.settings || {}
    for (var existing in current) if (existing !== "id") entry[existing] = current[existing]
    entry[key] = value
    root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function setRadarSite(name) {
    root.persistSetting("radarSite", String(name || "RainViewer"))
  }

  function showSettings() {
    if (root.editingLocation) root.cancelEditingLocation()
    root.mainView = "settings"
  }

  function showForecast() {
    root.mainView = "forecast"
    if (weatherScroll) weatherScroll.contentY = 0
  }

  function openRadarInBrowser() {
    var lat = root.peeking ? parseFloat(String(root.peekLocation.latitude)) : parseFloat(String(root.configuredLocationState.latitude))
    var lon = root.peeking ? parseFloat(String(root.peekLocation.longitude)) : parseFloat(String(root.configuredLocationState.longitude))
    if (!isFinite(lat) || !isFinite(lon)) {
      lat = root.lastLat
      lon = root.lastLon
    }
    var url = RadarModel.resolveRadarUrl(root.radarSite, root.radarCustomUrl, lat, lon)
    if (!url || url.indexOf("https://") !== 0) return
    Quickshell.execDetached(["omarchy-launch-browser", url])
  }

  Process {
    id: forecastProc
    command: {
      var q = String(root.locationQuery || "")
      if (q.indexOf("://") !== -1 || q.indexOf("/") !== -1) q = ""
      return Model.curlGet("https://wttr.in/" + q + "?format=j1", 10, Model.MAX_JSON_BYTES)
    }
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "")
        if (Model.rejectOversized(raw, Model.MAX_JSON_BYTES)) {
          root.scheduleForecastRetry()
          return
        }
        raw = raw.trim()
        if (!raw) {
          root.scheduleForecastRetry()
          return
        }
        try {
          var parsed = JSON.parse(raw)
          root.report = parsed
          if (!root.hasHomeCoordinates)
            root.rememberHomeCurrent(parsed.current_condition && parsed.current_condition[0], true)
          root.forecastRetries = 0
          if (Model.weatherResponseCompletesSave(root.hasConfiguredCoordinates, "wttr"))
            root.finishSavingLocation()
          if (!root.peeking && isNaN(parseFloat(String(root.configuredLocationState.latitude))))
            root.refreshDailyForecast(parsed)
        } catch (e) {
          root.scheduleForecastRetry()
        }
      }
    }
  }

  // wttr.in can be slow or flaky, especially for a location it hasn't
  // cached yet. Retry a few times before leaving it to the refresh timer.
  function scheduleForecastRetry() {
    if (forecastRetries >= 3) return
    forecastRetries++
    forecastRetryTimer.restart()
  }

  Timer {
    id: forecastRetryTimer
    interval: 2500
    onTriggered: if (!forecastProc.running) forecastProc.running = true
  }

  // With configured coordinates this fetch is the only thing that updates the
  // bar icon, so a dropped response must retry rather than wait out the
  // refresh timer with a stale icon.
  function scheduleDailyForecastRetry() {
    if (dailyForecastRetries >= 3) return
    dailyForecastRetries++
    dailyForecastRetryTimer.restart()
  }

  Timer {
    id: dailyForecastRetryTimer
    interval: 2500
    onTriggered: root.refreshDailyForecast(null)
  }

  function scheduleAirQualityRetry() {
    if (airQualityRetries >= 3) return
    airQualityRetries++
    airQualityRetryTimer.restart()
  }

  Timer {
    id: airQualityRetryTimer
    interval: 2500
    onTriggered: {
      if (root.showAirQuality && !isNaN(root.lastLat) && !isNaN(root.lastLon)) root.refreshAirQuality(root.lastLat, root.lastLon)
    }
  }

  Process {
    id: dailyForecastProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "")
        if (Model.rejectOversized(raw, Model.MAX_JSON_BYTES)) {
          root.scheduleDailyForecastRetry()
          return
        }
        raw = raw.trim()
        if (!raw) {
          root.scheduleDailyForecastRetry()
          return
        }
        try {
          var parsed = JSON.parse(raw)
          var parsedCurrent = Model.openMeteoCurrentCondition(parsed)
          root.dailyForecastReport = parsed
          root.forecastFetchedAt = Qt.formatTime(new Date(), root.use12Hour ? "h:mm AP" : "HH:mm")
          root.rememberHomeCurrent(parsedCurrent, false)
          root.dailyForecastRetries = 0
          root.completeWeatherTransition()
          if (!root.peeking && Model.weatherResponseCompletesSave(root.hasHomeCoordinates, "open-meteo"))
            root.finishSavingLocation()
        } catch (e) {
          root.scheduleDailyForecastRetry()
        }
      }
    }
  }

  Process {
    id: airQualityProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "")
        if (Model.rejectOversized(raw, Model.MAX_JSON_BYTES)) {
          root.scheduleAirQualityRetry()
          return
        }
        raw = raw.trim()
        if (!raw) {
          root.scheduleAirQualityRetry()
          return
        }
        try {
          root.airQualityReport = JSON.parse(raw)
          root.airQualityRetries = 0
        } catch (e) {
          root.scheduleAirQualityRetry()
        }
      }
    }
  }

  Process {
    id: geocodeProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (Model.rejectOversized(text, Model.MAX_JSON_BYTES)) {
          root.locationSuggestions = []
          return
        }
        root.locationSuggestions = root.editingLocation ? Model.parseGeocodingResults(text) : []
        root.suggestionIndex = 0
        root.suggestionPicked = false
        if (root.geocodePendingQuery !== root.geocodeActiveQuery) Qt.callLater(root.startGeocode)
      }
    }
  }

  Timer {
    id: geocodeDebounce
    interval: 300
    onTriggered: root.requestGeocode()
  }

  Process {
    id: locationSaveProc
    onExited: function(exitCode) {
      if (exitCode !== 0 || !root.savingLocation) return

      locationFile.reload()
      if (root.radar && root.radar.reloadLocation) root.radar.reloadLocation()
      if (!root.savingLocationQueryStarted) {
        root.savingLocationQueryStarted = true
        root.forecastRetries = 0
        root.dailyForecastRetries = 0
        root.airQualityRetries = 0
        forecastProc.running = false
        dailyForecastProc.running = false
        airQualityProc.running = false
        Qt.callLater(root.refresh)
      }
    }
  }

  Process {
    id: locationProc
    command: Model.curlGet("https://wttr.in/?format=%l", 4, Model.MAX_PLACE_NAME_BYTES)
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "")
        if (Model.rejectOversized(raw, Model.MAX_PLACE_NAME_BYTES)) return
        raw = raw.trim()
        if (!raw) return
        root.wttrLocation = raw.split(",")[0]
      }
    }
  }

  Timer {
    id: refreshTimer
    interval: root.refreshMinutes * 60 * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.clockMinute = Math.floor(Date.now() / 60000)
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function edit(): void { root.openFromHotkey(); root.startEditingLocation() }
    function settings(): void { root.mainView = "settings" }
    function forecast(): void { root.mainView = "forecast" }
    // Fire a lightning strike now, rather than waiting out the random timer.
    function strike(): void { skyDeck.triggerStrike() }
    // Force a sky state for a look: clear, night, cloudy, rain, snow, storm.
    // Anything else (or "off") hands the deck back to the live observation.
    function sky(mode: string): void {
      var m = String(mode || "").toLowerCase()
      var known = ["clear", "night", "cloudy", "rain", "snow", "storm"]
      root.skyPreview = known.indexOf(m) >= 0 ? m : ""
      root.openFromHotkey()
    }
  }

KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(540))
    contentHeight: panel.fittedContentHeight(Style.spacing.controlHeight + Style.space(12) + (root.mainView === "settings" ? settingsColumn.implicitHeight : weatherColumn.implicitHeight))

    // No custom background layer: the KeyboardPanel's BorderSurface paints the
    // theme popup surface (Color.popups.background), so the panel follows the
    // theme on dark and light surfaces alike.

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.editingLocation
      onMoveRequested: function(dx, dy) {
        if (root.mainView !== "forecast") return
        if (dx !== 0 && root.carouselCount > 1) {
          root.stepCarousel(dx)
          return
        }
        if (dy !== 0 && weatherScroll.contentHeight > weatherScroll.height) {
          weatherScroll.contentY = Math.max(0, Math.min(
            weatherScroll.contentHeight - weatherScroll.height,
            weatherScroll.contentY + dy * Style.space(72)))
        }
      }
      onReturnRequested: root.startEditingLocation()
      onCloseRequested: {
        if (root.mainView === "settings") root.showForecast()
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Item {
        id: chromeBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: Style.spacing.controlHeight
        z: 50

        Button {
          visible: root.mainView === "forecast"
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: "Open radar"
          fontFamily: root.bar.fontFamily
          foreground: root.bar.foreground
          onClicked: root.openRadarInBrowser()
        }

        Rectangle {
          visible: root.mainView === "settings"
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          width: doneLabel.implicitWidth + Style.space(24)
          height: parent.height
          radius: Math.min(4, Style.cornerRadius)
          color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)

          Text {
            id: doneLabel
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: "Done"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.body
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onPressed: function(mouse) {
              mouse.accepted = true
              root.mainView = "forecast"
            }
          }
        }

        Button {
          visible: root.mainView === "forecast"
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: "Settings"
          fontFamily: root.bar.fontFamily
          foreground: root.bar.foreground
          onClicked: root.showSettings()
        }
      }

      Flickable {
        id: weatherScroll
        visible: root.mainView === "forecast"
        enabled: root.mainView === "forecast"
        anchors.top: chromeBar.bottom
        anchors.topMargin: Style.space(12)
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        contentWidth: width
        contentHeight: weatherColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: weatherColumn
          width: weatherScroll.width
          spacing: Style.space(18)

          Row {
            visible: root.stockWeatherOn
            width: parent.width
            spacing: Style.space(8)

            Text {
              id: stockNotice
              width: parent.width - hideStockBtn.implicitWidth - Style.space(8)
              textFormat: Text.PlainText
              wrapMode: Text.WordWrap
              text: "Stock weather is still in the bar."
              color: root.dimText
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.bodySmall
              anchors.verticalCenter: parent.verticalCenter
            }

            Button {
              id: hideStockBtn
              text: "Hide stock pill"
              fontFamily: root.bar.fontFamily
              foreground: root.bar.foreground
              tooltipText: "Disable omarchy.weather so only this pill remains"
              onClicked: root.hideStockWeather()
            }
          }

          // ---- Hero: big glyph + temp on the left; location + FEELS/WIND/PRECIP
          //      stats on the right, matching the built-in weather plugin.
          Item {
            visible: root.mainView === "forecast"
            width: parent.width
            height: Math.max(heroLeft.height, heroRight.height)

            Row {
              id: heroLeft
              anchors.left: parent.left
              anchors.leftMargin: Style.space(16)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(16)

              Text {
                textFormat: Text.PlainText
                id: heroIcon
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: 5
                text: root.label || "—"
                color: root.weatherAccent
                font.family: root.bar.fontFamily
                font.pixelSize: 64
              }

              Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Text {
                  textFormat: Text.PlainText
                  id: tempBig
                  text: root.displayedTempNum
                  color: root.temperatureMotionColor
                  font.family: root.bar.fontFamily
                  font.pixelSize: 56
                  font.bold: true
                  scale: 1 + root.temperatureFlash * 0.055
                  transformOrigin: Item.Center
                }

                Text {
                  textFormat: Text.PlainText
                  text: root.current ? root.tempUnit : ""
                  color: root.temperatureMotionColor
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.display
                  anchors.top: tempBig.top
                  anchors.topMargin: Style.space(10)
                }

                Text {
                  textFormat: Text.PlainText
                  width: Style.space(13)
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.temperatureDirection > 0 ? "↗" : "↘"
                  color: root.temperatureMotionColor
                  opacity: root.temperatureFlash
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.bold: true
                  scale: 0.72 + root.temperatureFlash * 0.36
                }
              }
            }

            Column {
              id: heroRight
              width: weatherStats.implicitWidth
              anchors.right: parent.right
              anchors.rightMargin: Style.space(20)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(12)

              Row {
                visible: !root.editingLocation && root.reportLocation !== ""
                spacing: Style.space(6)

                Item {
                  implicitWidth: pinRow.implicitWidth
                  implicitHeight: pinRow.implicitHeight
                  TapHandler { onTapped: root.startEditingLocation() }
                  HoverHandler { id: pinHover; cursorShape: Qt.PointingHandCursor }
                  PanelToolTip {
                    visible: pinHover.hovered
                    text: root.peeking ? "Search another city" : "Change saved home location"
                    fontFamily: root.bar.fontFamily
                  }

                  Row {
                    id: pinRow
                    spacing: Style.space(6)

                    Text {
                      textFormat: Text.PlainText
                      text: "\uf041"
                      color: root.dimText
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.body
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                      textFormat: Text.PlainText
                      text: (root.reportLocation || "").toUpperCase()
                      color: root.dimText
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.body
                      font.letterSpacing: root.capsLetterSpacing
                      anchors.verticalCenter: parent.verticalCenter
                    }
                  }
                }

                Text {
                  textFormat: Text.PlainText
                  text: "\uf002"
                  color: root.dimText
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.body
                  anchors.verticalCenter: parent.verticalCenter
                  TapHandler { onTapped: root.startPeekSearch() }
                  HoverHandler { id: peekHover; cursorShape: Qt.PointingHandCursor }
                  PanelToolTip {
                    visible: peekHover.hovered
                    text: "Peek at another city without saving"
                    fontFamily: root.bar.fontFamily
                  }
                }
              }

              Text {
                textFormat: Text.PlainText
                visible: root.peeking && !root.editingLocation
                text: "Back to " + root.homeName
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.bodySmall
                TapHandler { onTapped: root.clearPeek() }
                HoverHandler { id: backHover; cursorShape: Qt.PointingHandCursor }
                PanelToolTip {
                  visible: backHover.hovered
                  text: "Return to saved home"
                  fontFamily: root.bar.fontFamily
                }
              }

              Row {
                visible: root.editingLocation
                spacing: Style.space(6)

                TextField {
                  id: locationField
                  width: Style.space(190)
                  enabled: !root.savingLocation
                  placeholderText: root.locationEditMode === "peek" ? "Peek another city" : "Search city"
                  foreground: root.bar.foreground
                  font.family: root.bar.fontFamily

                  onTextChanged: {
                    if (!root.editingLocation || root.savingLocation) return
                    root.suggestionPicked = false
                    root.locationPickHint = ""
                    geocodeDebounce.restart()
                  }

                  Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Escape) {
                      root.cancelEditingLocation()
                      event.accepted = true
                    } else if (event.key === Qt.Key_Down) {
                      if (root.suggestionIndex < root.locationSuggestions.length - 1) {
                        root.suggestionIndex++
                        root.suggestionPicked = true
                      }
                      event.accepted = true
                    } else if (event.key === Qt.Key_Up) {
                      if (root.suggestionIndex > 0) {
                        root.suggestionIndex--
                        root.suggestionPicked = true
                      }
                      event.accepted = true
                    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                      root.commitLocation()
                      event.accepted = true
                    }
                  }
                }

                Rectangle {
                  width: Style.space(18)
                  height: Style.space(18)
                  anchors.verticalCenter: parent.verticalCenter
                  radius: Math.min(4, Style.cornerRadius)
                  color: !root.savingLocation && clearLocationArea.containsMouse ? Style.hoverFillFor(root.bar.foreground, Color.accent) : "transparent"

                  Text {
                    textFormat: Text.PlainText
                    anchors.centerIn: parent
                    text: root.savingLocation ? "󰦖" : "\u2715"
                    font.family: root.bar.fontFamily
                    color: root.dimText
                    font.pixelSize: Style.font.bodySmall

                    RotationAnimator on rotation {
                      running: root.savingLocation
                      from: 0; to: 360
                      duration: 800
                      loops: Animation.Infinite
                    }
                  }

                  MouseArea {
                    id: clearLocationArea
                    anchors.fill: parent
                    enabled: !root.savingLocation
                    hoverEnabled: true
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: {
                      if (root.locationEditMode === "peek") root.cancelEditingLocation()
                      else root.clearLocation()
                    }
                  }
                }
              }

              Text {
                textFormat: Text.PlainText
                visible: root.editingLocation && root.locationPickHint !== ""
                text: root.locationPickHint
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Row {
                id: weatherStats
                visible: !!root.current
                spacing: Style.space(36)

                Column {
                  visible: root.showFeelsLike
                  spacing: Style.space(5)
                  Text {
                    textFormat: Text.PlainText
                    text: "FEELS"
                    color: root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.letterSpacing: root.capsLetterSpacing
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: root.reportFeels
                    color: root.bar.foreground
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.title
                  }
                }

                Column {
                  spacing: Style.space(5)
                  Text {
                    textFormat: Text.PlainText
                    text: "WIND"
                    color: root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.letterSpacing: root.capsLetterSpacing
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: root.reportWind
                    color: root.bar.foreground
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.title
                  }
                }

                Column {
                  spacing: Style.space(5)
                  Text {
                    textFormat: Text.PlainText
                    text: "PRECIP"
                    color: root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.letterSpacing: root.capsLetterSpacing
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: root.reportPrecip
                    color: root.bar.foreground
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.title
                  }
                }
              }
            }
          }

          // ---- Geocoding suggestions while the location is being edited.
          Column {
            visible: root.mainView === "forecast" && root.editingLocation && !root.savingLocation && root.locationSuggestions.length > 0
            width: parent.width
            spacing: 0

            Repeater {
              model: root.locationSuggestions

              Rectangle {
                required property var modelData
                required property int index
                width: parent.width
                height: suggestionRow.implicitHeight + Style.space(12)
                radius: Style.cornerRadius
                color: index === root.suggestionIndex ? Style.hoverFillFor(root.bar.foreground, Color.accent) : "transparent"

                Row {
                  id: suggestionRow
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(16)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(8)

                  Text {
                    textFormat: Text.PlainText
                    text: modelData.name
                    color: index === root.suggestionIndex ? Style.hoverStateColor(root.bar.foreground, Color.accent) : root.bar.foreground
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  Text {
                    textFormat: Text.PlainText
                    visible: text !== ""
                    text: modelData.description
                    color: root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    anchors.verticalCenter: parent.verticalCenter
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onPositionChanged: root.suggestionIndex = index
                  onClicked: root.pickSuggestion(modelData)
                }
              }
            }
          }

          Row {
            visible: root.mainView === "forecast" && !root.current
            spacing: Style.space(7)

            MorphingWeatherLoader {
              width: Style.space(22)
              height: Style.space(22)
              anchors.verticalCenter: parent.verticalCenter
              accentColor: root.weatherAccent
              running: !root.weatherUnavailable
              visible: running
            }

            Text {
              textFormat: Text.PlainText
              anchors.verticalCenter: parent.verticalCenter
              text: root.weatherUnavailable ? "Couldn't reach the weather service — will retry." : "Fetching forecast…"
              color: root.dimText
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.italic: true
            }
          }

          // ---- FORECAST ORBIT -----------------------------------------------
          // A ten-day, mouse-draggable carousel inspired by an astronomical
          // dial: every day stays visible on the ellipse while depth, scale,
          // opacity, tilt, and z-order make the front position feel physical.
          Column {
            id: carouselSection
            visible: root.mainView === "forecast" && root.showForecast && root.carouselCount > 0
            width: parent.width
            spacing: Style.space(8)

            Item {
              width: parent.width
              implicitHeight: carouselHeader.implicitHeight

              PanelSectionHeader {
                id: carouselHeader
                text: "FORECAST ORBIT"
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
              }

              Text {
                textFormat: Text.PlainText
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: "DRAG  ·  SCROLL  ·  ← →"
                color: root.dimText
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.caption
                font.letterSpacing: root.capsLetterSpacing * 0.65
              }
            }

            Item {
              id: carouselStage
              width: parent.width
              height: Style.space(278)
              opacity: root.carouselReveal
              scale: root.carouselLift
              transformOrigin: Item.Center
              clip: false

              // Condition-colored atmosphere: two nearly transparent fields
              // drift out of phase while a huge ghost glyph moves behind the
              // orbit. Low alpha keeps this legible in both dark and light
              // themes, and changing days crossfades the entire mood.
              Rectangle {
                anchors.centerIn: parent
                anchors.horizontalCenterOffset: Math.cos(root.weatherAmbientPhase) * Style.space(118)
                anchors.verticalCenterOffset: Math.sin(root.weatherAmbientPhase * 0.73) * Style.space(42)
                z: -8
                width: Style.space(250)
                height: width
                radius: width / 2
                color: Util.alpha(root.weatherAccent, 0.035)
                scale: 0.94 + Math.sin(root.weatherAmbientPhase * 1.4) * 0.06
              }

              Rectangle {
                anchors.centerIn: parent
                anchors.horizontalCenterOffset: Math.cos(root.weatherAmbientPhase + Math.PI) * Style.space(138)
                anchors.verticalCenterOffset: Math.sin(root.weatherAmbientPhase * 0.61 + 1.2) * Style.space(54)
                z: -8
                width: Style.space(192)
                height: width
                radius: width / 2
                color: Util.alpha(root.weatherAccent, 0.024)
              }

              // Drifting cloud deck. Clipped to the stage so banks slide off
              // the edge instead of bleeding into the metric rows below.
              Item {
                anchors.fill: parent
                z: -6
                clip: true

                SkyDeck {
                  id: skyDeck
                  anchors.fill: parent
                  anchors.margins: -Style.space(10)
                  active: root.opened && root.mainView === "forecast"
                  storm: root.skyStorm
                  phase: root.weatherAmbientPhase
                  density: root.skyCloudCover
                  windSpeed: root.skyWindSpeed
                  windFromDeg: root.skyWindFromDeg
                  precip: root.skyPrecip
                  snow: root.skySnow
                  night: root.skyIsNight
                  sunProgress: root.skySunProgress
                  accentColor: root.weatherAccent
                  urgentColor: Color.urgent
                }
              }

              Text {
                textFormat: Text.PlainText
                anchors.centerIn: parent
                anchors.horizontalCenterOffset: Math.cos(root.weatherAmbientPhase * 0.52) * Style.space(18)
                anchors.verticalCenterOffset: Math.sin(root.weatherAmbientPhase * 0.68) * Style.space(11)
                z: -7
                text: root.carouselDay ? root.iconForOpenMeteoCode(root.carouselDay.code, false) : ""
                color: root.weatherAccent
                opacity: 0.035
                font.family: root.bar.fontFamily
                font.pixelSize: Style.space(176)
                rotation: Math.sin(root.weatherAmbientPhase * 0.44) * 2.2
                scale: 0.96 + Math.sin(root.weatherAmbientPhase * 0.83) * 0.035
              }

              WeatherEnergyCore {
                anchors.centerIn: parent
                z: -1
                width: Style.space(292)
                height: Style.space(186)
                active: root.opened && root.mainView === "forecast"
                storm: root.carouselStorm
                phase: root.weatherCorePhase
                accentColor: root.weatherAccent
                urgentColor: Color.urgent
              }

              // Soft concentric halos give the center card some depth without
              // depending on a theme-specific shadow or external effect.
              Rectangle {
                anchors.centerIn: parent
                z: 110
                width: Style.space(238)
                height: Style.space(136)
                radius: width / 2
                color: "transparent"
                border.width: Math.max(1, Style.space(1))
                border.color: Util.alpha(root.weatherAccent, 0.15)
                scale: 1.0 + 0.025 * Math.sin(root.carouselAngle * Math.PI / 180)
              }

              Rectangle {
                anchors.centerIn: parent
                z: 115
                width: Style.space(258)
                height: Style.space(150)
                radius: width / 2
                color: "transparent"
                border.width: Math.max(1, Style.space(2))
                border.color: Color.urgent
                opacity: root.carouselStorm
                  ? 0.30 + (Math.sin(root.weatherAmbientPhase * 3) + 1) * 0.18
                  : 0
                scale: root.carouselStorm
                  ? 1.0 + (Math.sin(root.weatherAmbientPhase * 3) + 1) * 0.025
                  : 0.96

                Behavior on opacity { NumberAnimation { duration: 300 } }
                Behavior on scale { NumberAnimation { duration: 360; easing.type: Easing.OutBack } }
              }

              Rectangle {
                anchors.centerIn: parent
                // No card, no chrome: the hero reads as light on the orbit,
                // not as a panel stacked on top of one. Selection and mood are
                // carried entirely by type weight, accent color, and the
                // energy core breathing behind it.
                z: 120
                width: Style.space(240)
                height: Style.space(126)
                radius: 0
                color: "transparent"
                border.width: 0
                opacity: root.carouselDetailReveal
                scale: 0.94 + root.carouselDetailReveal * 0.06

                Column {
                  anchors.centerIn: parent
                  width: parent.width - Style.space(24)
                  spacing: Style.space(2)

                  Text {
                    textFormat: Text.PlainText
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: root.carouselDay
                      ? ((root.carouselDay.isToday ? "TODAY" : root.dayName(root.carouselDay.date).toUpperCase())
                        + "  ·  " + Qt.formatDate(new Date(root.carouselDay.date + "T12:00:00"), "MMM d").toUpperCase())
                      : ""
                    color: root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                    font.letterSpacing: root.capsLetterSpacing
                  }

                  Item { width: 1; height: Style.space(4) }

                  Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: Style.space(44)
                    height: Math.max(1, Style.space(1))
                    radius: height / 2
                    color: Util.alpha(root.carouselStorm ? Color.urgent : root.weatherAccent, 0.55)
                  }

                  Item { width: 1; height: Style.space(6) }

                  Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Style.space(10)

                    Text {
                      textFormat: Text.PlainText
                      anchors.verticalCenter: parent.verticalCenter
                      text: root.carouselDay ? root.iconForOpenMeteoCode(root.carouselDay.code, false) : ""
                      color: root.carouselStorm ? Color.urgent : root.weatherAccent
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.title
                    }

                    Column {
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: 0

                      Text {
                        textFormat: Text.PlainText
                        text: root.carouselDay
                          ? root.bareTempForDay(root.carouselDay, "max") + "  /  " + root.bareTempForDay(root.carouselDay, "min")
                          : ""
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.display
                        font.bold: true
                      }

                      Text {
                        textFormat: Text.PlainText
                        text: root.carouselDay ? Model.conditionLabel(root.carouselDay.code).toUpperCase() : ""
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                        font.letterSpacing: root.capsLetterSpacing * 0.8
                      }
                    }
                  }
                }
              }

              Canvas {
                id: carouselTrack
                anchors.fill: parent
                opacity: 0.52
                z: -2

                onPaint: {
                  var ctx = getContext("2d")
                  ctx.reset()
                  ctx.beginPath()
                  ctx.ellipse(width / 2, height / 2, width * 0.405, Style.space(94), 0, 0, Math.PI * 2)
                  ctx.strokeStyle = Util.alpha(root.weatherAccent, 0.42).toString()
                  ctx.lineWidth = Math.max(1, Style.space(1))
                  ctx.setLineDash([Style.space(3), Style.space(8)])
                  ctx.stroke()
                }

                onWidthChanged: requestPaint()
                onHeightChanged: requestPaint()

                Connections {
                  target: root
                  function onWeatherAccentChanged() { carouselTrack.requestPaint() }
                }
              }

              Repeater {
                id: carouselRepeater
                model: root.daily

                Item {
                  id: orbitCard
                  required property var modelData
                  required property int index

                  readonly property real radians: (root.carouselAngle + index * root.carouselStep) * Math.PI / 180
                  readonly property real depth: (Math.sin(radians) + 1) / 2
                  readonly property bool selected: index === root.carouselSelectedIndex
                  readonly property bool hovered: index === root.carouselHoverIndex
                  readonly property bool storm: root.isStormCode(modelData.code)
                  readonly property color dayAccent: root.weatherAccentForCode(modelData.code)
                  readonly property real baseScale: 0.62 + depth * 0.40

                  width: Style.space(64)
                  height: Style.space(82)
                  x: carouselStage.width / 2 + Math.cos(radians) * carouselStage.width * 0.405 - width / 2
                  y: carouselStage.height / 2 + Math.sin(radians) * Style.space(94) - height / 2
                  // Only the focused card crosses in front of the hub. The
                  // remaining days travel behind it, selling the 3D orbit
                  // instead of looking like a flat ring of overlapping tiles.
                  z: selected ? 500 : Math.round(depth * 80)
                  opacity: selected ? 1 : 0.34 + depth * 0.58
                  scale: baseScale * (selected ? 1.14 : (hovered ? 1.07 : 1))

                  transform: [
                    Rotation {
                      origin.x: orbitCard.width / 2
                      origin.y: orbitCard.height / 2
                      axis { x: 0; y: 1; z: 0 }
                      angle: -Math.cos(orbitCard.radians) * 16
                    },
                    Rotation {
                      origin.x: orbitCard.width / 2
                      origin.y: orbitCard.height / 2
                      axis { x: 0; y: 0; z: 1 }
                      angle: root.carouselLean * (0.52 + orbitCard.depth * 0.48)
                    }
                  ]

                  Behavior on scale {
                    NumberAnimation { duration: 150; easing.type: Easing.OutCubic }
                  }

                  Rectangle {
                    anchors.fill: parent
                    anchors.margins: -Style.space(5)
                    radius: Math.min(Style.space(14), Style.cornerRadius * 1.5)
                    color: "transparent"
                    border.width: Math.max(1, Style.space(1))
                    border.color: Util.alpha(Color.urgent, orbitCard.storm ? 0.26 : 0)
                    opacity: orbitCard.storm ? 1 : 0

                    SequentialAnimation on scale {
                      running: orbitCard.selected && root.opened && !root.carouselDragging
                      loops: Animation.Infinite
                      NumberAnimation { to: 1.06; duration: 950; easing.type: Easing.InOutSine }
                      NumberAnimation { to: 1.0; duration: 950; easing.type: Easing.InOutSine }
                    }
                  }

                  Rectangle {
                    anchors.fill: parent
                    radius: Math.min(Style.space(10), Style.cornerRadius)
                    // Days float free. Depth already encodes distance via
                    // scale and opacity, so a tile border only adds noise.
                    color: orbitCard.hovered && !orbitCard.selected
                      ? Util.alpha(root.bar.foreground, 0.07)
                      : "transparent"
                    border.width: 0

                    Behavior on color { ColorAnimation { duration: 150 } }
                    Behavior on border.color { ColorAnimation { duration: 150 } }

                    Column {
                      anchors.centerIn: parent
                      width: parent.width
                      spacing: Style.space(2)

                      Text {
                        textFormat: Text.PlainText
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: orbitCard.modelData.isToday ? "TODAY" : root.dayAbbr(orbitCard.modelData.date).toUpperCase()
                        color: orbitCard.selected ? root.bar.foreground : root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                        font.bold: orbitCard.selected
                      }

                      Text {
                        textFormat: Text.PlainText
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: root.iconForOpenMeteoCode(orbitCard.modelData.code, false)
                        color: orbitCard.storm ? Color.urgent : orbitCard.dayAccent
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.title
                      }

                      Text {
                        textFormat: Text.PlainText
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: root.bareTempForDay(orbitCard.modelData, "max")
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.bodySmall
                        font.bold: orbitCard.selected
                      }

                      Text {
                        textFormat: Text.PlainText
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: root.bareTempForDay(orbitCard.modelData, "min")
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                  }

                  Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.top: parent.bottom
                    anchors.topMargin: Style.space(4)
                    width: parent.width * 0.52
                    height: Math.max(1, Style.space(2))
                    radius: height / 2
                    color: Util.alpha(orbitCard.storm ? Color.urgent : orbitCard.dayAccent, 0.92)
                    opacity: orbitCard.selected ? 1 : 0
                    Behavior on opacity { NumberAnimation { duration: 160 } }
                  }
                }
              }

              MouseArea {
                id: carouselMouse
                anchors.fill: parent
                z: 1000
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton
                cursorShape: root.carouselDragging
                  ? Qt.ClosedHandCursor
                  : (root.carouselHoverIndex >= 0 ? Qt.PointingHandCursor : Qt.OpenHandCursor)

                onEntered: {
                  root.carouselPointerInside = true
                  root.updateCarouselHover(mouseX, mouseY)
                }
                onExited: {
                  if (!pressed) {
                    root.carouselPointerInside = false
                    root.carouselHoverIndex = -1
                  }
                }
                onPressed: function(mouse) {
                  keyCatcher.forceActiveFocus()
                  carouselSnap.stop()
                  root.carouselSettling = false
                  root.carouselDragging = true
                  root.carouselLastInteractionMs = Date.now()
                  root.carouselPressX = mouse.x
                  root.carouselLastX = mouse.x
                  root.carouselLastMs = Date.now()
                  root.carouselVelocity = 0
                  root.carouselDragDistance = 0
                  mouse.accepted = true
                }
                onPositionChanged: function(mouse) {
                  root.updateCarouselHover(mouse.x, mouse.y)
                  if (!pressed) return
                  var now = Date.now()
                  var dx = mouse.x - root.carouselLastX
                  var elapsed = Math.max(1, now - root.carouselLastMs)
                  root.carouselAngle += dx * 0.42
                  var instantVelocity = dx * 0.42 / elapsed
                  root.carouselVelocity = root.carouselVelocity * 0.68 + instantVelocity * 0.32
                  if (Math.abs(dx) > 0.5) root.weatherWipeDirection = dx > 0 ? 1 : -1
                  carouselLeanReset.stop()
                  root.carouselLean = Math.max(-11, Math.min(11, dx * 0.9))
                  root.carouselDragDistance += Math.abs(dx)
                  root.carouselLastX = mouse.x
                  root.carouselLastMs = now
                }
                onReleased: function(mouse) {
                  root.carouselDragging = false
                  carouselLeanReset.restart()
                  if (!containsMouse) root.carouselPointerInside = false

                  if (root.carouselDragDistance < Style.space(7)) {
                    var clickedIndex = root.carouselCardAt(mouse.x, mouse.y)
                    if (clickedIndex >= 0) root.focusCarouselDay(clickedIndex)
                    else root.focusCarouselDay(root.carouselSelectedIndex)
                  } else {
                    var projectedAngle = root.carouselAngle + root.carouselVelocity * 180
                    root.settleCarousel((root.carouselFocusAngle - projectedAngle) / root.carouselStep)
                  }
                  root.carouselHoverIndex = containsMouse ? root.carouselCardAt(mouse.x, mouse.y) : -1
                }
                onCanceled: {
                  root.carouselDragging = false
                  carouselLeanReset.restart()
                  root.focusCarouselDay(root.carouselSelectedIndex)
                }
                onWheel: function(wheel) {
                  var delta = Math.abs(wheel.angleDelta.y) >= Math.abs(wheel.angleDelta.x)
                    ? wheel.angleDelta.y
                    : wheel.angleDelta.x
                  if (delta !== 0) root.stepCarousel(delta < 0 ? 1 : -1)
                  wheel.accepted = true
                }
              }
            }

            Row {
              width: parent.width
              spacing: Style.space(6)
              opacity: root.carouselDetailReveal

              Repeater {
                model: root.carouselDay ? [
                  {
                    label: "RAIN",
                    value: root.carouselDay.precipProb !== "" && isFinite(Number(root.carouselDay.precipProb))
                      ? root.carouselDay.precipProb + "%"
                      : "—",
                    kind: "liquid",
                    level: root.carouselDay.precipProb !== "" && isFinite(Number(root.carouselDay.precipProb))
                      ? Number(root.carouselDay.precipProb) / 100
                      : -1
                  },
                  { label: "UV", value: root.carouselUv ? root.carouselUv.label : "—", kind: "text", level: -1 },
                  { label: "SUNRISE", value: root.carouselDay.sunrise ? Model.formatClock(root.carouselDay.sunrise, root.use12Hour) : "—", kind: "text", level: -1 },
                  { label: "SUNSET", value: root.carouselDay.sunset ? Model.formatClock(root.carouselDay.sunset, root.use12Hour) : "—", kind: "text", level: -1 }
                ] : []

                Rectangle {
                  id: orbitDetailCell
                  required property var modelData
                  property real animatedLevel: modelData.kind === "liquid"
                    ? Math.max(0, Math.min(1, Number(modelData.level)))
                    : 0
                  width: (carouselSection.width - Style.space(18)) / 4
                  height: Style.space(46)
                  radius: Math.min(Style.space(8), Style.cornerRadius)
                  color: Util.alpha(root.bar.foreground, 0.045)
                  border.width: Math.max(1, Style.space(1))
                  border.color: Util.alpha(root.bar.foreground, 0.07)
                  clip: true

                  Behavior on animatedLevel {
                    NumberAnimation { duration: 680; easing.type: Easing.OutQuint }
                  }

                  Canvas {
                    id: liquidCanvas
                    anchors.fill: parent
                    visible: orbitDetailCell.modelData.kind === "liquid"
                      && Number(orbitDetailCell.modelData.level) >= 0
                    antialiasing: true

                    onPaint: {
                      var ctx = getContext("2d")
                      ctx.clearRect(0, 0, width, height)
                      if (!visible) return
                      var level = orbitDetailCell.animatedLevel
                      var fillY = height * (1 - level)
                      var amplitude = level > 0.02 && level < 0.98 ? Style.space(2.4) : 0
                      var phase = root.weatherWavePhase

                      ctx.beginPath()
                      ctx.moveTo(0, fillY)
                      ctx.bezierCurveTo(
                        width * 0.33, fillY + Math.sin(phase) * amplitude,
                        width * 0.67, fillY + Math.cos(phase + Math.PI) * amplitude,
                        width, fillY)
                      ctx.lineTo(width, height)
                      ctx.lineTo(0, height)
                      ctx.closePath()
                      ctx.fillStyle = Util.alpha(root.weatherAccent, 0.28).toString()
                      ctx.fill()
                    }

                    Connections {
                      target: root
                      enabled: liquidCanvas.visible
                      function onWeatherWavePhaseChanged() { liquidCanvas.requestPaint() }
                      function onWeatherAccentChanged() { liquidCanvas.requestPaint() }
                    }

                    Connections {
                      target: orbitDetailCell
                      function onAnimatedLevelChanged() { liquidCanvas.requestPaint() }
                      function onWidthChanged() { liquidCanvas.requestPaint() }
                      function onHeightChanged() { liquidCanvas.requestPaint() }
                    }
                  }

                  Column {
                    z: 1
                    anchors.centerIn: parent
                    width: parent.width - Style.space(8)
                    spacing: Style.space(1)

                    Text {
                      textFormat: Text.PlainText
                      width: parent.width
                      horizontalAlignment: Text.AlignHCenter
                      text: modelData.label
                      color: root.dimText
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.caption
                      font.letterSpacing: root.capsLetterSpacing * 0.7
                    }

                    Text {
                      textFormat: Text.PlainText
                      width: parent.width
                      horizontalAlignment: Text.AlignHCenter
                      elide: Text.ElideRight
                      text: modelData.value
                      color: root.bar.foreground
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.bodySmall
                      font.bold: true
                    }
                  }
                }
              }
            }
          }

          // ---- HOURLY ----------------------------------------------------------
          PanelSeparator {
            strength: 0.2
            visible: root.mainView === "forecast" && root.showHourly && root.hourly.length > 0
            foreground: root.bar.foreground
          }

          Column {
            visible: root.mainView === "forecast" && root.showHourly && root.hourly.length > 0
            width: parent.width
            spacing: Style.space(8)

            Item {
              width: parent.width
              implicitHeight: hourHeader.implicitHeight

              PanelSectionHeader {
                id: hourHeader
                text: "TODAY"
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
              }

              Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                visible: root.hourlyMax !== ""
                spacing: Style.space(4)

                Text {
                  textFormat: Text.PlainText
                  anchors.verticalCenter: parent.verticalCenter
                  text: "󱃂"
                  color: root.dimText
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.caption
                }

                Text {
                  textFormat: Text.PlainText
                  anchors.verticalCenter: parent.verticalCenter
                  text: "Day MAX " + root.hourlyMax + (root.forecastFetchedAt !== "" ? " · as of " + root.forecastFetchedAt : "")
                  color: root.dimText
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }
            }

            Flickable {
              id: hourlyStrip
              readonly property real edgeInset: Style.space(2)
              readonly property real cellGap: Style.space(4)
              readonly property real fittedCellWidth: {
                var count = root.hourly.length
                if (count < 1) return Style.space(52)
                var gaps = cellGap * (count + 1)
                var available = width - edgeInset * 2 - gaps
                return Math.max(Style.space(52), available / count)
              }
              width: parent.width
              height: hourRow.implicitHeight
              contentWidth: hourRow.implicitWidth
              contentHeight: hourRow.implicitHeight
              clip: true
              boundsBehavior: Flickable.StopAtBounds
              interactive: hourRow.implicitWidth > width + 0.5

              Row {
                id: hourRow
                spacing: hourlyStrip.cellGap

                Item { width: hourlyStrip.edgeInset; height: 1 }

                Repeater {
                  id: hourRepeater
                  model: root.hourly

                  Item {
                    required property var modelData
                    required property int index
                    width: hourlyStrip.fittedCellWidth
                    height: hourCellColumn.implicitHeight + Style.space(8)

                    Rectangle {
                      anchors.fill: parent
                      radius: Math.min(4, Style.cornerRadius)
                      color: index === 0 ? Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.1) : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.05)
                    }

                    Column {
                      id: hourCellColumn
                      width: parent.width
                      anchors.horizontalCenter: parent.horizontalCenter
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(3)

                      Text {
                        textFormat: Text.PlainText
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: index === 0 ? "NOW" : Model.formatClock(modelData.time, root.use12Hour, true)
                        color: index === 0 ? root.bar.foreground : root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                        font.bold: index === 0
                      }
                      Text {
                        textFormat: Text.PlainText
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: root.iconForOpenMeteoCode(modelData.code, modelData.night)
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.title
                      }
                      Text {
                        textFormat: Text.PlainText
                        anchors.horizontalCenter: parent.horizontalCenter
                        // The NOW cell mirrors the hero's live reading (current
                        // block) so the two never disagree; the rest use the
                        // hourly forecast.
                        text: index === 0 && root.reportTempNum !== "" ? root.reportTempNum + "°" : (useImperial ? modelData.tempF : modelData.tempC) + "°"
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.body
                      }
                      Text {
                        textFormat: Text.PlainText
                        anchors.horizontalCenter: parent.horizontalCenter
                        visible: text !== ""
                        text: modelData.precipProb !== "" ? (modelData.precipProb + "%") : ""
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                  }
                }

                Item { width: hourlyStrip.edgeInset; height: 1 }
              }
            }
          }

          // ---- METRICS ----------------------------------------------------

          Column {
            visible: root.mainView === "forecast" && root.showMetrics && !!root.openMeteoCurrent
            width: parent.width
            spacing: Style.space(8)

            PanelSectionHeader {
              text: "METRICS"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Column {
              width: parent.width
              spacing: Style.space(12)

            Row {
              width: parent.width
              spacing: Style.space(12)

              MetricCard {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                label: "Wind"
                value: root.reportWindSpeed !== "" ? root.reportWindSpeed : "—"
                unit: root.reportWindSpeed !== "" ? root.reportWindUnit : ""
                desc: root.reportWindDirName
                arrowAngle: root.windDeg >= 0 ? root.windDeg : -1
              }

              MetricCard {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                label: "Humidity"
                value: root.openMeteoCurrent ? Model.humidityLabel(root.openMeteoCurrent.humidity) : "—"
                unit: ""
                desc: root.openMeteoCurrent && root.openMeteoCurrent.humidity !== "" ? (root.openMeteoCurrent.humidity + "%") : ""
                valuePixelSize: Style.font.body
                barLevel: root.humidityLevel
                barColor: Util.alpha(Color.accent, 0.85)
              }
            }

            Row {
              width: parent.width
              spacing: Style.space(12)

              MetricCard {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                label: "Pressure"
                value: root.openMeteoCurrent ? Model.pressureLabel(root.openMeteoCurrent.pressureMb) : "—"
                unit: ""
                desc: root.openMeteoCurrent && root.openMeteoCurrent.pressureMb !== "" ? (root.openMeteoCurrent.pressureMb + " hPa") : ""
                valuePixelSize: Style.font.body
                barLevel: root.pressureLevel
                barColor: Util.alpha(Color.accent, 0.85)
              }

              MetricCard {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                label: "UV"
                value: root.uv ? root.uv.label : "—"
                unit: ""
                desc: root.todayExtra && root.uv ? String(Math.round(root.todayExtra.uv)) : ""
                valuePixelSize: Style.font.body
                barLevel: root.uvLevel
                barColor: Util.alpha(Color.accent, 0.85)
              }
            }

            // Row 3: Air quality | Sun
            Row {
              width: parent.width
              spacing: Style.space(12)

              Rectangle {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                radius: Math.min(4, Style.cornerRadius)
                color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.05)
                visible: root.showAirQuality && root.hasAirQuality

                Column {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.leftMargin: Style.space(10)
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(5)

                  RowLayout {
                    width: parent.width
                    spacing: Style.space(8)

                    ColumnLayout {
                      Layout.fillWidth: true
                      spacing: Style.space(1)

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: "Air Quality"
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.bodySmall
                        elide: Text.ElideRight
                      }

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: String(root.aq.aqi)
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        visible: text !== ""
                        text: (root.aq.pm25 !== "" ? "PM2.5 " + root.aq.pm25 + " · " : "") + (root.aq.pm10 !== "" ? "PM10 " + root.aq.pm10 : "")
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }
                    }

                    Text {
                      textFormat: Text.PlainText
                      Layout.alignment: Qt.AlignVCenter
                      text: root.aq.info ? root.aq.info.label : ""
                      color: root.bar.foreground
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                    }
                  }
                }
              }

              Rectangle {
                width: (parent.width - Style.space(12)) / 2
                height: root.metricCellHeight
                radius: Math.min(4, Style.cornerRadius)
                color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.05)
                visible: root.showSun && root.reportSunrise !== "" && root.reportSunset !== ""

                Column {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.leftMargin: Style.space(10)
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(5)

                  RowLayout {
                    width: parent.width
                    spacing: Style.space(8)

                    ColumnLayout {
                      Layout.fillWidth: true
                      spacing: Style.space(1)

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: "Sun"
                        color: root.bar.foreground
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.bodySmall
                      }

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: "Rise " + root.reportSunrise
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                      }

                      Text {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: "Set " + root.reportSunset
                        color: root.dimText
                        font.family: root.bar.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }

                    Text {
                      textFormat: Text.PlainText
                      text: root.iconForOpenMeteoCode(0, false)
                      color: root.bar.foreground
                      font.family: root.bar.fontFamily
                      font.pixelSize: Style.font.title
                      Layout.alignment: Qt.AlignVCenter
                    }
                  }
                }
              }
              }
            }
          }

        }
      }

      Flickable {
        id: settingsScroll
        visible: root.mainView === "settings"
        enabled: root.mainView === "settings"
        anchors.top: chromeBar.bottom
        anchors.topMargin: Style.space(12)
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        contentWidth: width
        contentHeight: settingsColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

          Column {
            id: settingsColumn
            width: parent.width
            spacing: Style.space(16)

            PanelSectionHeader {
              text: "RADAR WEBSITE"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Flow {
              width: parent.width
              spacing: Style.space(6)

              Repeater {
                model: RadarModel.RADAR_SITES

                Rectangle {
                  required property string modelData
                  width: siteLabel.implicitWidth + Style.space(16)
                  height: Style.space(28)
                  radius: Math.min(4, Style.cornerRadius)
                  color: root.radarSite === modelData
                    ? Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)
                    : "transparent"

                  Text {
                    textFormat: Text.PlainText
                    id: siteLabel
                    anchors.centerIn: parent
                    text: modelData
                    color: root.radarSite === modelData ? root.bar.foreground : root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.bold: root.radarSite === modelData
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.setRadarSite(modelData)
                  }
                }
              }
            }

            Row {
              visible: root.radarSite === "Custom"
              width: parent.width
              spacing: Style.space(8)

              TextField {
                id: customRadarField
                width: parent.width - saveRadarBtn.implicitWidth - Style.space(8)
                placeholderText: "https://…  {lat} {lon} optional"
                text: root.radarCustomUrl
                foreground: root.bar.foreground
                font.family: root.bar.fontFamily
                Keys.onReturnPressed: root.persistSetting("radarUrl", customRadarField.text)
                Keys.onEnterPressed: root.persistSetting("radarUrl", customRadarField.text)
              }

              Button {
                id: saveRadarBtn
                text: "Save"
                fontFamily: root.bar.fontFamily
                foreground: root.bar.foreground
                tooltipText: "Save this https radar URL"
                onClicked: root.persistSetting("radarUrl", customRadarField.text)
              }
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              wrapMode: Text.WordWrap
              text: "Open radar on the forecast uses this site. Custom URLs must be https."
              color: root.dimText
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.bodySmall
            }

            PanelSectionHeader {
              text: "CLOCK"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Row {
              spacing: Style.space(6)

              Repeater {
                model: [
                  { id: "12", label: "12-hour" },
                  { id: "24", label: "24-hour" }
                ]

                Rectangle {
                  required property var modelData
                  width: clockLabel.implicitWidth + Style.space(16)
                  height: Style.space(28)
                  radius: Math.min(4, Style.cornerRadius)
                  color: String(setting("timeFormat", "24")) === modelData.id
                    ? Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)
                    : "transparent"

                  Text {
                    textFormat: Text.PlainText
                    id: clockLabel
                    anchors.centerIn: parent
                    text: modelData.label
                    color: String(setting("timeFormat", "24")) === modelData.id ? root.bar.foreground : root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.bold: String(setting("timeFormat", "24")) === modelData.id
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.persistSetting("timeFormat", modelData.id)
                  }
                }
              }
            }

            PanelSectionHeader {
              text: "UNITS"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Row {
              spacing: Style.space(6)

              Repeater {
                model: [
                  { id: "auto", label: "Auto" },
                  { id: "metric", label: "°C" },
                  { id: "imperial", label: "°F" }
                ]

                Rectangle {
                  required property var modelData
                  width: unitLabel.implicitWidth + Style.space(16)
                  height: Style.space(28)
                  radius: Math.min(4, Style.cornerRadius)
                  color: root.unitChoice === modelData.id
                    ? Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)
                    : "transparent"

                  Text {
                    textFormat: Text.PlainText
                    id: unitLabel
                    anchors.centerIn: parent
                    text: modelData.label
                    color: root.unitChoice === modelData.id ? root.bar.foreground : root.dimText
                    font.family: root.bar.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.bold: root.unitChoice === modelData.id
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.persistSetting("unit", modelData.id)
                  }
                }
              }
            }

            PanelSectionHeader {
              text: "FORECAST ORBIT"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Item {
              width: parent.width
              height: Style.spacing.controlHeight

              Column {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Text {
                  textFormat: Text.PlainText
                  text: "Auto-spin"
                  color: root.bar.foreground
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.body
                }

                Text {
                  textFormat: Text.PlainText
                  text: "Advance after 6.5 seconds idle; pauses under the pointer"
                  color: root.dimText
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              ToggleSwitch {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                checked: root.orbitAutoSpin
                foreground: root.bar.foreground
                onToggled: root.persistSetting("orbitAutoSpin", !root.orbitAutoSpin)
              }
            }

            PanelSectionHeader {
              text: "ALERTS"
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
            }

            Item {
              width: parent.width
              height: Style.spacing.controlHeight

              Text {
                textFormat: Text.PlainText
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: "Storm alerts"
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.body
              }

              ToggleSwitch {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                checked: root.alertsOn
                foreground: root.bar.foreground
                onToggled: root.persistSetting("alertsEnabled", !root.alertsOn)
              }
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              wrapMode: Text.WordWrap
              text: "Home location is the pin on the forecast. Threshold and radius stay in the widget form."
              color: root.dimText
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
      }

      WeatherWaveWipe {
        id: forecastWaveWipe
        anchors.top: chromeBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        z: 900
        active: root.weatherWipeActive && root.mainView === "forecast"
        progress: root.weatherWipeProgress
        direction: root.weatherWipeDirection
        accentColor: root.weatherWipeAccent
        surfaceColor: Color.popups.background
        foregroundColor: root.bar.foreground
        glyph: root.carouselDay
          ? root.iconForOpenMeteoCode(root.carouselDay.code, false)
          : (root.label || "")
        label: root.weatherWipeLabel
        fontFamily: root.bar.fontFamily
      }
    }
  }
}
