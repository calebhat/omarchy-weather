import QtQuick

// Lightweight organic loader: one continuously deforming Canvas path instead
// of an image sequence or a stack of effects. It follows the active weather
// accent and only repaints while a request is actually waiting for data.
Item {
  id: root

  property color accentColor: "#89b4fa"
  property bool running: true
  property real phase: 0
  property real morph: 0

  opacity: running ? 1 : 0
  scale: running ? 1 : 0.72

  Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
  Behavior on scale { NumberAnimation { duration: 340; easing.type: Easing.OutBack } }

  NumberAnimation on phase {
    from: 0
    to: Math.PI * 2
    duration: 2800
    loops: Animation.Infinite
    running: root.running
  }

  NumberAnimation on morph {
    from: 0
    to: Math.PI * 2
    duration: 1900
    loops: Animation.Infinite
    running: root.running
  }

  Canvas {
    id: blob
    anchors.fill: parent
    antialiasing: true
    rotation: root.phase * 180 / Math.PI

    onPaint: {
      var ctx = getContext("2d")
      ctx.clearRect(0, 0, width, height)
      var cx = width / 2
      var cy = height / 2
      var baseRadius = Math.min(width, height) * 0.31
      var points = []
      var count = 36

      for (var i = 0; i < count; i++) {
        var theta = i / count * Math.PI * 2
        var ripple = Math.sin(theta * 3 + root.morph) * 0.13
          + Math.cos(theta * 5 - root.morph * 1.35) * 0.055
        var radius = baseRadius * (1 + ripple)
        points.push({
          x: cx + Math.cos(theta) * radius,
          y: cy + Math.sin(theta) * radius
        })
      }

      ctx.beginPath()
      var firstX = (points[0].x + points[count - 1].x) / 2
      var firstY = (points[0].y + points[count - 1].y) / 2
      ctx.moveTo(firstX, firstY)
      for (var j = 0; j < count; j++) {
        var next = points[(j + 1) % count]
        ctx.quadraticCurveTo(points[j].x, points[j].y,
          (points[j].x + next.x) / 2,
          (points[j].y + next.y) / 2)
      }
      ctx.closePath()

      var fill = ctx.createLinearGradient(0, 0, width, height)
      fill.addColorStop(0, Qt.lighter(root.accentColor, 1.28).toString())
      fill.addColorStop(1, root.accentColor.toString())
      ctx.fillStyle = fill
      ctx.globalAlpha = 0.88
      ctx.fill()

      ctx.globalAlpha = 0.42
      ctx.strokeStyle = Qt.lighter(root.accentColor, 1.55).toString()
      ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.055)
      ctx.stroke()
    }

    Connections {
      target: root
      function onPhaseChanged() { blob.requestPaint() }
      function onMorphChanged() { blob.requestPaint() }
      function onAccentColorChanged() { blob.requestPaint() }
      function onWidthChanged() { blob.requestPaint() }
      function onHeightChanged() { blob.requestPaint() }
    }
  }
}
