// Wiring for the zoom / pan / measure demo: one grid, three charts that write their view into it, four KPI tiles.
(async () => {
  const el = (id) => document.getElementById(id);
  const { createGrid, createChart, createStat } = LatticeGrid;
  const csv = (await (await fetch('data/IPG2211N.csv?v=20261005a')).text()).trim().split('\n').slice(1);
  let last = null;
  const rows = csv.map((line) => {
    const [date, v] = line.split(',');
    const value = Number(v);
    const row = { date, year: date.slice(0, 4), month: Number(date.slice(5, 7)), value, prev: last };
    last = value;
    return row;
  }).filter((r) => r.prev !== null);

  const grid = createGrid(el('grid'), {
    rowKey: 'date', density: 'compact', selection: 'none', statusBar: true, columnMenu: false,
    columns: [
      { id: 'date', field: 'date', title: 'Month', type: 'date', format: { type: 'date', pattern: 'MMM yyyy' } },
      { id: 'year', field: 'year', title: 'Year', type: 'text' },
      { id: 'value', field: 'value', title: 'Index', type: 'number', format: { type: 'number', decimals: 1 } },
      { id: 'prev', field: 'prev', title: 'Last month', type: 'number', format: { type: 'number', decimals: 1 } },
    ],
  });
  grid.rows.load(rows);

  const view = { zoom: true, viewportFilter: true };
  const line = createChart({ grid, container: el('line'), type: 'line', x: 'date', y: 'value', ...view,
    measure: true, annotate: true });
  const bar = createChart({ grid, container: el('bar'), type: 'bar', x: 'year', measures: [{ col: 'value', fn: 'avg' }], axis: { x: { scale: 'band', every: 6 } }, ...view });
  const scatter = createChart({ grid, container: el('scatter'), type: 'scatter', x: 'prev', y: 'value',
    zoom: { axes: 'xy' }, viewportFilter: true });

  const tile = (id, title, fn, decimals) => createStat({ grid, container: el(id), title, of: 'value', fn,
    format: { type: 'number', decimals } });
  tile('k-count', 'Months in view', 'count', 0);
  tile('k-mean', 'Mean index', 'avg', 1);
  tile('k-min', 'Lowest', 'min', 1);
  tile('k-max', 'Highest', 'max', 1);
  window.demo = { grid, line, bar, scatter, rows };
})();
