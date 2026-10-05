// Theme colour: the named colours in a theme's colors.toml become a handful of
// weather roles. The function takes a palette object and returns hex strings,
// so every rule here is checked without a shell.

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary } = require("./load.js")

const Palette = loadLibrary("Palette.js")

const HEX = /^#[0-9a-f]{6}$/
const NAMED = ["red", "yellow", "orange", "green", "blue", "magenta", "cyan"]

// A dark theme with a deliberately dim blue (#504384 on #0B0E1A is about 2:1).
const DARK = {
  mode: "dark", foreground: "#E6E1FF", background: "#0B0E1A", accent: "#2DE2E6", muted: "#322864",
  red: "#F15B5B", yellow: "#F9A100", orange: "#FFC93C", green: "#3FE0B2", cyan: "#2DE2E6", blue: "#504384", magenta: "#FF2A6D"
}
// A light theme whose bright colours are nearly invisible on white.
const LIGHT = {
  mode: "light", foreground: "#222222", background: "#FAFAFA", accent: "#3366CC", muted: "#BBBBBB",
  red: "#FF8080", yellow: "#FFE066", orange: "#FFB366", green: "#99E699", cyan: "#80F0F0", blue: "#99B3FF", magenta: "#FF99E6"
}

function everyRole(roles) {
  const out = []
  for (const key of ["sun", "rain", "snow", "storm", "fog", "rainBar", "rainAmount", "tempHigh", "tempLow", "tideHigh", "tideLow"]) {
    out.push([key, roles[key]])
  }
  roles.uv.forEach((c, i) => out.push(["uv" + i, c]))
  return out
}

// ---- parsing ------------------------------------------------------------

test("colors.toml gives the named colours and the mode", () => {
  const text = [
    'mode = "dark"', "", 'accent = "#2DE2E6"', 'background = "#0B0E1A"', "foreground = '#E6E1FF'",
    'red = "#F15B5B"  # comment', "yellow=#F9A100", 'hyprland_active_border = "rgba(2de2e6ee) rgba(ff2a6dee) 45deg"',
    'cyan = "#2de2e6"', 'bright_red = "#FF6B8A"'
  ].join("\n")
  const parsed = Palette.parseColors(text)
  assert.equal(parsed.mode, "dark")
  assert.equal(parsed.accent, "#2de2e6")
  assert.equal(parsed.background, "#0b0e1a")
  assert.equal(parsed.foreground, "#e6e1ff")
  assert.equal(parsed.red, "#f15b5b")
  assert.equal(parsed.yellow, "#f9a100")
  assert.equal(parsed.cyan, "#2de2e6")
  assert.equal(parsed.bright_red, undefined)
  assert.equal(parsed.hyprland_active_border, undefined)
})

test("a light mode is read, anything else is no mode", () => {
  assert.equal(Palette.parseColors('mode = "light"').mode, "light")
  for (const bad of ['mode = "sepia"', "mode = dark", 'mode = ""', "", 'Mode = "light"']) {
    assert.equal(Palette.parseColors(bad).mode, "", bad)
  }
})

test("malformed colour values are not colours", () => {
  const text = ['red = "#F15"', 'yellow = "F9A100"', 'orange = "#GGGGGG"', 'green = ""', 'blue = 5', 'cyan = "#12345678"',
    'magenta = "#FF2A6D"'].join("\r\n")
  const parsed = Palette.parseColors(text)
  for (const name of ["red", "yellow", "orange", "green", "blue", "cyan"]) assert.equal(parsed[name], undefined, name)
  assert.equal(parsed.magenta, "#ff2a6d")
})

test("unreadable input parses to an empty palette", () => {
  for (const bad of [null, undefined, 5, {}, [], "", "not toml at all"]) {
    const parsed = Palette.parseColors(bad)
    assert.equal(parsed.red, undefined)
    assert.equal(parsed.mode, "")
  }
})

// ---- contrast -------------------------------------------------------------

test("contrast is the WCAG ratio", () => {
  assert.ok(Math.abs(Palette.contrast("#000000", "#ffffff") - 21) < 0.01)
  assert.ok(Math.abs(Palette.contrast("#ffffff", "#000000") - 21) < 0.01)
  assert.equal(Palette.contrast("#336699", "#336699"), 1)
  assert.ok(Math.abs(Palette.contrast("#777777", "#ffffff") - 4.48) < 0.02)
})

test("a colour that already reads well is left exactly as it is", () => {
  assert.equal(Palette.ensureContrast("#f9a100", "#0b0e1a", "#e6e1ff", 4.5), "#f9a100")
})

test("a dim colour is moved toward the foreground until it reads", () => {
  const fixed = Palette.ensureContrast("#504384", "#0b0e1a", "#e6e1ff", 4.5)
  assert.notEqual(fixed, "#504384")
  assert.ok(Palette.contrast(fixed, "#0b0e1a") >= 4.5)
  // Only as far as needed: lighter than the input but not the foreground itself.
  assert.notEqual(fixed, "#e6e1ff")
})

