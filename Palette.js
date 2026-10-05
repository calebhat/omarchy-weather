// Theme colour for the weather panel. A theme's colors.toml names red, yellow,
// orange, green, blue, magenta and cyan; the shell's Color singleton does not
// expose them, so this reads them and turns them into a few weather roles.
//
// Everything is pure: a palette object in, hex strings out. A colour the theme
// does not name falls back to the tinted accent the panel already used, and
// every role is moved toward the foreground until it reads against the
// background, so a dim blue on a dark theme and a pale yellow on a light one
// both stay legible.
.pragma library

var HEX = /^#[0-9a-fA-F]{6}$/

// Defaults match the shell's own Color singleton, for a theme that says nothing.
var DEFAULT_DARK = { foreground: "#cacccc", background: "#101315", accent: "#cacccc" }
var DEFAULT_LIGHT = { foreground: "#1a1a1a", background: "#fafafa", accent: "#3a5a8c" }

var ICON_CONTRAST = 3
var TEXT_CONTRAST = 4.5

var NAMES = ["foreground", "background", "accent", "muted", "red", "yellow", "orange", "green", "blue", "magenta", "cyan"]

// role, the theme colour it comes from, the fallback key it may be given, and
// the contrast it has to reach.
var ROLES = [
  ["sun", "yellow", "sun", ICON_CONTRAST],
  ["rain", "blue", "rain", ICON_CONTRAST],
  ["snow", "cyan", "snow", ICON_CONTRAST],
  ["storm", "magenta", "storm", ICON_CONTRAST],
  ["fog", "muted", "fog", ICON_CONTRAST],
  ["rainBar", "blue", "rain", ICON_CONTRAST],
  ["rainAmount", "blue", "rain", TEXT_CONTRAST],
  ["tempHigh", "orange", "", TEXT_CONTRAST],
  ["tempLow", "blue", "", TEXT_CONTRAST],
  ["tideHigh", "blue", "", TEXT_CONTRAST],
  ["tideLow", "cyan", "", TEXT_CONTRAST]
]
// UV bands low to extreme. The theme has no violet, so the top two share red.
var UV_COLORS = ["green", "yellow", "orange", "red", "red"]

function isHex(v) {
  return typeof v === "string" && HEX.test(v)
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

// Reads the named colours and `mode` out of colors.toml text. Only plain
// six-digit hex values count; gradients, rgba() and the like are ignored.
function parseColors(text) {
  var out = { mode: "" }
  var lines = typeof text === "string" ? text.split("\n") : []
  for (var i = 0; i < lines.length; i++) {
    var mode = lines[i].match(/^\s*mode\s*=\s*["'](dark|light)["']/)
    if (mode) {
      out.mode = mode[1]
      continue
    }
    var m = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6})["']?\s*(#.*)?\r?$/)
    if (m && NAMES.indexOf(m[1]) >= 0) out[m[1]] = m[2].toLowerCase()
  }
  return out
}

function channels(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function toHex(rgb) {
  var out = "#"
  for (var i = 0; i < 3; i++) {
    var v = Math.max(0, Math.min(255, Math.round(rgb[i])))
    out += (v < 16 ? "0" : "") + v.toString(16)
  }
  return out
}

// WCAG relative luminance of a #rrggbb colour.
function luminance(hex) {
  var c = channels(hex)
  var lin = []
  for (var i = 0; i < 3; i++) {
    var s = c[i] / 255
    lin.push(s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4))
  }
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(a, b) {
  var la = luminance(a)
  var lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function mix(a, b, t) {
  var ca = channels(a)
  var cb = channels(b)
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t])
}

// The colour itself if it already reads against the background; otherwise the
// least mix toward the foreground that does (the foreground itself at worst).
// Null when any input is not a colour.
function ensureContrast(color, background, foreground, minRatio) {
  if (!isHex(color) || !isHex(background) || !isHex(foreground)) return null
  var base = color.toLowerCase()
  if (contrast(base, background.toLowerCase()) >= minRatio) return base
  for (var step = 1; step <= 20; step++) {
    var candidate = mix(base, foreground.toLowerCase(), step / 20)
    if (contrast(candidate, background.toLowerCase()) >= minRatio) return candidate
  }
  return foreground.toLowerCase()
}

// The weather roles for a theme palette: { sun, rain, snow, storm, fog, rainBar,
// rainAmount, tempHigh, tempLow, tideHigh, tideLow, uv: [five bands] }, all
// #rrggbb. `fallbacks` may hold sun, rain, snow, storm and fog colours to use
// where the theme names none; anything else falls back to the accent.
function roles(palette, fallbacks) {
  var p = isObject(palette) ? palette : {}
  var f = isObject(fallbacks) ? fallbacks : {}

  // The colours are drawn on the popup surface, which can differ from the
  // global background, so `surface` (with `surfaceText` on it) wins when given.
  var onSurface = isHex(p.surface)
  var light
  if (onSurface) light = luminance(p.surface) > 0.5
  else if (p.mode === "light") light = true
  else if (p.mode === "dark") light = false
  else light = isHex(p.background) ? luminance(p.background) > 0.5 : false
  var defaults = light ? DEFAULT_LIGHT : DEFAULT_DARK

  var background = (onSurface ? p.surface : (isHex(p.background) ? p.background : defaults.background)).toLowerCase()
  var foreground = defaults.foreground
  if (onSurface && isHex(p.surfaceText)) foreground = p.surfaceText
  else if (isHex(p.foreground) && (!onSurface || contrast(p.foreground.toLowerCase(), background) >= TEXT_CONTRAST)) foreground = p.foreground
  foreground = foreground.toLowerCase()
  var accent = (isHex(p.accent) ? p.accent : defaults.accent).toLowerCase()

  var resolve = function(name, fallbackKey, minRatio) {
    var color = isHex(p[name]) ? p[name] : (fallbackKey && isHex(f[fallbackKey]) ? f[fallbackKey] : accent)
    return ensureContrast(color, background, foreground, minRatio)
  }

  var out = { uv: [] }
  for (var i = 0; i < ROLES.length; i++) out[ROLES[i][0]] = resolve(ROLES[i][1], ROLES[i][2], ROLES[i][3])
  for (var j = 0; j < UV_COLORS.length; j++) out.uv.push(resolve(UV_COLORS[j], "", TEXT_CONTRAST))
  return out
}

var TONES = ["sun", "rain", "snow", "storm", "fog", "rainBar", "rainAmount", "tempHigh", "tempLow", "tideHigh", "tideLow"]

// "uv0".."uv4" or a role name -> its colour in `rolesObject`, "" for anything else.
function toneColor(rolesObject, tone) {
  if (!isObject(rolesObject) || typeof tone !== "string") return ""
  var uv = /^uv([0-4])$/.exec(tone)
  if (uv) return Array.isArray(rolesObject.uv) && typeof rolesObject.uv[Number(uv[1])] === "string" ? rolesObject.uv[Number(uv[1])] : ""
  if (TONES.indexOf(tone) < 0) return ""
  return typeof rolesObject[tone] === "string" ? rolesObject[tone] : ""
}

// Which icon role an Open-Meteo weather code takes. Cloud and anything unknown
// have none and stay the plain foreground.
function iconRole(code) {
  if (typeof code !== "number" || !isFinite(code) || Math.floor(code) !== code) return ""
  if (code === 0 || code === 1) return "sun"
  if (code === 45 || code === 48) return "fog"
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain"
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow"
  if (code >= 95 && code <= 99) return "storm"
  return ""
}
