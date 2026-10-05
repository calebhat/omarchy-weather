# Notice

This plugin combines and adapts two MIT-licensed Omarchy plugins plus
patterns from Omarchy's built-in weather widget.

- Forecast panel, metric cards, and Open-Meteo/wttr helpers:
  [Weathering](https://github.com/howdyitskyle/weathering-omarchy-plugin)
  © 2026 Kyle Greenan
- Storm-alert logic adapted from:
  [Weather Radar](https://github.com/eduardodallecort/omarchy-weather-radar)
  © 2026 Eduardo Pereira da Rosa Dalle Cort
- Bar-widget contract and location file format:
  Omarchy `omarchy.weather` © David Heinemeier Hansson

Weather data remains copyright of the providers (Open-Meteo, wttr.in).
Tide predictions are from NOAA CO-OPS (US government work) and the Canadian
Hydrographic Service, Fisheries and Oceans Canada, used under the Open
Government Licence – Canada; `tide-stations.json` lists their stations.
Radar websites opened in the browser remain those sites' own products.

## SunCalc

`Moon.js` ports the moon functions (moon position, illumination, rise and set)
from [SunCalc](https://github.com/mourner/suncalc), used under its BSD-2-Clause
licence:

```
Copyright (c) 2026, Volodymyr Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
