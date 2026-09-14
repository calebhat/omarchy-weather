# Contributing

Source of truth: this repository, installed as a normal Omarchy plugin.
Display name is **Detailed Weather**; plugin id is `io.github.calebhat.weather`.

```bash
omarchy plugin add https://github.com/calebhat/omarchy-weather.git --enable
omarchy plugin validate ~/.config/omarchy/plugins/io.github.calebhat.weather
```

Edit that checkout. Do not keep a second copy inside private dotfiles.

Forecast UI follows Weathering; radar follows omarchy-weather-radar. Keep
location in `~/.local/state/omarchy/settings/weather.json` via
`omarchy-weather-location`. Do not add a second location store.

Browser radar must stay an argv call to `omarchy-launch-browser` with an
`https://` URL from `RadarModel.resolveRadarUrl`. Custom URLs are https-only.
Do not restore `bar.run` with `$(…)` for notifications.
Do not bring back an in-panel radar map unless one provider supplies both
history and forecast tiles.

Commit as `calebhat <97716470+calebhat@users.noreply.github.com>`.

Marketplace listing: [issue #1265](https://github.com/omacom/omarchy-plugin-marketplace/issues/1265).
To ship a new snapshot, open a `[Verify]` issue (newer upstream commit) against `omacom/omarchy-plugin-marketplace`. Do not open a duplicate `[Plugin]` submission.
