#!/usr/bin/env node
// What the corroboration gate would decide, right now, for a real place.
//
//   node test/dry-run.js 33.88 -84.36
//
// This runs the plugin's own request builders and its own parsers — the real
// functions out of RadarModel.js, not a copy — against the live services, and
// prints the verdict for every model reading the forecast could produce. The
// unit tests pin the logic against fixtures; this pins the fixtures against
// reality: a changed response shape, a wrong URL, or an alert vocabulary that
// has moved on all show up here and nowhere else.
//
// It exists because the interesting half of the gate is hard to observe at
// home. Suppression can be watched any clear evening; the paths that *fire*
// need weather. Pointing this at a coordinate that currently has some is the
// way to exercise them without waiting for the storm to come to you.

const { execFileSync } = require("node:child_process")
const { RadarModel } = require("./load.js")

const [lat, lon] = process.argv.slice(2)
if (!lat || !lon) {
  console.error("usage: node test/dry-run.js <lat> <lon>")
  process.exit(2)
}
// Checked here rather than left to the service: unparseable coordinates
// otherwise print "point NaN,NaN" and then a confident report about nowhere.
if (!Number.isFinite(Number(lat)) || Math.abs(Number(lat)) > 90 ||
    !Number.isFinite(Number(lon)) || Math.abs(Number(lon)) > 180) {
  console.error(`not a coordinate on this planet: ${lat},${lon}`)
  process.exit(2)
}

const LEVELS = ["clear", "light", "moderate", "heavy", "severe"]

// stderr is discarded because the most interesting failure is not one: a point
// outside the United States answers 404, and curl announcing that is the tool
// working, not a problem to show the reader.
function fetchJson(command) {
  try {
    return JSON.parse(execFileSync(command[0], command.slice(1), {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }))
  } catch (error) {
    return null
  }
}

const points = fetchJson(RadarModel.nwsCurlGet(RadarModel.nwsPointsUrl(lat, lon), 15))
const parsed = RadarModel.parseNwsPoints(points)

console.log(`point            ${RadarModel.nwsPoint(lat, lon)}`)
if (points && points.properties && points.properties.relativeLocation) {
  const where = points.properties.relativeLocation.properties
  console.log(`office / place   ${points.properties.gridId}  (${where.city}, ${where.state})`)
}
console.log(`covered by NWS   ${parsed.supported}`)

if (!parsed.supported) {
  console.log("\nno local office here, so every model reading passes through untouched:")
  for (let level = 0; level < LEVELS.length; level++) {
    const verdict = RadarModel.corroborate(level, { supported: false })
    console.log(`  model ${LEVELS[level].padEnd(8)} -> ${LEVELS[verdict.level]} (${verdict.source})`)
  }
  process.exit(0)
}

const alerts = fetchJson(RadarModel.nwsCurlGet(RadarModel.nwsAlertsUrl(lat, lon), 15))
const hourly = fetchJson(RadarModel.nwsCurlGet(parsed.hourlyUrl, 20))

const outlook = alerts ? RadarModel.nwsAlertOutlook(alerts) : { level: 0, event: "" }
const pop = hourly ? RadarModel.nwsMaxPop(hourly, 2) : -1

const inForce = alerts && alerts.features ? alerts.features.map(f => f.properties.event) : []
console.log(`alerts in force  ${inForce.length ? inForce.join(", ") : "(none)"}`)
console.log(`  of those, rain ${outlook.level ? `${outlook.event} -> ${LEVELS[outlook.level]}` : "(none)"}`)
console.log(`max PoP (2h)     ${pop < 0 ? "(no opinion)" : pop + "%"}`)

const nws = {
  supported: true,
  fresh: true,
  alertLevel: outlook.level,
  alertEvent: outlook.event,
  maxPop: pop,
}

console.log("\nwhat each model reading would become here and now:")
for (let level = 0; level < LEVELS.length; level++) {
  const verdict = RadarModel.corroborate(level, nws)
  const alerted = verdict.level >= 3 ? "  ALERTS (default Heavy threshold)" : ""
  console.log(`  model ${LEVELS[level].padEnd(8)} -> ${LEVELS[verdict.level].padEnd(8)} ${verdict.source.padEnd(11)}${alerted}`)
}
