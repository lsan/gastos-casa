/* =====================================================================
   Gastos Casa · graficas.js — gráficas SVG sin dependencias
   Cada marca lleva data-tip="texto" y el tooltip global lo muestra.
   ===================================================================== */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n, d = 0) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: d, minimumFractionDigits: d }).format(n);

  // Donut: items [{label, value, color}], total en el centro
  function donut(items, { size = 220, thickness = 34, center = '', sub = '' } = {}) {
    const total = items.reduce((s, i) => s + i.value, 0);
    const r = size / 2 - 4; const ir = r - thickness; const cx = size / 2; const cy = size / 2;
    let a0 = -Math.PI / 2; const paths = [];
    const gap = items.length > 1 ? 0.012 : 0;
    for (const it of items) {
      if (it.value <= 0) continue;
      const frac = it.value / total; let a1 = a0 + frac * Math.PI * 2;
      const s = a0 + gap / 2; const e = Math.max(s + 0.001, a1 - gap / 2);
      const large = e - s > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
      const d = frac >= 0.9999
        ? `M${p(r, 0)} A${r},${r} 0 1 1 ${p(r, Math.PI)} A${r},${r} 0 1 1 ${p(r, 0)} M${p(ir, 0)} A${ir},${ir} 0 1 0 ${p(ir, Math.PI)} A${ir},${ir} 0 1 0 ${p(ir, 0)}Z`
        : `M${p(r, s)} A${r},${r} 0 ${large} 1 ${p(r, e)} L${p(ir, e)} A${ir},${ir} 0 ${large} 0 ${p(ir, s)}Z`;
      paths.push(`<path d="${d}" fill="${esc(it.color)}" fill-rule="evenodd" data-tip="${esc(it.label)} · ${esc(eur(it.value, 2))} · ${(frac * 100).toFixed(1)}%" style="cursor:pointer"${it.key ? ` data-cat="${esc(it.key)}"` : ''}/>`);
      a0 = a1;
    }
    if (!paths.length) paths.push(`<circle cx="${cx}" cy="${cy}" r="${(r + ir) / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Gastos por categoría">
      ${paths.join('')}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${esc(center)}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="var(--muted)">${esc(sub)}</text>
    </svg>`;
  }

  // Barras apiladas por mes. months: ['2026-10',...]; series: [{key,label,color,values:[...]}]; line: {label, values} opcional
  function stackedBars(months, series, { height = 300, line = null, monthLabel = (m) => m } = {}) {
    const W = 760; const H = height; const ml = 56; const mr = 12; const mt = 14; const mb = 34;
    const totals = months.map((_, i) => series.reduce((s, se) => s + Math.max(0, se.values[i] || 0), 0));
    const maxV = Math.max(1, ...totals, ...(line ? line.values : [0]));
    const step = niceStep(maxV / 4); const top = Math.ceil(maxV / step) * step;
    const y = (v) => mt + (H - mt - mb) * (1 - v / top);
    const bw = Math.min(46, ((W - ml - mr) / months.length) * 0.62);
    const x = (i) => ml + ((W - ml - mr) / months.length) * (i + 0.5);
    let g = '';
    for (let v = 0; v <= top + 0.001; v += step) {
      g += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
            <text x="${ml - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(eur(v))}</text>`;
    }
    let bars = '';
    months.forEach((m, i) => {
      let acc = 0; const segs = series.filter((se) => (se.values[i] || 0) > 0);
      segs.forEach((se, j) => {
        const v = se.values[i]; const y0 = y(acc); const y1 = y(acc + v); acc += v;
        const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0));
        const isTop = j === segs.length - 1; const rx = isTop ? 4 : 0;
        bars += isTop
          ? `<path d="M${x(i) - bw / 2},${y0} V${y1 + rx} Q${x(i) - bw / 2},${y1} ${x(i) - bw / 2 + rx},${y1} H${x(i) + bw / 2 - rx} Q${x(i) + bw / 2},${y1} ${x(i) + bw / 2},${y1 + rx} V${y0}Z" fill="${esc(se.color)}" data-tip="${esc(monthLabel(m))} · ${esc(se.label)}: ${esc(eur(v, 2))}"/>`
          : `<rect x="${x(i) - bw / 2}" y="${y0 - h}" width="${bw}" height="${h}" fill="${esc(se.color)}" data-tip="${esc(monthLabel(m))} · ${esc(se.label)}: ${esc(eur(v, 2))}"/>`;
      });
      bars += `<rect x="${x(i) - bw / 2 - 6}" y="${mt}" width="${bw + 12}" height="${H - mt - mb}" fill="transparent" data-tip="${esc(monthLabel(m))} · total gastos ${esc(eur(totals[i], 2))}${line ? ` · ${esc(line.label)} ${esc(eur(line.values[i] || 0, 2))}` : ''}" style="pointer-events:${totals[i] ? 'none' : 'all'}"/>`;
      g += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11.5" fill="var(--text-2)">${esc(monthLabel(m))}</text>`;
    });
    let ln = '';
    if (line) {
      const pts = months.map((_, i) => `${x(i)},${y(line.values[i] || 0)}`).join(' ');
      ln = `<polyline points="${pts}" fill="none" stroke="var(--text)" stroke-width="2" stroke-dasharray="5 4"/>` +
        months.map((m, i) => `<circle cx="${x(i)}" cy="${y(line.values[i] || 0)}" r="5" fill="var(--surface)" stroke="var(--text)" stroke-width="2" data-tip="${esc(monthLabel(m))} · ${esc(line.label)}: ${esc(eur(line.values[i] || 0, 2))}"/>`).join('');
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolución mensual">${g}${bars}${ln}</svg>`;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  // Tooltip global
  function bindTooltips(rootEl) {
    const tip = document.getElementById('tooltip');
    rootEl.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.classList.add('hidden'); return; }
      tip.textContent = t.getAttribute('data-tip'); tip.classList.remove('hidden');
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
    rootEl.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  }

  window.Graficas = { donut, stackedBars, bindTooltips, eur, esc };
})();
