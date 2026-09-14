pragma ComponentBehavior: Bound

import QtQuick

Item {
  id: root

  property bool active: false
  // 0→1 covers the old view; 1→2 uncovers the new view.
  property real progress: 0
  property real direction: 1
  property color accentColor: "#5aa9ff"
  property color surfaceColor: "#15171b"
  property color foregroundColor: "white"
  property string glyph: ""
  property string label: "REFRESHING FORECAST"
  property string fontFamily: "sans-serif"
  property real shimmerPhase: 0

  visible: active
  opacity: active ? 1 : 0
  clip: true

  Behavior on accentColor {
    ColorAnimation {
      duration: 360
      easing.type: Easing.OutCubic
    }
  }

  NumberAnimation on shimmerPhase {
    from: 0
    to: Math.PI * 2
    duration: 1100
    loops: Animation.Infinite
    running: root.active
  }

  Canvas {
    id: waveCanvas
    anchors.fill: parent
    antialiasing: true

    function alpha(color, amount) {
      return Qt.rgba(color.r, color.g, color.b, amount).toString()
    }

    function wavePath(ctx, boundary, amplitude, fillLeft) {
      var h = height
      ctx.beginPath()
      if (fillLeft) {
        ctx.moveTo(0, 0)
        ctx.lineTo(boundary, 0)
      } else {
        ctx.moveTo(width, 0)
        ctx.lineTo(boundary, 0)
      }
      ctx.bezierCurveTo(boundary + amplitude * 0.90, h * 0.17, boundary - amplitude * 0.88, h * 0.34, boundary + Math.sin(root.shimmerPhase) * amplitude * 0.18, h * 0.50)
      ctx.bezierCurveTo(boundary + amplitude * 0.82, h * 0.66, boundary - amplitude * 0.94, h * 0.84, boundary, h)
      if (fillLeft)
        ctx.lineTo(0, h)
      else
        ctx.lineTo(width, h)
      ctx.closePath()
    }

    function fillWave(ctx, boundary, amplitude, fillLeft, fillStyle) {
      wavePath(ctx, boundary, amplitude, fillLeft)
      ctx.fillStyle = fillStyle
      ctx.fill()
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (!root.active || width <= 0 || height <= 0)
        return
      var covering = root.progress <= 1
      var t = covering ? root.progress : root.progress - 1
      var dir = root.direction >= 0 ? 1 : -1
      var margin = Math.max(28, width * 0.075)
      var travel = width + margin * 2
      var boundary = dir > 0 ? -margin + t * travel : width + margin - t * travel
      var fillLeft = covering ? dir > 0 : dir < 0
      var fringeSign = covering ? dir : -dir
      var amplitude = Math.max(14, Math.min(34, height * 0.072))

      // The translucent crests lead the opaque surface while covering and
      // trail it while revealing, which gives the edge real liquid depth.
      fillWave(ctx, boundary + fringeSign * 30, amplitude * 1.18, fillLeft, alpha(root.accentColor, 0.16))
      fillWave(ctx, boundary + fringeSign * 16, amplitude, fillLeft, alpha(root.accentColor, 0.34))
      fillWave(ctx, boundary, amplitude * 0.86, fillLeft, root.surfaceColor.toString())

      // A narrow luminous lip keeps the wipe readable on both light and dark
      // themes without applying a costly full-panel shader.
      ctx.save()
      wavePath(ctx, boundary, amplitude * 0.86, fillLeft)
      ctx.strokeStyle = alpha(root.accentColor, 0.88)
      ctx.lineWidth = Math.max(1.5, width / 300)
      ctx.stroke()
      ctx.restore()
    }

    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    Connections {
      target: root
      function onProgressChanged() {
        waveCanvas.requestPaint()
      }
      function onDirectionChanged() {
        waveCanvas.requestPaint()
      }
      function onAccentColorChanged() {
        waveCanvas.requestPaint()
      }
      function onSurfaceColorChanged() {
        waveCanvas.requestPaint()
      }
      function onShimmerPhaseChanged() {
        waveCanvas.requestPaint()
      }
    }
  }

  Item {
    id: statusOverlay
    anchors.centerIn: parent
    width: Math.min(parent.width * 0.72, 300)
    height: statusColumn.implicitHeight
    opacity: root.active ? Math.max(0, Math.min(1, 1 - Math.abs(root.progress - 1) * 3.2)) : 0
    scale: 0.88 + statusOverlay.opacity * 0.12

    Column {
      id: statusColumn
      anchors.centerIn: parent
      spacing: 8

      Text {
        textFormat: Text.PlainText
        anchors.horizontalCenter: parent.horizontalCenter
        text: root.glyph
        color: root.accentColor
        font.family: root.fontFamily
        font.pixelSize: 42
      }

      Text {
        textFormat: Text.PlainText
        anchors.horizontalCenter: parent.horizontalCenter
        text: root.label
        color: root.foregroundColor
        font.family: root.fontFamily
        font.pixelSize: 11
        font.bold: true
        font.letterSpacing: 1.5
      }

      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: 7

        Repeater {
          model: 3

          Rectangle {
            required property int index
            width: 5
            height: 5
            radius: width / 2
            color: root.accentColor
            opacity: 0.30 + 0.70 * Math.max(0, Math.sin(root.shimmerPhase - index * Math.PI / 3))
            scale: 0.72 + opacity * 0.42
          }
        }
      }
    }
  }

  MouseArea {
    anchors.fill: parent
    enabled: root.active
    acceptedButtons: Qt.AllButtons
    preventStealing: true
    onPressed: function (mouse) {
      mouse.accepted = true
    }
    onWheel: function (wheel) {
      wheel.accepted = true
    }
  }
}
