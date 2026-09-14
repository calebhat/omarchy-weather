pragma ComponentBehavior: Bound

import QtQuick

// A small radial Canvas behind the selected forecast. Soft gradients fake the
// feel of blur without allocating a shader layer for the whole panel.
Item {
  id: root

  property bool active: true
  property bool storm: false
  property real phase: 0
  property color accentColor: "#5aa9ff"
  property color urgentColor: "#ff5577"
  property color liveColor: storm ? urgentColor : accentColor

  opacity: active ? 1 : 0
  scale: active ? 1 : 0.84

  Behavior on opacity { NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
  Behavior on scale { NumberAnimation { duration: 460; easing.type: Easing.OutBack } }
  Behavior on liveColor { ColorAnimation { duration: 520; easing.type: Easing.OutCubic } }

  Canvas {
    id: energyCanvas
    anchors.fill: parent
    antialiasing: true

    function alpha(color, amount) {
      return Qt.rgba(color.r, color.g, color.b, amount).toString()
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (!root.active || width <= 0 || height <= 0) return

      var cx = width / 2
      var cy = height / 2
      var radius = Math.min(width * 0.43, height * 0.72)
      var breath = 0.5 + 0.5 * Math.sin(root.phase)
      var counterBreath = 0.5 + 0.5 * Math.sin(root.phase + Math.PI * 0.72)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, 0.58)
      ctx.translate(-cx, -cy)

      var aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * (1.05 + breath * 0.08))
      aura.addColorStop(0, alpha(root.liveColor, root.storm ? 0.24 : 0.17))
      aura.addColorStop(0.28, alpha(root.liveColor, root.storm ? 0.14 : 0.095))
      aura.addColorStop(0.62, alpha(root.liveColor, 0.045 + breath * 0.025))
      aura.addColorStop(1, alpha(root.liveColor, 0))
      ctx.fillStyle = aura
      ctx.beginPath()
      ctx.arc(cx, cy, radius * (1.05 + breath * 0.08), 0, Math.PI * 2)
      ctx.fill()

      // Two outer rings breathe out of phase. The old inner ring was dropped
      // because it cut straight through the hero temperature now that the
      // detail card has no background of its own to sit on.
      var ringScales = [0.79 + counterBreath * 0.042, 0.99 + breath * 0.055]
      var ringAlpha = root.storm ? [0.22, 0.15] : [0.15, 0.09]
      for (var i = 0; i < ringScales.length; i++) {
        ctx.beginPath()
        ctx.arc(cx, cy, radius * ringScales[i], 0, Math.PI * 2)
        ctx.strokeStyle = alpha(root.liveColor, ringAlpha[i])
        ctx.lineWidth = Math.max(1, 2.4 - i * 0.55)
        ctx.stroke()
      }

      // Counter-rotating partial arcs introduce motion even when the forecast
      // orbit itself is resting.
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 1.06, root.phase, root.phase + Math.PI * 1.12)
      ctx.strokeStyle = alpha(root.liveColor, root.storm ? 0.55 : 0.36)
      ctx.lineWidth = 2.2
      ctx.stroke()

      ctx.restore()
    }

    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    Connections {
      target: root
      function onPhaseChanged() { energyCanvas.requestPaint() }
      function onLiveColorChanged() { energyCanvas.requestPaint() }
      function onStormChanged() { energyCanvas.requestPaint() }
      function onActiveChanged() { energyCanvas.requestPaint() }
    }
  }
}
