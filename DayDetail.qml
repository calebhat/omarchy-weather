import QtQuick
import qs.Commons

// Detail card for one day. `card` is the object Detail.dayDetail returns.
Column {
  id: root

  property var card: null
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Util.alpha(foreground, 0.8)
  // Tallest bar is the day's wettest hour, but never less than 1 mm, so a
  // drizzly day does not draw its drizzle at full height.
  readonly property real stripMax: {
    var top = 1
    var strip = card ? card.rainStrip : []
    for (var i = 0; i < strip.length; i++)
      if (strip[i].mm !== null && strip[i].mm > top) top = strip[i].mm
    return top
  }

  spacing: Style.space(10)

  Text {
    textFormat: Text.PlainText
    text: root.card ? root.card.title : ""
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.heading
    font.bold: true
  }

  DetailRows {
    width: parent.width
    entries: root.card ? root.card.rows : []
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  Column {
    width: parent.width
    spacing: Style.space(4)
    visible: !!root.card && root.card.rainStrip.length > 0

    Text {
      textFormat: Text.PlainText
      text: "Rain by hour"
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    Row {
      id: strip
      width: parent.width
      height: Style.space(36)
      spacing: Style.space(1)

      Repeater {
        model: root.card ? root.card.rainStrip : []

        // An hour with no amount draws a faint stub instead of a bar.
        Item {
          required property var modelData
          width: (strip.width - strip.spacing * 23) / 24
          height: strip.height

          Rectangle {
            anchors.bottom: parent.bottom
            width: parent.width
            height: modelData.mm === null ? 1 : Math.max(1, parent.height * modelData.mm / root.stripMax)
            radius: 1
            color: root.foreground
            opacity: modelData.mm === null ? 0.2 : (modelData.mm > 0 ? 0.85 : 0.2)
          }
        }
      }
    }

    Item {
      width: parent.width
      height: axis.implicitHeight

      Text {
        id: axis
        textFormat: Text.PlainText
        anchors.left: parent.left
        text: "00"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
      Text {
        textFormat: Text.PlainText
        anchors.horizontalCenter: parent.horizontalCenter
        text: "12"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
      Text {
        textFormat: Text.PlainText
        anchors.right: parent.right
        text: "23"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  // SLOT: moon (feature 2) — phase, illumination, moonrise and moonset.
  // SLOT: tides (feature 3) — that day's highs and lows and the station.
  // Both stay empty on this branch.
}
