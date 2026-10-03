# Zoom, pan and measure a chart, and watch the grid follow

A [Lattice Grid](https://latticegrid.dev) demo. US electricity output, month by month, in three charts that all write
their view into one grid: a **line** on a time axis (`zoom`, `viewportFilter`, `measure`, `annotate`), a **bar** of the
mean by year (`zoom`, `viewportFilter`) and a **scatter** of each month against the one before (`zoom: { axes: 'xy' }`,
`viewportFilter`). The **grid** and four **KPI tiles** (months in view, mean, lowest, highest) show exactly the rows in view.
Grid 1.86.2 from the jsDelivr CDN; no API keys, no analytics.

Try it: wheel or pinch on the line to zoom, drag to pan, `0` resets; `M` or the ruler button on the rail, then drag to
measure (delta, % change, slope); the rail's other tools draw on the chart and the drawing stays on its data when you
zoom. The chart rail has no freehand pen (that is the grid's own annotation layer, which draws in pixels); the demo uses
the chart's data-anchored tools such as the trend line. The bar chart zooms with its hover buttons and pans by drag; wheel
zoom on a category bar chart does not work in 1.86.2 (BACKLOG-0001715, fixed in 1.86.3), and the demo does not work around it.

## Run it

    python3 -m http.server      # then open http://localhost:8000/ (add ?theme=dark for dark)

## Data

[IPG2211N](https://fred.stlouisfed.org/series/IPG2211N), Industrial Production: Utilities: Electric Power Generation,
Transmission and Distribution (index 2017=100, not seasonally adjusted), Board of Governors of the Federal Reserve
System (US), retrieved from FRED, Federal Reserve Bank of St. Louis. FRED tags it **Public Domain: Citation Requested**;
the citation is on the page. FRED sends no CORS headers, so the raw monthly CSV (656 rows, 12.6 KB, copied from the
forecast demo) is committed as `data/IPG2211N.csv`. The page adds "last month" itself; the first month has none, so
the grid holds 655 rows. Nothing is precomputed.

## Check it

    node tools/verify.mjs [--shots dir]     # Node 22+, real headless Chrome over DevTools, no dependencies

Real wheel, drag, click and key events, light and dark; every count, mean, extreme and measure readout is recomputed
from the CSV and compared with the page.

## Licence

See `LICENSE`.
