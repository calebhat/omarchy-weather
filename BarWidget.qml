import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "io.github.calebhat.weather"

  readonly property var radar: bar && bar.shell ? bar.shell.serviceFor("io.github.calebhat.weather") : null
  readonly property bool showBarTemp: setting("showBarTemp", false) === true
  readonly property string barTemp: {
    var p = panelLoader.item
    if (!p || !p.reportTempNum) return ""
    return String(p.reportTempNum) + "°"
  }
  readonly property bool barTempVisible: showBarTemp && barTemp !== ""

  function syncService() {
    if (root.radar && "settings" in root.radar) root.radar.settings = root.settings
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("radar" in target) target.radar = root.radar
  }

  function refresh() {
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing (Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root). Open maps to the
  // panel's hotkey path so summoning suppresses the center hover reveal,
  // matching what the old per-plugin IpcHandler did.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function handlePress(b) {
    if (b === Qt.RightButton) {
      if (panelLoader.item && panelLoader.item.notifyCurrent) panelLoader.item.notifyCurrent()
    } else if (b === Qt.MiddleButton) root.refresh()
    else root.togglePanel()
  }

  visible: true
  implicitWidth: cluster.implicitWidth
  implicitHeight: cluster.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: { injectPanel(); syncService() }
  onRadarChanged: { injectPanel(); syncService() }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Row {
    id: cluster
    spacing: root.barTempVisible ? Style.space(2) : 0

    BarIconButton {
      id: button
      bar: root.bar
      text: panelLoader.item ? (panelLoader.item.barLabel || panelLoader.item.label || "") : ""
      slotSize: Style.bar.statusSlot
      interactive: false
      tooltipText: ""
    }

    Text {
      visible: root.barTempVisible
      text: root.barTemp
      color: root.bar ? root.bar.barForeground : Color.foreground
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
      renderType: Text.NativeRendering
      anchors.verticalCenter: parent.verticalCenter
    }
  }

  MouseArea {
    anchors.fill: cluster
    acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: if (root.bar) root.bar.showTooltip(root, "Weather — click forecast, middle refresh, right notify")
    onExited: if (root.bar) root.bar.hideTooltip(root)
    onClicked: function(mouse) { root.handlePress(mouse.button) }
  }
}
