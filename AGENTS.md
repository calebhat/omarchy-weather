# AGENTS.md

Omarchy shell plugin (`service` + `bar-widget`). Display name:
**Detailed Weather**. Plugin id stays `io.github.calebhat.weather`.
Disable `omarchy.weather` when enabling this one so the bar has a
single weather pill.

## Layout

- `manifest.json` — contract, settings schema
- `BarWidget.qml` — bar pill; forwards panel contract; injects the service
- `Panel.qml` — forecast panel, peek, Open radar, Settings
- `Service.qml` — optional storm alerts; NWS corroboration; the alert latch
- `Model.js` — forecast parsing (Open-Meteo / wttr)
- `RadarModel.js` — saved radar website URLs; alert helpers; the NWS gate

There is no in-panel radar map.

## Data

Open-Meteo, wttr.in, and — US locations with storm alerts on, only —
api.weather.gov. Location file owned by `omarchy-weather-location`.
Open radar launches a user-saved https website.

The alert latch persists to `~/.local/state/omarchy/detailed-weather-alert.json`
(level, place, time). It has to: the shell rebuilds every plugin service
whenever any plugin writes inside its own directory, so an in-memory latch is
emptied several times an hour and the same storm gets announced again each time.

Two rules hold everywhere in the alert path. A second opinion that is absent,
uncovered or stale may decline to help but must never mute an alert — an alert
that fails to fire is indistinguishable from fair weather. And a response is
only an answer to the question that was asked: coordinates move while curl is
running, so every request records the place it was for.

Decisions live in `RadarModel.js` as pure functions and are tested with
`node --test test/`; the wiring around them is pinned by `test/test_service_wiring.py`.
`node test/dry-run.js <lat> <lon>` prints what the gate would decide for a real
place right now — point it somewhere with weather to exercise the firing paths.

## Dev

```
omarchy plugin validate ~/.config/omarchy/plugins/io.github.calebhat.weather
qmllint -I "$OMARCHY_PATH/shell" BarWidget.qml Panel.qml Service.qml
omarchy restart shell
```

Hot reload of QML is unreliable after atomic writes; restart the shell.