test("on a light surface a pale colour is darkened", () => {
  const fixed = Palette.ensureContrast("#ffe066", "#fafafa", "#222222", 4.5)
  assert.ok(Palette.contrast(fixed, "#fafafa") >= 4.5)
  assert.ok(Palette.luminance(fixed) < Palette.luminance("#ffe066"))
})

test("a colour that cannot be rescued becomes the foreground", () => {
  assert.equal(Palette.ensureContrast("#808080", "#808080", "#808080", 4.5), "#808080")
  assert.equal(Palette.ensureContrast("#7f7f7f", "#808080", "#ffffff", 21), "#ffffff")
})

test("ensureContrast refuses what is not a colour", () => {
  assert.equal(Palette.ensureContrast("red", "#000000", "#ffffff", 4.5), null)
  assert.equal(Palette.ensureContrast("#ff0000", "nope", "#ffffff", 4.5), null)
  assert.equal(Palette.ensureContrast(null, "#000000", "#ffffff", 4.5), null)
})

// ---- roles --------------------------------------------------------------

test("a dark theme maps names to roles, and a dim blue is lifted", () => {
  const roles = Palette.roles(DARK, {})
  assert.equal(roles.sun, "#f9a100")
  assert.equal(roles.snow, "#2de2e6")
  assert.equal(roles.storm, "#ff2a6d")
  assert.equal(roles.uv[0], "#3fe0b2")
  assert.equal(roles.uv[1], "#f9a100")
  assert.equal(roles.uv[2], "#ffc93c")
  assert.equal(roles.uv[3], "#f15b5b")
  assert.equal(roles.uv[4], "#f15b5b")
  assert.equal(roles.tempHigh, "#ffc93c")
  assert.equal(roles.tideLow, "#2de2e6")
  assert.notEqual(roles.rain, "#504384")
  assert.ok(Palette.contrast(roles.rain, "#0b0e1a") >= 3)
  assert.ok(Palette.contrast(roles.rainAmount, "#0b0e1a") >= 4.5)
  assert.equal(roles.rainBar, roles.rain)
})

test("every role reads on a dark theme and on a light one", () => {
  for (const theme of [DARK, LIGHT]) {
    const roles = Palette.roles(theme, {})
    for (const [key, color] of everyRole(roles)) {
      assert.match(color, HEX, key)
      assert.ok(Palette.contrast(color, theme.background) >= 3, `${theme.mode} ${key} ${color} on ${theme.background}`)
    }
  }
})

test("text roles meet 4.5:1 and icon roles meet 3:1", () => {
  for (const theme of [DARK, LIGHT]) {
    const roles = Palette.roles(theme, {})
    for (const key of ["rainAmount", "tempHigh", "tempLow", "tideHigh", "tideLow"]) {
      assert.ok(Palette.contrast(roles[key], theme.background) >= 4.5, `${theme.mode} ${key}`)
    }
    roles.uv.forEach((c, i) => assert.ok(Palette.contrast(c, theme.background) >= 4.5, `${theme.mode} uv${i}`))
  }
})

test("light themes are darkened, not left pale", () => {
  const roles = Palette.roles(LIGHT, {})
  assert.ok(Palette.luminance(roles.sun) < Palette.luminance("#ffe066"))
  assert.ok(Palette.luminance(roles.snow) < Palette.luminance("#80f0f0"))
})

// The cards are painted on the popup surface, which can differ from the global
// background, so colours are lifted against the surface they are drawn on.
test("colours are checked against the popup surface, not the global background", () => {
  // Dark global theme, light popups.
  const lightPopup = Object.assign({}, DARK, { surface: "#f5f5f5", surfaceText: "#222222" })
  const onPopup = Palette.roles(lightPopup, {})
  const onGlobal = Palette.roles(DARK, {})
  assert.notDeepEqual(onPopup, onGlobal)
  for (const [key, color] of everyRole(onPopup)) {
    assert.ok(Palette.contrast(color, "#f5f5f5") >= 3, `${key} ${color} on the light popup`)
  }
  for (const key of ["rainAmount", "tempHigh", "tempLow", "tideHigh", "tideLow"]) {
    assert.ok(Palette.contrast(onPopup[key], "#f5f5f5") >= 4.5, key)
  }
  assert.ok(Palette.luminance(onPopup.sun) < Palette.luminance(onGlobal.sun))
  // Light global theme, dark popups.
  const darkPopup = Object.assign({}, LIGHT, { surface: "#101820", surfaceText: "#e8e8e8" })
  for (const [key, color] of everyRole(Palette.roles(darkPopup, {}))) {
    assert.ok(Palette.contrast(color, "#101820") >= 3, `${key} ${color} on the dark popup`)
  }
})

test("a missing or malformed surface falls back to the global background", () => {
  for (const bad of [undefined, null, "", "red", 5, "#12"]) {
    assert.deepEqual(Palette.roles(Object.assign({}, DARK, { surface: bad, surfaceText: bad }), {}), Palette.roles(DARK, {}))
  }
})

