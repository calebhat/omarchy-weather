pragma ComponentBehavior: Bound

import QtQuick

// The sky behind the forecast orbit, drawn from live observations rather than
// decoration. One Canvas paints every weather state so they can share the same
// wind vector and the same edge treatment:
//
//   clear day     sun on its real arc between sunrise and sunset, with rays
//   clear night   a twinkling star field
//   cloudy        parallax cloud banks travelling with the actual wind
//   rain          wind-leaned streaks over a thick deck
//   snow          slow flakes that sway as they fall
//   thunderstorm  the above plus forked lightning and a double-blink flash
//
// Softness comes from radial gradients rather than a blur effect, the same
// trick WeatherEnergyCore uses, which keeps this cheap enough to repaint every
// frame.
Item {
  id: root

  property bool active: true
  property bool storm: false
  property real phase: 0
  // 0 = clear sky (a couple of wisps), 1 = fully overcast. Fed by the live
  // cloud_cover observation when the hub is showing today.
  property real density: 0.6
  // Observed wind. Speed is mph; direction is the meteorological "from"
  // bearing in degrees, exactly as Open-Meteo reports it, so 90 means an
  // easterly and the deck has to travel to the left.
  property real windSpeed: 6
  property real windFromDeg: -1
  // 0 = dry, 1 = heavy. Drives the falling layer.
  property real precip: 0
  // Frozen precipitation drifts instead of streaking.
  property bool snow: false
  property bool night: false
  // Position of the sun along its arc for the day being shown: 0 at sunrise,
  // 1 at sunset, and -1 when the sun is down.
  property real sunProgress: -1
  property color accentColor: "#5aa9ff"
  property color urgentColor: "#ff5577"
  property color sunColor: "#ffc46b"
  property color liveColor: storm ? urgentColor : accentColor

  // The deck is drawn in a washed-out version of the condition color so it
  // stays condition-aware without disappearing into a dark theme.
  readonly property color cloudTint: Qt.lighter(liveColor, root.night ? 1.45 : 1.9)

  // Screen-space wind vector. Meteorological bearings name where wind comes
  // FROM, so travel is the opposite heading; north is up, so the vertical
  // component is -cos. Without a reading, fall back to a gentle westerly.
  readonly property real windToRad: (windFromDeg >= 0 ? windFromDeg + 180 : 270) * Math.PI / 180
  readonly property real windX: Math.sin(windToRad)
  readonly property real windY: -Math.cos(windToRad)
  // Spans per second. A dead calm still creeps, a gale still resolves as
  // motion rather than a blur.
  readonly property real driftRate: Math.max(0.004, Math.min(0.075, 0.004 + windSpeed * 0.0022))

  // How much clear sky is on show. Below roughly a third cover the sun or the
  // stars are worth drawing; above it they would only be a smear behind cloud.
  readonly property real openSky: Math.max(0, 1 - density / 0.62)

  property real driftT: 0
  property real fallT: 0
  property real flash: 0
  property real strikeSeed: 0.5

  // Accumulated by frame rather than animated to a fixed endpoint: the wind
  // reading changes on every refresh, and a NumberAnimation restarts from
  // `from` whenever its duration is reassigned, which would teleport the whole
  // deck. Integrating dt keeps a wind change as a change in speed only.
  FrameAnimation {
    running: root.active
    onTriggered: {
      root.driftT += frameTime * root.driftRate
      root.fallT += frameTime
    }
  }

  // Fire a strike now. The timer below is deliberately irregular, which makes
  // a strike impossible to screenshot on purpose, so this exists to make the
  // state verifiable on demand.
  function triggerStrike() {
    root.strikeSeed = Math.random()
    strikeFlash.restart()
  }

  // ---- Lightning. Strikes are irregular on purpose: a metronome reads as an
  //      effect, an uneven gap reads as weather.
  Timer {
    id: strikeTimer
    running: root.active && root.storm
    repeat: true
    interval: 2600
    onTriggered: {
      root.strikeSeed = Math.random()
      strikeFlash.restart()
      // 1.8s to 6.4s. Re-rolled every strike.
      interval = 1500 + Math.random() * 3800
    }
  }

  // Real lightning almost always blinks more than once: a bright leader, a
  // near-black gap, then a weaker return stroke.
  SequentialAnimation {
    id: strikeFlash
    NumberAnimation { target: root; property: "flash"; to: 1; duration: 50 }
    PauseAnimation { duration: 70 }
    NumberAnimation { target: root; property: "flash"; to: 0.22; duration: 110 }
    NumberAnimation { target: root; property: "flash"; to: 0.90; duration: 70 }
    NumberAnimation { target: root; property: "flash"; to: 0.55; duration: 160 }
    NumberAnimation { target: root; property: "flash"; to: 0; duration: 620; easing.type: Easing.OutCubic }
  }

  opacity: active ? 1 : 0

  Behavior on opacity { NumberAnimation { duration: 520; easing.type: Easing.OutCubic } }
  Behavior on density { NumberAnimation { duration: 700; easing.type: Easing.InOutCubic } }
  Behavior on precip { NumberAnimation { duration: 700; easing.type: Easing.InOutCubic } }
  Behavior on liveColor { ColorAnimation { duration: 520; easing.type: Easing.OutCubic } }

  Canvas {
    id: skyCanvas
    anchors.fill: parent
    antialiasing: true

    // Fixed table instead of Math.random(): the deck must look identical
    // every repaint, otherwise the clouds would boil instead of drift.
    // row, xSeed (0..1), ySeed (0..1), scale, speed, alpha weight
    readonly property var banks: [
      [0, 0.02, 0.14, 1.00, 1.00, 1.00],
      [0, 0.27, 0.06, 0.74, 1.00, 0.80],
      [0, 0.51, 0.21, 1.16, 1.00, 0.96],
      [0, 0.79, 0.10, 0.88, 1.00, 0.84],
      [1, 0.09, 0.48, 0.66, 0.58, 0.74],
      [1, 0.34, 0.38, 0.92, 0.58, 0.86],
      [1, 0.61, 0.55, 0.58, 0.58, 0.66],
      [1, 0.86, 0.42, 1.04, 0.58, 0.80],
      [2, 0.15, 0.78, 1.30, 0.30, 0.72],
      [2, 0.41, 0.90, 0.86, 0.30, 0.62],
      [2, 0.68, 0.72, 1.08, 0.30, 0.68],
      [2, 0.92, 0.86, 0.76, 0.30, 0.56]
    ]

    // Offsets of the puffs that make up one cloud, in units of the cloud's
    // own radius. Slightly asymmetric so no bank reads as a snowman.
    readonly property var puffs: [
      [-0.86, 0.16, 0.58],
      [-0.34, -0.12, 0.86],
      [0.18, -0.24, 1.00],
      [0.72, 0.02, 0.72],
      [1.16, 0.20, 0.48],
      [0.02, 0.26, 0.78]
    ]

    // Cheap deterministic hash. Stable across repaints, which is what keeps
    // the star field and the rain from boiling. A linear congruential form
    // was tried first and had to go: (n * salt + c) % m walks in equal steps,
    // so the stars came out on a visible lattice and the rain combed. Taking
    // the fractional part of a scaled sine decorrelates successive n.
    function hash(n, salt) {
      var v = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453
      return v - Math.floor(v)
    }

    function drawCloud(ctx, cx, cy, radius, alpha) {
      for (var i = 0; i < puffs.length; i++) {
        var p = puffs[i]
        var px = cx + p[0] * radius
        var py = cy + p[1] * radius
        var pr = Math.max(1, p[2] * radius)
        var g = ctx.createRadialGradient(px, py, pr * 0.12, px, py, pr)
        var c = root.cloudTint
        // A held core then a fast falloff. A single linear ramp from centre
        // to edge just produces fog; the plateau is what gives a puff a top.
        g.addColorStop(0, Qt.rgba(c.r, c.g, c.b, alpha).toString())
        g.addColorStop(0.42, Qt.rgba(c.r, c.g, c.b, alpha * 0.90).toString())
        g.addColorStop(0.72, Qt.rgba(c.r, c.g, c.b, alpha * 0.34).toString())
        g.addColorStop(1, Qt.rgba(c.r, c.g, c.b, 0).toString())
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ---- CLEAR DAY. The sun sits where it actually is: sunProgress is the
    //      fraction of the way from sunrise to sunset, so a morning panel puts
    //      it low on the left and noon puts it overhead.
    function drawSun(ctx, w, h, strength) {
      var p = root.sunProgress
      var cx = w * (0.12 + 0.76 * p)
      var cy = h * (0.86 - Math.sin(p * Math.PI) * 0.62)
      var r = Math.min(w * 0.10, h * 0.22)
      var c = root.sunColor
      var spin = root.fallT / 9000

      // Rays first so the disc burns through them.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(spin)
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2
        var len = r * (2.5 + Math.sin(spin * 2.2 + i) * 0.55)
        var rg = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len)
        rg.addColorStop(0, Qt.rgba(c.r, c.g, c.b, 0.20 * strength).toString())
        rg.addColorStop(1, Qt.rgba(c.r, c.g, c.b, 0).toString())
        ctx.strokeStyle = rg
        ctx.lineWidth = r * 0.30
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9)
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
        ctx.stroke()
      }
      ctx.restore()

      // Broad atmospheric bloom, then the disc.
      var bloom = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 4.2)
      bloom.addColorStop(0, Qt.rgba(c.r, c.g, c.b, 0.30 * strength).toString())
      bloom.addColorStop(0.35, Qt.rgba(c.r, c.g, c.b, 0.10 * strength).toString())
      bloom.addColorStop(1, Qt.rgba(c.r, c.g, c.b, 0).toString())
      ctx.fillStyle = bloom
      ctx.beginPath()
      ctx.arc(cx, cy, r * 4.2, 0, Math.PI * 2)
      ctx.fill()

      var disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      disc.addColorStop(0, Qt.rgba(1, 1, 1, 0.82 * strength).toString())
      disc.addColorStop(0.45, Qt.rgba(c.r, c.g, c.b, 0.70 * strength).toString())
      disc.addColorStop(1, Qt.rgba(c.r, c.g, c.b, 0).toString())
      ctx.fillStyle = disc
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // ---- CLEAR NIGHT. Two magnitudes of star, each twinkling on its own
    //      period so the field never pulses in unison.
    function drawStars(ctx, w, h, strength) {
      for (var i = 0; i < 90; i++) {
        var sx = hash(i + 1, 9301) * w
        var sy = hash(i + 1, 4831) * h
        var mag = hash(i + 1, 2749)
        var tw = 0.55 + 0.45 * Math.sin(root.fallT / (620 + mag * 900) + i)
        var a = (0.20 + mag * 0.62) * tw * strength
        var r = Math.max(0.6, (0.5 + mag * 1.4) * (w / 700))
        ctx.fillStyle = Qt.rgba(1, 1, 1, a).toString()
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
        // The brightest few get a soft halo so the field has depth.
        if (mag > 0.93) {
          var hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 5)
          hg.addColorStop(0, Qt.rgba(1, 1, 1, a * 0.30).toString())
          hg.addColorStop(1, Qt.rgba(1, 1, 1, 0).toString())
          ctx.fillStyle = hg
          ctx.beginPath()
          ctx.arc(sx, sy, r * 5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // ---- THUNDERSTORM. A forked channel from the cloud base, drawn twice:
    //      a wide soft pass for the glow, a thin bright pass for the channel.
    function drawBolt(ctx, w, h) {
      var seed = root.strikeSeed
      // Strike down one of the outer thirds. A bolt through the middle draws
      // itself straight over the hero temperature, which is the one thing on
      // the stage that must stay readable.
      var x = seed < 0.5 ? w * (0.10 + seed * 0.44) : w * (0.66 + (seed - 0.5) * 0.44)
      var y = h * 0.04
      var pts = [[x, y]]
      var steps = 11
      for (var i = 1; i <= steps; i++) {
        var t = i / steps
        // Small jitter over many segments reads as a lightning channel; large
        // jitter over few segments reads as a folded ribbon.
        var jitter = (hash(seed * 97 + i, 61.51) - 0.5) * w * 0.045
        pts.push([x + jitter + root.windX * t * w * 0.06, y + t * h * 0.58])
      }

      function stroke(width, alpha, color) {
        ctx.strokeStyle = Qt.rgba(color.r, color.g, color.b, alpha).toString()
        ctx.lineWidth = width
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1])
        ctx.stroke()
        // One fork, branching off two thirds of the way down.
        // Two forks off different heights, each leaning away from the trunk.
        var forks = [[Math.max(2, Math.floor(pts.length * 0.45)), 0.10],
                     [Math.max(3, Math.floor(pts.length * 0.72)), 0.14]]
        for (var f = 0; f < forks.length; f++) {
          var b = forks[f][0]
          var dirF = (f === 0 ? -1 : 1) * (seed < 0.5 ? 1 : -1)
          ctx.beginPath()
          ctx.moveTo(pts[b][0], pts[b][1])
          ctx.lineTo(pts[b][0] + dirF * w * 0.055, pts[b][1] + h * forks[f][1])
          ctx.stroke()
        }
      }

      var glow = root.urgentColor
      stroke(Math.max(5, w * 0.020), 0.26 * root.flash, glow)
      stroke(Math.max(2, w * 0.006), 0.55 * root.flash, glow)
      stroke(Math.max(1, w * 0.0020), 1.0 * root.flash, Qt.rgba(1, 1, 1, 1))
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (!root.active || width <= 0 || height <= 0) return

      // ---- Clear-sky layer, behind everything. Fades out as cloud moves in.
      if (root.openSky > 0.02) {
        if (root.night) drawStars(ctx, width, height, root.openSky)
        else if (root.sunProgress >= 0) drawSun(ctx, width, height, root.openSky)
      }

      var travel = root.driftT
      // Wider than the stage so a bank is fully off-screen before it wraps.
      var span = width * 1.6
      var vspan = height * 1.6
      var margin = width * 0.3
      var vmargin = height * 0.3
      var baseRadius = Math.min(width * 0.125, height * 0.30)
      var lift = 0.30 + root.density * 0.70

      if (root.density > 0.01) {
        for (var i = 0; i < banks.length; i++) {
          var b = banks[i]
          // Every row travels with the real wind; the per-row speed is
          // parallax only, so the near deck outruns the far one instead of the
          // layers sliding against each other in a way no sky does.
          var speed = travel * b[4]
          // Seeds are placed inside the visible band first, then wrapped
          // around the oversized span, so a still deck fills the stage instead
          // of parking a third of its banks off-screen.
          var ox = (margin + b[1] * width + root.windX * speed * span) % span
          if (ox < 0) ox += span
          var oy = (vmargin + b[2] * height + root.windY * speed * vspan) % vspan
          if (oy < 0) oy += vspan
          var x = ox - margin
          var y = oy - vmargin + Math.sin(root.phase * 0.6 + i) * height * 0.014
          var radius = baseRadius * b[3] * (0.82 + root.density * 0.30)
          var alpha = (root.storm ? 0.150 : 0.115) * b[5] * lift
          drawCloud(ctx, x, y, radius, alpha)
        }
      }

      // ---- Falling layer. Rain is a short streak leaned by the wind; snow is
      //      a slow flake that sways sideways on its own period. Both are
      //      seeded off the hash so the field is stable between repaints.
      if (root.precip > 0.02) {
        var drops = Math.round(24 + root.precip * 130)
        var fall = root.fallT / 1000
        var speedY = root.snow ? 0.055 : (0.34 + root.precip * 0.30)
        var lean = root.windX * (root.snow ? 0.55 : 0.22)
        var pc = root.snow ? Qt.rgba(1, 1, 1, 1) : root.cloudTint
        ctx.lineCap = "round"
        for (var d = 0; d < drops; d++) {
          var h1 = hash(d + 1, 9301)
          var h2 = hash(d + 1, 4831)
          var h3 = hash(d + 1, 2749)
          var prog = (h2 + fall * speedY * (0.7 + h3 * 0.6)) % 1
          var sway = root.snow ? Math.sin(fall * (0.7 + h3) + h1 * 6.283) * 0.035 : 0
          var dx = (h1 + prog * lean + sway) % 1
          if (dx < 0) dx += 1
          var px2 = dx * width
          var py2 = prog * height
          var a = (root.snow ? 0.42 : 0.30) * (0.45 + root.precip * 0.55) * (0.5 + h3 * 0.5)
          if (root.snow) {
            ctx.fillStyle = Qt.rgba(pc.r, pc.g, pc.b, a).toString()
            ctx.beginPath()
            ctx.arc(px2, py2, Math.max(1, width * 0.0026 * (0.7 + h3)), 0, Math.PI * 2)
            ctx.fill()
          } else {
            var len = height * (0.030 + root.precip * 0.028) * (0.7 + h3 * 0.6)
            ctx.strokeStyle = Qt.rgba(pc.r, pc.g, pc.b, a).toString()
            ctx.lineWidth = Math.max(1, width * 0.0012)
            ctx.beginPath()
            ctx.moveTo(px2, py2)
            ctx.lineTo(px2 + lean * len * 2.2, py2 + len)
            ctx.stroke()
          }
        }
      }

      // Feather all four edges. Without this the clip rectangle around the
      // stage shows up as a hard-edged grey box - the exact thing this panel
      // is trying to get away from. destination-out erases by source alpha,
      // so each gradient eats the sky back to nothing at the boundary.
      ctx.globalCompositeOperation = "destination-out"
      var fadeX = width * 0.14
      var fadeY = height * 0.16
      var edges = [
        [ctx.createLinearGradient(0, 0, fadeX, 0), 0, 0, fadeX, height],
        [ctx.createLinearGradient(width, 0, width - fadeX, 0), width - fadeX, 0, fadeX, height],
        [ctx.createLinearGradient(0, 0, 0, fadeY), 0, 0, width, fadeY],
        [ctx.createLinearGradient(0, height, 0, height - fadeY), 0, height - fadeY, width, fadeY]
      ]
      for (var e = 0; e < edges.length; e++) {
        var grad = edges[e][0]
        grad.addColorStop(0, "rgba(0,0,0,1)")
        grad.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = grad
        ctx.fillRect(edges[e][1], edges[e][2], edges[e][3], edges[e][4])
      }

      // Clear a soft hole over the hub. The sky should pass behind the
      // forecast, not sit on top of the number you came here to read.
      var holeR = Math.min(width * 0.30, height * 0.62)
      var hole = ctx.createRadialGradient(width / 2, height / 2, holeR * 0.18,
                                          width / 2, height / 2, holeR)
      hole.addColorStop(0, "rgba(0,0,0,0.92)")
      hole.addColorStop(0.55, "rgba(0,0,0,0.55)")
      hole.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = hole
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = "source-over"

      // ---- Lightning goes last, on purpose. Drawn with the rest of the sky
      //      it was being eaten by the two destination-out passes above: the
      //      hub hole erases 92% of its alpha exactly where the channel
      //      crosses the middle of the stage, so the strike never showed. The
      //      veil is radial rather than a filled rect so drawing it after the
      //      edge feather still does not put a hard box on the stage.
      if (root.storm && root.flash > 0.01) {
        var fx = width * (0.16 + root.strikeSeed * 0.68)
        var veil = ctx.createRadialGradient(fx, height * 0.24, 0,
                                            fx, height * 0.24, Math.max(width, height) * 0.95)
        veil.addColorStop(0, Qt.rgba(1, 1, 1, 0.20 * root.flash).toString())
        veil.addColorStop(0.45, Qt.rgba(1, 1, 1, 0.075 * root.flash).toString())
        veil.addColorStop(1, Qt.rgba(1, 1, 1, 0).toString())
        ctx.fillStyle = veil
        ctx.fillRect(0, 0, width, height)
        drawBolt(ctx, width, height)
      }
    }

    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    Connections {
      target: root
      function onDriftTChanged() { skyCanvas.requestPaint() }
      function onFallTChanged() { skyCanvas.requestPaint() }
      function onPhaseChanged() { skyCanvas.requestPaint() }
      function onDensityChanged() { skyCanvas.requestPaint() }
      function onPrecipChanged() { skyCanvas.requestPaint() }
      function onFlashChanged() { skyCanvas.requestPaint() }
      function onSunProgressChanged() { skyCanvas.requestPaint() }
      function onLiveColorChanged() { skyCanvas.requestPaint() }
      function onCloudTintChanged() { skyCanvas.requestPaint() }
      function onWindXChanged() { skyCanvas.requestPaint() }
      function onWindYChanged() { skyCanvas.requestPaint() }
      function onStormChanged() { skyCanvas.requestPaint() }
      function onActiveChanged() { skyCanvas.requestPaint() }
    }
  }
}
