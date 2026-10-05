import QtQuick
import qs.Commons
import "Palette.js" as Palette

// Label / value lines for a detail card. The entries come pre-formatted from
// Detail.js; this only draws them. An entry with `segments` draws each piece in
// the colour of its tone, taken from `roles`; the rest stays the foreground.
//
// Each line is the full card width. The value sits at the right of its label
// when it fits there; when it would not, it moves to its own line under the
// label and wraps across the full width. It never overlaps or is cut short.
Column {
  id: grid

  property var entries: []
  property var roles: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Util.alpha(foreground, 0.8)

  spacing: Style.space(6)

  function segmentColor(tone) {
    var hex = Palette.toneColor(roles, tone)
    return hex !== "" ? hex : foreground
  }

  // One piece of a value. An inline component cannot see this file's ids, so
  // the colour and font family come in as properties from where it is used.
  component Segment: Text {
    required property var modelData
    property color tint: Color.foreground
    property string family: ""
    textFormat: Text.PlainText
    text: modelData.text
    color: tint
    font.family: family
    font.pixelSize: Style.font.bodySmall
  }

  Repeater {
    model: grid.entries

    Item {
      id: entry
      required property var modelData
      readonly property var parts: modelData.segments && modelData.segments.length > 0
        ? modelData.segments
        : [{ text: modelData.value, tone: "" }]
      readonly property bool stacked: measure.implicitWidth > width - label.implicitWidth - Style.space(12)

      width: grid.width
      implicitHeight: stacked
        ? label.implicitHeight + Style.space(2) + wrapped.implicitHeight
        : Math.max(label.implicitHeight, measure.implicitHeight)
      height: implicitHeight

      Text {
        id: label
        textFormat: Text.PlainText
        text: entry.modelData.label
        color: grid.dim
        font.family: grid.fontFamily
        font.pixelSize: Style.font.caption
      }

      // The value's natural width, to decide which layout it gets.
      Row {
        id: measure
        visible: false
        Repeater {
          model: entry.parts
          Segment {
            tint: grid.segmentColor(modelData.tone)
            family: grid.fontFamily
          }
        }
      }

      Row {
        visible: !entry.stacked
        anchors.right: parent.right
        Repeater {
          model: entry.parts
          Segment {
            tint: grid.segmentColor(modelData.tone)
            family: grid.fontFamily
          }
        }
      }

      Flow {
        id: wrapped
        visible: entry.stacked
        y: label.implicitHeight + Style.space(2)
        width: parent.width
        Repeater {
          model: entry.parts
          Segment {
            tint: grid.segmentColor(modelData.tone)
            family: grid.fontFamily
          }
        }
      }
    }
  }
}
