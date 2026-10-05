import QtQuick
import qs.Commons

// Detail card for one hour. `card` is the object Detail.hourDetail returns.
Column {
  id: root

  property var card: null
  property var roles: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

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
    roles: root.roles
    foreground: root.foreground
    fontFamily: root.fontFamily
  }
}