test("a theme with no mode is judged by its background", () => {
  const noMode = Object.assign({}, LIGHT)
  delete noMode.mode
  const withMode = Palette.roles(LIGHT, {})
  assert.deepEqual(Palette.roles(noMode, {}), withMode)
})

test("a theme missing every named colour falls back to the accent", () => {
  const bare = { mode: "dark", foreground: "#e6e1ff", background: "#0b0e1a", accent: "#2de2e6" }
  const roles = Palette.roles(bare, {})
  for (const [key, color] of everyRole(roles)) {
    assert.match(color, HEX, key)
    assert.equal(color, "#2de2e6", key)
  }
})

test("a theme missing every named colour uses the supplied tinted accents where there is one", () => {
  const bare = { mode: "dark", foreground: "#e6e1ff", background: "#0b0e1a", accent: "#2de2e6" }
  const roles = Palette.roles(bare, { sun: "#ffd27a", rain: "#6fa8ff", snow: "#c8f0ff", storm: "#b36bff", fog: "#9aa4b0" })
  assert.equal(roles.sun, "#ffd27a")
  assert.equal(roles.rain, "#6fa8ff")
  assert.equal(roles.snow, "#c8f0ff")
  assert.equal(roles.storm, "#b36bff")
  assert.equal(roles.fog, "#9aa4b0")
  assert.equal(roles.rainBar, "#6fa8ff")
  assert.equal(roles.tempHigh, "#2de2e6")
})

test("with nothing at all the defaults still give valid, readable roles", () => {
  for (const nothing of [null, undefined, {}, [], 5, "x"]) {
    const roles = Palette.roles(nothing, nothing)
    for (const [key, color] of everyRole(roles)) {
      assert.match(color, HEX, key)
      assert.ok(Palette.contrast(color, "#101315") >= 3, key)
    }
  }
})

test("fallback is per colour: one missing name does not disturb the others", () => {
  const partial = Object.assign({}, DARK)
  delete partial.cyan
  const roles = Palette.roles(partial, { snow: "#c8f0ff" })
  assert.equal(roles.snow, "#c8f0ff")
  assert.equal(roles.sun, "#f9a100")
  assert.equal(roles.tideLow, "#2de2e6") // cyan missing -> accent, which happens to be cyan here
  const noAccent = Object.assign({}, partial, { accent: "#ff00ff" })
  assert.equal(Palette.roles(noAccent, {}).tideLow, "#ff00ff")
})

test("a malformed colour in the palette is treated as missing", () => {
  const broken = Object.assign({}, DARK, { yellow: "yellow", blue: 5, red: "#12", green: null })
  const roles = Palette.roles(broken, { rain: "#6fa8ff" })
  assert.equal(roles.sun, "#2de2e6")
  assert.equal(roles.rain, "#6fa8ff")
  assert.equal(roles.uv[0], "#2de2e6")
  assert.equal(roles.uv[3], "#2de2e6")
})

test("a malformed fallback is ignored in favour of the accent", () => {
  const bare = { mode: "dark", foreground: "#e6e1ff", background: "#0b0e1a", accent: "#2de2e6" }
  assert.equal(Palette.roles(bare, { sun: "banana", rain: 3 }).sun, "#2de2e6")
})

test("upper-case and short hex palettes are normalised", () => {
  const roles = Palette.roles(Object.assign({}, DARK, { yellow: "#F9A100" }), {})
  assert.equal(roles.sun, "#f9a100")
})

// ---- tones and icons ------------------------------------------------------

test("a tone name resolves to a role colour, or nothing", () => {
  const roles = Palette.roles(DARK, {})
  assert.equal(Palette.toneColor(roles, "uv0"), roles.uv[0])
  assert.equal(Palette.toneColor(roles, "uv4"), roles.uv[4])
  assert.equal(Palette.toneColor(roles, "tempHigh"), roles.tempHigh)
  assert.equal(Palette.toneColor(roles, "rainAmount"), roles.rainAmount)
  for (const bad of ["", "uv5", "uv-1", "uvx", "nope", null, undefined, 3, "constructor", "__proto__"]) {
    assert.equal(Palette.toneColor(roles, bad), "", String(bad))
  }
  assert.equal(Palette.toneColor(null, "uv0"), "")
})

test("weather codes pick an icon role: sun, rain, snow, storm, fog, else the plain foreground", () => {
  const cases = [[0, "sun"], [1, "sun"], [2, ""], [3, ""], [45, "fog"], [48, "fog"], [51, "rain"], [55, "rain"], [61, "rain"],
    [65, "rain"], [66, "rain"], [67, "rain"], [80, "rain"], [82, "rain"], [71, "snow"], [75, "snow"], [77, "snow"],
    [85, "snow"], [86, "snow"], [95, "storm"], [96, "storm"], [99, "storm"]]
  for (const [code, kind] of cases) assert.equal(Palette.iconRole(code), kind, String(code))
  for (const bad of [null, undefined, "x", NaN, -1, 4, 100, [], {}]) assert.equal(Palette.iconRole(bad), "", String(bad))
})
