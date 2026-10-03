/**
 * Real-browser check (headless Chrome over DevTools, Node 22+, no dependencies; see tools/cdp.mjs).
 * Real wheel, drag, click and key events on the page, light and dark; every figure is recomputed here
 * from data/IPG2211N.csv and compared with what the grid, the tiles and the charts show.
 *
 *   node tools/verify.mjs [--shots <dir>]
 */
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, root } from './cdp.mjs';

const shots = process.argv.includes('--shots') ? resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const lines = (await readFile(join(root, 'data', 'IPG2211N.csv'), 'utf8')).trim().split('\n').slice(1);
let prev = null;
const data = []; // the rows the page builds: the first month has no "last month", so it is left out
for (const l of lines) { const [date, v] = l.split(','); const value = Number(v); if (prev !== null) data.push({ date, year: date.slice(0, 4), value, prev }); prev = value; }
const stats = (rs) => ({ n: rs.length, mean: rs.reduce((t, r) => t + r.value, 0) / rs.length, min: Math.min(...rs.map((r) => r.value)), max: Math.max(...rs.map((r) => r.value)) });
const failures = []; const notes = [];
const check = (ok, what, detail = '') => { (ok ? notes : failures).push(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const page = await launch();
const live = () => page.eval(`(() => {
  const g = demo.grid; const tiles = [...document.querySelectorAll('.kpis > div')].map((d) => d.innerText.replace(/\\n/g, ' '));
  const keys = []; g.rows.forEach((r) => keys.push(r.date ?? r.id));
  return { n: g.rows.count(), tiles, conds: (g.filters.get()?.conditions || []).map((c) => ({ col: c.col, op: c.op, value: c.value })),
    status: document.querySelector('#grid .lattice-statusbar, #grid [class*=status]')?.innerText || '' };
})()`);
const tilesMatch = (got, rs) => { const s = stats(rs); const t = got.tiles.join('|'); return t.includes(`Months in view ${s.n}`) && t.includes(`Mean index ${s.mean.toFixed(1)}`) && t.includes(`Lowest ${s.min.toFixed(1)}`) && t.includes(`Highest ${s.max.toFixed(1)}`); };
const verts = (sel) => page.eval(`(() => { const svg = document.querySelector('${sel} svg.lat-chartview__plot'); const r = svg.getBoundingClientRect();
  return [r.x, r.y, [...svg.querySelector('path.lat-chartview__line').getAttribute('d').matchAll(/[ML] ([\\d.-]+) ([\\d.-]+)/g)].map((m) => [+m[1], +m[2]])]; })()`);
const centre = (sel) => page.eval(`(() => { const r = document.querySelector('${sel} svg.lat-chartview__plot').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const centreOf = (sel) => page.eval(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const reset = async (sel) => { await page.eval(`document.querySelector('${sel} svg.lat-chartview__plot').focus()`); await page.key('0', 'Digit0', '0'); await sleep(700); };
const inRange = (c) => data.filter((r) => r.date >= c.value[0] && r.date <= c.value[1]);

try {
  for (const theme of ['light', 'dark']) {
    await page.open(theme);
    const T = theme;
    let got = await live();
    check(got.n === data.length && tilesMatch(got, data), `${T}: starts on all ${data.length} rows; tiles agree with the data`, got.tiles.join(' | '));

    // 1. Real wheel zoom on the line.
    const [cx, cy] = await centre('#line');
    await page.wheel(cx, cy, -300); await sleep(500); await page.wheel(cx, cy, -300); await sleep(900);
    got = await live();
    let c = got.conds.find((k) => k.col === 'date');
    let expect = c ? inRange(c) : [];
    check(!!c && got.n === expect.length && got.n < data.length && tilesMatch(got, expect), `${T}: wheel zoom narrows grid + tiles to exactly the rows in view`, `${got.n} rows, ${c?.value.join('..')}, recount ${expect.length}`);
    check(got.status.includes(`${got.n} of ${data.length}`), `${T}: grid status line reads the same count`, got.status.trim().slice(0, 40));
    if (shots) { await mkdir(shots, { recursive: true }); await page.shot(join(shots, `zoom-${T}.png`)); }

    // 2. Drag pan moves the range.
    const before = c.value[0];
    await page.drag(cx, cy, cx - 150, cy); await sleep(900);
    got = await live(); c = got.conds.find((k) => k.col === 'date'); expect = c ? inRange(c) : [];
    check(!!c && c.value[0] > before && got.n === expect.length && tilesMatch(got, expect), `${T}: drag pan moves the range and the rows`, `${before} -> ${c?.value[0]}; ${got.n} rows, recount ${expect.length}`);

    // 3. 0 restores everything.
    await reset('#line'); got = await live();
    check(got.n === data.length && got.conds.length === 0 && tilesMatch(got, data), `${T}: 0 restores all rows and clears the filter`, `${got.n}`);

    // 4. Measure tool: a real drag, checked against the data.
    const [ox, oy, v] = await verts('#line');
    const [i, j] = [300, 420];
    const [bx, by] = await centreOf('#line [data-tool="measure"]');
    await page.click(bx, by); await sleep(300);
    await page.drag(ox + v[i][0], oy + v[i][1], ox + v[j][0], oy + v[j][1]); await sleep(500);
    const read = await page.eval(`document.querySelector('#line .lat-chartview__measure-live').textContent`);
    await page.key('Enter', 'Enter', '\r'); await sleep(300);
    const [m] = (await page.eval('demo.line.state()')).annotations.filter((a) => a.kind === 'measure');
    const [a, b] = m.anchors.map((p) => ({ ...p, row: data.find((r) => r.date === p.x) }));
    const dy = b.row.value - a.row.value; const days = Math.round((Date.parse(b.x) - Date.parse(a.x)) / 864e5);
    const want = { dx: `${days.toLocaleString('en-US')} d`, dy: `${dy >= 0 ? '+' : '-'}${Math.abs(dy).toFixed(0)}`, pct: `${dy >= 0 ? '+' : '-'}${Math.abs((100 * dy) / a.row.value).toFixed(0)}%`, slope: `${dy >= 0 ? '+' : '-'}${Math.abs(dy / days).toFixed(6)} per day` };
    check(!!a.row && !!b.row && a.row.date === data[i].date && b.row.date === data[j].date, `${T}: measure ends snapped to the data points dragged between`, `${a.x} .. ${b.x}`);
    check(read.includes(want.dx) && read.includes(want.dy) && read.includes(want.pct) && read.includes(want.slope), `${T}: measure readout equals the data`, `got "${read}"; want ${JSON.stringify(want)}; exact dy ${dy.toFixed(4)}`);

    // 5. A drawing (trend line from the rail) stays on its data when zoomed.
    const [tx, ty] = await centreOf('#line [data-tool="trendLine"]');
    await page.click(tx, ty); await sleep(300);
    const [p, q] = [200, 520];
    await page.drag(ox + v[p][0], oy + v[p][1], ox + v[q][0], oy + v[q][1]); await sleep(500);
    const trend = (await page.eval('demo.line.state()')).annotations.find((k) => k.kind === 'trendLine');
    const ms = (d) => Date.parse(d);
    const A = trend?.anchors || [];
    // The drag started on a vertex, so each anchor is that reading to within the pixel it was dropped on.
    check(A.length === 2 && [p, q].every((k, n) => near(ms(data[k].date), A[n].x, 3 * 864e5 * 30) && near(data[k].value, A[n].y, 1.5)), `${T}: trend-line drawing anchored on the data points it was drawn at`, `${A.map((s) => `${new Date(s.x).toISOString().slice(0, 7)}@${s.y.toFixed(1)}`).join(' .. ')} vs ${data[p].date}@${data[p].value} .. ${data[q].date}@${data[q].value}`);
    await page.wheel(cx, cy, -300); await sleep(500); await page.wheel(cx, cy, -300); await sleep(900);
    got = await live(); c = got.conds.find((k) => k.col === 'date'); const vis = inRange(c);
    const [, , nv] = await verts('#line');
    const drawn = await page.eval(`(() => { const s = document.querySelector('#line svg.lat-chartview__plot');
      return [...s.querySelectorAll('.lat-chartview__drawn-line')].map((e) => [...(e.getAttribute('d') || '').matchAll(/[ML] ([\\d.-]+) ([\\d.-]+)/g)].map((m) => [+m[1], +m[2]])); })()`);
    // Pixel position of any (date, value) from the line's own first/last and lowest/highest vertices.
    const hi = nv.reduce((m, pt, k) => (vis[k].value > vis[m].value ? k : m), 0); const lo = nv.reduce((m, pt, k) => (vis[k].value < vis[m].value ? k : m), 0);
    const px = (d) => nv[0][0] + ((ms(d) - ms(vis[0].date)) * (nv.at(-1)[0] - nv[0][0])) / (ms(vis.at(-1).date) - ms(vis[0].date));
    const py = (v) => nv[lo][1] + ((v - vis[lo].value) * (nv[hi][1] - nv[lo][1])) / (vis[hi].value - vis[lo].value);
    const w0 = [px(new Date(A[0].x).toISOString().slice(0, 10)), py(A[0].y)]; const w1 = [px(new Date(A[1].x).toISOString().slice(0, 10)), py(A[1].y)];
    const hit = drawn.some((d) => d.length === 2 && near(d[0][0], w0[0], 2) && near(d[0][1], w0[1], 2) && near(d[1][0], w1[0], 2) && near(d[1][1], w1[1], 2));
    check(nv.length === vis.length && hit && JSON.stringify((await page.eval('demo.line.state()')).annotations.find((k) => k.kind === 'trendLine').anchors) === JSON.stringify(A), `${T}: after a wheel zoom the drawing sits at the same two readings (anchors unchanged, pixels recomputed)`, `view ${vis.length} rows from ${vis[0].date}; expected px ${w0.map(Math.round)} / ${w1.map(Math.round)}; drawn ${JSON.stringify(drawn.filter((d) => d.length === 2).map((d) => d.map((x) => x.map(Math.round))))}`);
    await reset('#line');
    await page.eval(`demo.line.setState({ annotations: [] })`);

    // 6. Scatter, x and y: real wheel narrows both axes and the grid.
    const [sx, sy] = await centre('#scatter');
    await page.wheel(sx, sy, -300); await sleep(500); await page.wheel(sx, sy, -300); await sleep(900);
    got = await live();
    const cx1 = got.conds.find((k) => k.col === 'prev'); const cy1 = got.conds.find((k) => k.col === 'value');
    const expS = data.filter((r) => cx1 && cy1 && r.prev >= cx1.value[0] && r.prev <= cx1.value[1] && r.value >= cy1.value[0] && r.value <= cy1.value[1]);
    check(!!cx1 && !!cy1 && got.n === expS.length && got.n < data.length && tilesMatch(got, expS), `${T}: scatter x+y wheel zoom narrows the grid to the points in view`, `${got.n} rows; x ${cx1?.value.map((n) => n.toFixed(1))} y ${cy1?.value.map((n) => n.toFixed(1))}; recount ${expS.length}`);
    await reset('#scatter'); got = await live();
    check(got.n === data.length, `${T}: scatter 0 restores all rows`, `${got.n}`);

    // 7. Bar: the toolbar's zoom-in button (the wheel is checked next).
    const [pbx, pby] = await centre('#bar');
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pbx, y: pby }); await sleep(400);
    for (let k = 0; k < 2; k++) { const [zx, zy] = await centreOf('#bar button[aria-label="Zoom in"]'); await page.click(zx, zy); await sleep(400); }
    await sleep(700); got = await live();
    const cb = got.conds.find((k) => k.col === 'year'); const expB = cb ? data.filter((r) => cb.value.includes(r.year)) : [];
    check(!!cb && got.n === expB.length && got.n < data.length && tilesMatch(got, expB), `${T}: bar toolbar zoom narrows the grid to the visible years`, `${got.n} rows, ${cb?.value.length} years ${cb?.value[0]}..${cb?.value.at(-1)}; recount ${expB.length}`);
    await reset('#bar'); got = await live();
    check(got.n === data.length, `${T}: bar 0 restores all rows`, `${got.n}`);
    // 7b. Bar: a real wheel on the bars.
    const [wbx, wby] = await centre('#bar');
    await page.wheel(wbx, wby, -300); await sleep(500); await page.wheel(wbx, wby, -300); await sleep(900); got = await live();
    const cw = got.conds.find((k) => k.col === 'year'); const expW = cw ? data.filter((r) => cw.value.includes(r.year)) : [];
    check(!!cw && got.n === expW.length && got.n < data.length && tilesMatch(got, expW), `${T}: bar wheel zoom narrows the grid to the visible years`, `${got.n} rows, ${cw?.value.length} years; recount ${expW.length}`);
    await reset('#bar'); got = await live();
    check(got.n === data.length, `${T}: bar 0 restores all rows after the wheel`, `${got.n}`);
    const meta = await page.eval(`({ v: LatticeGrid.getVersion(), wm: !!document.querySelector("[class*=watermark]") || /unlicen|watermark/i.test(document.body.textContent) })`);
    check(meta.v === '1.86.2' && !meta.wm, `${T}: version ${meta.v}, no watermark`);

    const real = page.bad.filter((t) => !/parser-blocking, cross site/.test(t));
    check(real.length === 0, `${T}: console clean (0 errors, 0 warnings; the loader advisory excluded)`, real.join(' | ').slice(0, 500));
  }
} finally { await page.close(); }
console.log(notes.join('\n')); if (failures.length) console.log(failures.join('\n'));
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
