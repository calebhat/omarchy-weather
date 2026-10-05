import QtQuick
import qs.Commons

// Label / value pairs for a detail card, in two columns. The rows come
// pre-formatted from Detail.js; this only draws them.
Grid {
  id: grid

  property var entries: []
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Util.alpha(foreground, 0.8)

  columns: 2
  columnSpacing: Style.space(16)
  rowSpacing: Style.space(6)

  Repeater {
    model: grid.entries

    Row {
      required property var modelData
      width: (grid.width - grid.columnSpacing) / 2
      spacing: Style.space(6)

      Text {
        textFormat: Text.PlainText
        width: parent.width * 0.48
        elide: Text.ElideRight
        text: modelData.label
        color: grid.dim
        font.family: grid.fontFamily
        font.pixelSize: Style.font.caption
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width * 0.52 - parent.spacing
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignRight
        text: modelData.value
        color: grid.foreground
        font.family: grid.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }
  }
}
