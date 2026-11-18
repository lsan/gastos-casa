/* =====================================================================
   Gastos Casa · app.js — interfaz
   ===================================================================== */
(function () {
  'use strict';
  const { esc, eur } = Graficas;
  const C = window.Core;
  const cfg = window.GASTOS_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const TX_COLS = 'id,account_id,import_id,date,description,merchant,amount,balance,bank_category,bank_subcategory,category_id,card_account_id,categorized_by,needs_review,exceptional,annual,linked_to,note,dedupe_key';
  const SOURCE_LABEL = { ing: 'ING', carrefour: 'Carrefour Pass', revolut: 'Revolut', eci: 'El Corte Inglés', ing_credito: 'Tarjeta crédito ING', generico: 'Otro' };
  const KIND_LABEL = { gasto: 'Gasto', ingreso: 'Ingreso', ahorro: 'Ahorro', traspaso: 'Traspaso interno (no cuenta)', financiacion: 'Financiación (no cuenta)', pago_tarjeta: 'Pago de tarjeta' };
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#5c7a99', '#7a9a3a', '#8f7fcf', '#c76a8c', '#4c9bb5', '#857f72', '#9a9890'];

  const S = {
    user: null, household: null, members: [], accounts: [], categories: [], rules: [], txs: [], imports: [],
    month: null, view: 'panel', movFilter: { month: null, account: '', category: '', q: '', pend: false }, ajTab: 'cuentas',
  };
  let ctx = null;

  // ---------- Utilidades de interfaz ----------
  const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y.slice(2)}`; };
  const monthName = (ym, short = false) => {
    const [y, m] = ym.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
    return short ? s.replace('.', '') + (m === 1 ? ` ${String(y).slice(2)}` : '') : s.charAt(0).toUpperCase() + s.slice(1);
  };
  const curYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const catById = (id) => S.categories.find((c) => c.id === id);
  const accById = (id) => S.accounts.find((a) => a.id === id);
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }
  function rebuildCtx() { ctx = C.makeCtx(S.categories, S.accounts, S.txs); updateBadge(); }
  function updateBadge() {
    const n = S.txs.filter((t) => t.needs_review).length; const b = $('#badge-pend');
    b.textContent = n; b.classList.toggle('hidden', !n);
  }
  function fail(e) { console.error(e); toast('Error: ' + (e.message || e), 5000); }

  function modal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    const bg = root.firstElementChild;
    const close = () => { root.innerHTML = ''; };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
    if (onMount) onMount(bg.firstElementChild, close);
    return close;
  }

  function categoryOptions(selected, { includeEmpty = true, includeNew = true } = {}) {
    const groups = {};
    for (const c of [...S.categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) (groups[c.kind] ||= []).push(c);
    let html = includeEmpty ? `<option value="">— Sin clasificar —</option>` : '';
    for (const k of ['gasto', 'ingreso', 'ahorro', 'traspaso', 'financiacion', 'pago_tarjeta']) {
      if (!groups[k]) continue;
      html += `<optgroup label="${esc(KIND_LABEL[k])}">` + groups[k].map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('') + '</optgroup>';
    }
    if (includeNew) html += `<option value="__new">＋ Nueva categoría…</option>`;
    return html;
  }

  // ---------- Datos ----------
  async function fetchAll(table, cols = '*', order = 'created_at') {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from(table).select(cols).order(order, { ascending: true }).order('id').range(from, from + size - 1);
      if (error) throw error; out.push(...data); if (data.length < size) break;
    }
    return out;
  }
  async function loadAll() {
    const [cats, accs, rules, txs, imps] = await Promise.all([
      fetchAll('categories'), fetchAll('accounts'), fetchAll('rules'), fetchAll('transactions', TX_COLS, 'date'), fetchAll('imports', '*', 'imported_at'),
    ]);
    S.categories = cats; S.accounts = accs; S.rules = rules; S.imports = imps.reverse();
    S.txs = txs.map((t) => ({ ...t, amount: Number(t.amount), balance: t.balance === null ? null : Number(t.balance) }));
    rebuildCtx();
    if (!S.month) {
      const months = [...new Set(S.txs.map((t) => t.date.slice(0, 7)))].sort();
      const now = new Date(); const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      S.month = months.includes(cur) ? cur : (months[months.length - 1] || cur);
    }
  }

  async function updateTxs(ids, patch) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('transactions').update(patch).in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
    for (const t of S.txs) if (ids.includes(t.id)) Object.assign(t, patch);
    rebuildCtx();
  }

  // ---------- Arranque y sesión ----------
  async function start() {
    const { data } = await sb.auth.getSession();
    sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_OUT') location.reload(); if (ev === 'SIGNED_IN' && !S.user && session) enter(session.user); });
    if (data.session) await enter(data.session.user); else showLogin();
  }
  function showLogin() { $('#loading').classList.add('hidden'); $('#login').classList.remove('hidden'); }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#login-error').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) $('#login-error').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
  });
  $('#logout').addEventListener('click', () => sb.auth.signOut());

  async function enter(user) {
    if (S.user) return; S.user = user;
    $('#login').classList.add('hidden'); $('#loading').classList.remove('hidden');
    try {
      const { data: mem, error } = await sb.from('members').select('user_id, household_id, display_name, households(name)');
      if (error) throw error;
      const me = mem.find((m) => m.user_id === user.id);
      if (!me) { $('#loading').innerHTML = '<div class="card">Tu usuario no pertenece a ningún hogar todavía. Ejecuta el script <b>02_inicializar_hogar.sql</b> en Supabase con tu correo.</div>'; return; }
      S.members = mem; S.household = { id: me.household_id, name: me.households?.name };
      $('#user-name').textContent = me.display_name;
      await loadAll();
      $('#loading').classList.add('hidden'); $('#app').classList.remove('hidden');
      Graficas.bindTooltips(document.body);
      window.addEventListener('hashchange', route); route();
    } catch (e) { $('#loading').textContent = 'Error al cargar: ' + e.message; console.error(e); }
  }

  function route() {
    const v = (location.hash || '#panel').slice(1).split('?')[0];
    S.view = ['panel', 'evolucion', 'movimientos', 'pendientes', 'importar', 'ajustes'].includes(v) ? v : 'panel';
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === S.view));
    render();
  }
  function render() {
    const v = $('#view');
    ({ panel: renderPanel, evolucion: renderEvolucion, movimientos: renderMovimientos, pendientes: renderPendientes, importar: renderImportar, ajustes: renderAjustes })[S.view](v);
  }

  // =================================================================
  //  PANEL DEL MES
  // =================================================================
  function renderPanel(v) {
    if (!S.txs.length) {
      v.innerHTML = `<div class="card empty"><div style="font-size:44px">📂</div><h2>Aún no hay movimientos</h2><p>Empieza importando los extractos de ING, Carrefour Pass y Revolut.</p><a class="btn primary" href="#importar">⬆️ Importar extractos</a></div>`;
      return;
    }
    const ym = S.month; const s = C.monthSummary(S.txs, ym, ctx); const avg = C.averages(S.txs, ym, ctx);
    const ff = C.firstFullMonth(S.txs); const prevYm = C.addMonths(ym, -1);
    const prevOk = ff && prevYm >= ff;
    const prev = prevOk ? C.monthSummary(S.txs, prevYm, ctx) : { ingresos: 0, gastos: 0 };
    const partial = ff && ym < ff;
    const warns = C.cardWarnings(S.txs, ctx);
    const cats = [...s.byCat].map(([k, val]) => {
      const c = k === '__pendiente' ? { id: '__pendiente', name: 'Sin clasificar', icon: '❓', color: '#c9c7bf' } : (catById(k) || { id: k, name: '?', icon: '•', color: '#999' });
      return { c, val };
    }).filter((x) => x.val > 0.004).sort((a, b) => b.val - a.val);
    const top = cats.slice(0, 7); const rest = cats.slice(7).reduce((a, x) => a + x.val, 0);
    const donutItems = top.map((x) => ({ label: `${x.c.icon} ${x.c.name}`, value: x.val, color: x.c.color, key: x.c.id }));
    if (rest > 0) donutItems.push({ label: `Resto (${cats.length - 7} categorías)`, value: rest, color: '#bdbab1' });
    const maxVal = cats[0]?.val || 1;
    const vsPrev = prev.gastos ? (s.gastos - prev.gastos) / prev.gastos : null;
    const merchants = [...s.byMerchant].sort((a, b) => b[1] - a[1]).slice(0, 6);

    v.innerHTML = `
      <div class="head">
        <div class="month-nav">
          <button class="btn small" id="m-prev" aria-label="Mes anterior">◀</button>
          <div class="label">${esc(monthName(ym))}</div>
          <button class="btn small" id="m-next" aria-label="Mes siguiente">▶</button>
        </div>
        <span class="muted small">${avg.months.length ? `Comparado con la media de ${avg.months.length} ${avg.months.length === 1 ? 'mes completo anterior' : 'meses completos anteriores'}` : 'Aún no hay meses completos anteriores para comparar'}</span>
      </div>
      ${partial ? '<div class="warn">ℹ️ Este mes está incompleto: los extractos importados no lo cubren entero. Sus cifras no se usan en medias ni comparativas.</div>' : ''}
      ${warns.map((w) => `<div class="warn">💳 <b>${esc(w.card.name)}</b>: ${w.count} cargos en ING (${eur(w.amount, 2)}) desde el ${fmtDate(w.since)} cuentan como <b>gasto provisional</b>, porque el extracto de la tarjeta solo llega hasta ${w.last ? 'el ' + fmtDate(w.last) : '— ninguno —'}. ${w.card.source === 'carrefour' ? 'Cuando se cierre el ciclo (a partir del día 21) descarga el extracto e <a href="#importar">impórtalo</a>: los cargos se sustituirán por las compras una a una.' : '<a href="#importar">Importa su extracto</a> para verlos en detalle.'}</div>`).join('')}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">💼 Ingresos</div><div class="value">${eur(s.ingresos)}</div><div class="sub">${prev.ingresos ? `Mes anterior: ${eur(prev.ingresos)}` : '&nbsp;'}</div></div>
        <div class="card kpi"><div class="label">🧾 Gastos</div><div class="value">${eur(s.gastos)}</div>
          <div class="sub">${vsPrev === null ? '&nbsp;' : `${vsPrev > 0 ? '▲' : '▼'} ${Math.abs(vsPrev * 100).toFixed(0)}% vs mes anterior`}${s.excepcional ? ` · incluye ${eur(s.excepcional)} excepcionales` : ''}</div></div>
        <div class="card kpi"><div class="label">${s.balance >= 0 ? '✅' : '⚠️'} Balance</div><div class="value ${s.balance >= 0 ? 'pos' : 'neg'}">${eur(s.balance)}</div>
          <div class="sub">${s.tasaAhorro === null ? 'Sin ingresos este mes' : `Tasa de ahorro: ${(s.tasaAhorro * 100).toFixed(0)}%`}</div></div>
        <div class="card kpi"><div class="label">🪙 Apartado a ahorro</div><div class="value">${eur(s.ahorro)}</div><div class="sub">Redondeo y cuenta de la niña</div></div>
        <div class="card kpi link" id="kpi-pend"><div class="label">📥 Pendientes de revisar</div><div class="value">${S.txs.filter((t) => t.needs_review).length}</div>
          <div class="sub">${s.pendientesImporte ? `${eur(s.pendientesImporte)} sin clasificar este mes` : 'Todo clasificado este mes 🎉'}</div></div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <h3>¿En qué se ha ido el dinero?</h3>
          <div class="donut-wrap">
            ${Graficas.donut(donutItems, { center: eur(s.gastos), sub: 'gastado' })}
            <div class="legend">${donutItems.map((i) => `<div class="it"><span class="sw" style="background:${esc(i.color)}"></span>${esc(i.label)}<span class="v num">${((i.value / s.gastos) * 100).toFixed(0)}%</span></div>`).join('')}</div>
          </div>
        </div>
        <div class="card">
          <h3>Por categoría <span class="muted small">· vs tu media</span></h3>
          <div class="catlist">
            ${cats.map(({ c, val }) => {
              const a = avg.byCat.get(c.id); let d = '';
              if (a && avg.months.length) { const p = (val - a) / a; d = Math.abs(p) < 0.05 ? '<span class="delta">≈ media</span>' : `<span class="delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲ +' : '▼ '}${(p * 100).toFixed(0)}%</span>`; }
              else d = `<span class="delta">${avg.months.length ? 'nuevo' : ''}</span>`;
              return `<div class="catrow" data-cat="${esc(c.id)}" data-tip="${esc(c.name)}${a ? ` · media ${eur(a)}` : ''}">
                <span>${esc(c.icon)}</span><span>${esc(c.name)}</span><span class="num">${eur(val)}</span>${d}
                <div class="bar"><i style="width:${(val / maxVal * 100).toFixed(1)}%;background:${esc(c.color)}"></i></div></div>`;
            }).join('') || '<div class="empty">Sin gastos este mes</div>'}
          </div>
        </div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card"><h3>Dónde más has gastado</h3>
          <ul class="merchants">${merchants.map(([m, val]) => `<li><span>${esc(m)}</span><b class="num">${eur(val, 2)}</b></li>`).join('') || '<li class="muted">—</li>'}</ul></div>
        <div class="card"><h3>Gastos fijos vs variables</h3>${fixedVsVariable(cats, s.gastos)}</div>
      </div>`;
    $('#m-prev').onclick = () => { S.month = C.addMonths(S.month, -1); render(); };
    $('#m-next').onclick = () => { S.month = C.addMonths(S.month, 1); render(); };
    $('#kpi-pend').onclick = () => { location.hash = '#pendientes'; };
    $$('[data-cat]', v).forEach((el) => el.addEventListener('click', () => {
      S.movFilter = { month: S.month, account: '', category: el.dataset.cat, q: '', pend: false }; location.hash = '#movimientos';
    }));
  }
  function fixedVsVariable(cats, total) {
    let fixed = 0; for (const { c, val } of cats) if (c.fixed) fixed += val;
    const vari = total - fixed; const pf = total ? fixed / total * 100 : 0;
    return `<div style="display:flex;height:14px;border-radius:7px;overflow:hidden;gap:2px;margin:6px 0 12px">
        <i style="width:${pf}%;background:#2a78d6" data-tip="Fijos ${eur(fixed, 2)}"></i><i style="flex:1;background:#eb6834" data-tip="Variables ${eur(vari, 2)}"></i></div>
      <div class="legend"><div class="it"><span class="sw" style="background:#2a78d6"></span>Fijos (hipoteca, colegio, seguros, préstamos…)<span class="v num">${eur(fixed)}</span></div>
      <div class="it"><span class="sw" style="background:#eb6834"></span>Variables (donde podéis recortar)<span class="v num">${eur(vari)}</span></div></div>`;
  }

  // =================================================================
  //  EVOLUCIÓN
  // =================================================================
  function renderEvolucion(v) {
    const nb = C.normalizedByMonth(S.txs, ctx);
    const allMonths = [...new Set(S.txs.map((t) => t.date.slice(0, 7)))].sort();
    if (!allMonths.length) { v.innerHTML = '<div class="card empty">Importa movimientos para ver la evolución.</div>'; return; }
    const last = allMonths[allMonths.length - 1]; const months = []; const ff = C.firstFullMonth(S.txs) || allMonths[0];
    for (let i = 11; i >= 0; i--) { const m = C.addMonths(last, -i); if (m >= ff) months.push(m); }
    if (!months.length) months.push(last);
    const totals = new Map();
    for (const m of months) for (const [c, val] of (nb.get(m) || [])) totals.set(c, (totals.get(c) || 0) + val);
    const order = [...totals].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const topCats = order.slice(0, 7);
    const series = topCats.map((cid) => {
      const c = cid === '__pendiente' ? { name: 'Sin clasificar', color: '#c9c7bf', icon: '❓' } : catById(cid) || { name: '?', color: '#999', icon: '' };
      return { key: cid, label: `${c.icon} ${c.name}`, color: c.color, values: months.map((m) => (nb.get(m) || new Map()).get(cid) || 0) };
    });
    if (order.length > 7) series.push({ key: 'resto', label: 'Resto', color: '#bdbab1', values: months.map((m) => [...(nb.get(m) || [])].filter(([c]) => !topCats.includes(c)).reduce((a, [, x]) => a + x, 0)) });
    const income = months.map((m) => C.monthSummary(S.txs, m, ctx).ingresos);
    v.innerHTML = `
      <div class="head"><h2>Evolución</h2><span class="muted small">Gasto mensual sin excepcionales y con los pagos anuales repartidos en 12 meses · solo meses completos${months.includes(curYm()) ? ' (el actual, en curso)' : ''}</span></div>
      <div class="card">${Graficas.stackedBars(months, series, { line: { label: 'Ingresos', values: income }, monthLabel: (m) => monthName(m, true) })}
        <div class="legend" style="flex-direction:row;flex-wrap:wrap;gap:14px;margin-top:10px">
          ${series.map((s) => `<div class="it"><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.label)}</div>`).join('')}
          <div class="it"><span style="width:18px;border-top:2px dashed var(--text)"></span>Ingresos</div></div></div>
      <div class="card" style="margin-top:16px;overflow-x:auto"><h3>Tabla</h3>
        <table class="simple"><thead><tr><th>Categoría</th>${months.map((m) => `<th class="num">${esc(monthName(m, true))}</th>`).join('')}</tr></thead>
        <tbody>${series.map((s) => `<tr><td>${esc(s.label)}</td>${s.values.map((x) => `<td class="num">${x ? eur(x) : '—'}</td>`).join('')}</tr>`).join('')}
        <tr><td><b>Ingresos</b></td>${income.map((x) => `<td class="num"><b>${eur(x)}</b></td>`).join('')}</tr></tbody></table></div>`;
  }

  // =================================================================
  //  MOVIMIENTOS (y fila reutilizable)
  // =================================================================
  function txRow(t) {
    const acc = accById(t.account_id); const c = catById(t.category_id);
    const linked = t.linked_to ? S.txs.find((x) => x.id === t.linked_to) : null;
    const eff = C.effectOf(t, ctx);
    const effChip = eff === 'excluido' ? '<span class="chip" data-tip="No cuenta como gasto ni ingreso">no computa</span>'
      : C.isProvisional(t, ctx) ? '<span class="chip sug" data-tip="Cuenta como gasto hasta que importes el extracto de la tarjeta; entonces se sustituye por las compras">provisional</span>'
      : (c && c.kind === 'pago_tarjeta' && eff === 'gasto') ? '<span class="chip" data-tip="Tarjeta en modo sin detalle: cuenta como gasto">sin detalle</span>' : '';
    const sug = t.needs_review && t.categorized_by === 'banco' ? '<span class="chip sug" data-tip="Categoría sugerida por ING: confírmala o cámbiala">sugerida</span>' : '';
    return `<div class="tx" data-id="${t.id}">
      <div class="date num">${fmtDate(t.date)}</div>
      <div class="desc"><div class="d" title="${esc(t.description)}">${esc(t.description)}</div>
        <div class="m">${esc(SOURCE_LABEL[acc?.source] || acc?.name || '')}${linked ? ` · ↩ reembolso de «${esc((linked.merchant || linked.description).slice(0, 40))}»` : ''} ${effChip}${sug}</div></div>
      <div class="num ${t.amount >= 0 ? 'pos' : ''}" style="text-align:right;font-weight:600">${eur(t.amount, 2)}</div>
      <div class="catsel">${linked ? `<span class="small muted">${esc(catById(linked.category_id)?.name || '')}</span>` : `<select data-act="cat">${categoryOptions(t.category_id)}</select>`}</div>
      <div class="flags">
        ${t.needs_review && t.category_id ? `<button class="flag on" data-act="ok" data-tip="Confirmar categoría">✓</button>` : ''}
        <button class="flag ${t.exceptional ? 'on' : ''}" data-act="exc" data-tip="Excepcional: no cuenta en medias ni comparativas">⚡</button>
        <button class="flag ${t.annual ? 'on' : ''}" data-act="ann" data-tip="Pago anual: repartir en 12 meses en la evolución">📅</button>
        ${t.amount > 0 ? `<button class="flag ${t.linked_to ? 'on' : ''}" data-act="link" data-tip="Es un reembolso de un gasto (p. ej. un amigo te devuelve su parte)">↩</button>` : ''}
      </div></div>`;
  }
  function bindTxRows(container, rerender) {
    container.addEventListener('change', async (e) => {
      const sel = e.target.closest('select[data-act="cat"]'); if (!sel) return;
      const t = S.txs.find((x) => x.id === sel.closest('.tx').dataset.id);
      if (sel.value === '__new') { sel.value = t.category_id || ''; return newCategoryModal((cat) => changeCategory(t, cat.id, rerender)); }
      changeCategory(t, sel.value || null, rerender);
    });
    container.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const t = S.txs.find((x) => x.id === b.closest('.tx').dataset.id);
      try {
        if (b.dataset.act === 'ok') { await updateTxs([t.id], { needs_review: false, categorized_by: 'usuario' }); rerender(); }
        if (b.dataset.act === 'exc') { await updateTxs([t.id], { exceptional: !t.exceptional }); rerender(); }
        if (b.dataset.act === 'ann') { await updateTxs([t.id], { annual: !t.annual }); rerender(); }
        if (b.dataset.act === 'link') linkModal(t, rerender);
      } catch (err) { fail(err); }
    });
  }

  async function changeCategory(t, catId, rerender) {
    const cat = catById(catId); const card = cat && cat.kind === 'pago_tarjeta' ? cardForPaymentCategory(cat) : null;
    try {
      await updateTxs([t.id], { category_id: catId, card_account_id: card ? card.id : null, categorized_by: catId ? 'usuario' : null, needs_review: !catId });
    } catch (e) { return fail(e); }
    rerender();
    if (catId) ruleModal(t, cat, rerender);
  }
  function cardForPaymentCategory(cat) {
    const n = C.norm(cat.name);
    if (n.includes('CARREFOUR')) return S.accounts.find((a) => a.source === 'carrefour');
    if (n.includes('CORTE')) return S.accounts.find((a) => a.source === 'eci');
    if (n.includes('ING')) return S.accounts.find((a) => a.source === 'ing_credito');
    return null;
  }

  // Aprender: crear regla a partir del movimiento
  function ruleModal(t, cat, rerender) {
    const src = accById(t.account_id)?.source;
    const sug = C.suggestPattern(t.description);
    modal(`<h2>¿Lo recuerdo para la próxima vez?</h2>
      <p class="muted small">Has puesto <b>${esc(t.description)}</b> en <b>${esc(cat.icon)} ${esc(cat.name)}</b>.</p>
      <label>Cuando la descripción contenga…<input id="r-pat" value="${esc(sug)}"></label>
      <label class="switch"><input type="checkbox" id="r-src"> Solo en ${esc(SOURCE_LABEL[src] || 'esta cuenta')}</label>
      <label class="switch"><input type="checkbox" id="r-sign"> Solo ${t.amount < 0 ? 'cargos' : 'abonos'}</label>
      <div id="r-preview" class="small muted"></div>
      <label class="switch"><input type="checkbox" id="r-apply" checked> Aplicar también a los movimientos anteriores que coincidan (no toca los que hayáis clasificado a mano)</label>
      <div class="actions"><button class="btn" data-close>Solo este movimiento</button><button class="btn primary" id="r-save">Crear regla</button></div>`, (m, close) => {
      const build = () => ({ pattern: $('#r-pat', m).value.trim(), match_field: 'description', amount_sign: $('#r-sign', m).checked ? Math.sign(t.amount) : null, account_source: $('#r-src', m).checked ? src : null });
      const matches = () => { const r = build(); if (!r.pattern) return []; return S.txs.filter((x) => x.id !== t.id && x.categorized_by !== 'usuario' && C.ruleMatches(r, x, accById(x.account_id)?.source)); };
      const prev = () => {
        const r = build(); const ms = matches(); const all = r.pattern ? S.txs.filter((x) => C.ruleMatches(r, x, accById(x.account_id)?.source)) : [];
        $('#r-preview', m).innerHTML = r.pattern ? `Coincide con <b>${all.length}</b> movimientos; se reclasificarían <b>${ms.length}</b>.${all.length > 0 && all.length <= 6 ? '<br>' + all.map((x) => esc(x.description)).join('<br>') : ''}` : 'Escribe un texto';
      };
      ['input', 'change'].forEach((ev) => m.addEventListener(ev, prev)); prev();
      $('#r-save', m).onclick = async () => {
        const r = build(); if (!r.pattern) return;
        const card = cat.kind === 'pago_tarjeta' ? cardForPaymentCategory(cat) : null;
        try {
          const { data, error } = await sb.from('rules').insert({ ...r, household_id: S.household.id, category_id: cat.id, card_account_id: card ? card.id : null, priority: 100, origin: 'usuario', created_by: S.user.id }).select().single();
          if (error) throw error; S.rules.push(data);
          let n = 0;
          if ($('#r-apply', m).checked) { const ids = matches().map((x) => x.id); n = ids.length; if (n) await updateTxs(ids, { category_id: cat.id, card_account_id: card ? card.id : null, categorized_by: 'regla', needs_review: false }); }
          close(); toast(`Regla creada${n ? ` · ${n} movimientos reclasificados` : ''}`); rerender();
        } catch (e) { fail(e); }
      };
    });
  }

  function newCategoryModal(onCreated) {
    let color = PALETTE[S.categories.length % PALETTE.length];
    modal(`<h2>Nueva categoría</h2>
      <div class="row"><label style="width:80px">Icono<input id="c-icon" value="🏷️" maxlength="4"></label><label style="flex:1">Nombre<input id="c-name" placeholder="p. ej. Mascotas"></label></div>
      <label>Tipo<select id="c-kind">${Object.entries(KIND_LABEL).filter(([k]) => k !== 'pago_tarjeta').map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      <label class="switch"><input type="checkbox" id="c-fixed"> Es un gasto fijo</label>
      <div><div class="small muted" style="margin-bottom:6px">Color</div><div class="colors">${PALETTE.map((p) => `<button style="background:${p}" data-c="${p}" class="${p === color ? 'on' : ''}"></button>`).join('')}</div></div>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="c-save">Crear</button></div>`, (m, close) => {
      $$('.colors button', m).forEach((b) => b.onclick = () => { color = b.dataset.c; $$('.colors button', m).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#c-name', m).focus();
      $('#c-save', m).onclick = async () => {
        const name = $('#c-name', m).value.trim(); if (!name) return;
        const { data, error } = await sb.from('categories').insert({ household_id: S.household.id, name, icon: $('#c-icon', m).value || '🏷️', color, kind: $('#c-kind', m).value, fixed: $('#c-fixed', m).checked, sort: 150 }).select().single();
        if (error) return fail(error.code === '23505' ? new Error('Ya existe una categoría con ese nombre') : error);
        S.categories.push(data); rebuildCtx(); close(); onCreated(data);
      };
    });
  }

  function linkModal(t, rerender) {
    const cands = C.reimbursementCandidates(t, S.txs, ctx);
    modal(`<h2>↩ ¿De qué gasto es este reembolso?</h2>
      <p class="muted small"><b>${esc(t.description)}</b> · ${eur(t.amount, 2)} · ${fmtDate(t.date)}<br>El reembolso restará del gasto elegido y dejará de contar como ingreso.</p>
      <div class="pick">${cands.map((c) => `<label><input type="radio" name="lk" value="${c.id}" ${t.linked_to === c.id ? 'checked' : ''}><span style="flex:1">${fmtDate(c.date)} · ${esc(c.description.slice(0, 60))}</span><b class="num">${eur(c.amount, 2)}</b></label>`).join('') || '<div class="muted">No hay gastos candidatos en ±90 días.</div>'}</div>
      <div class="actions">${t.linked_to ? '<button class="btn danger" id="lk-un">Quitar vínculo</button>' : ''}<span class="space"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="lk-ok">Vincular</button></div>`, (m, close) => {
      $('#lk-ok', m).onclick = async () => { const sel = $('input[name=lk]:checked', m); if (!sel) return; try { await updateTxs([t.id], { linked_to: sel.value, needs_review: false }); close(); toast('Reembolso vinculado'); rerender(); } catch (e) { fail(e); } };
      const un = $('#lk-un', m); if (un) un.onclick = async () => { try { await updateTxs([t.id], { linked_to: null }); close(); rerender(); } catch (e) { fail(e); } };
    });
  }

  function renderMovimientos(v) {
    const f = S.movFilter; if (f.month === null) f.month = S.month;
    const months = [...new Set(S.txs.map((t) => t.date.slice(0, 7)))].sort().reverse();
    v.innerHTML = `<div class="head"><h2>Movimientos</h2><span class="muted small" id="mv-count"></span></div>
      <div class="filters">
        <label>Mes<select id="f-month"><option value="">Todos</option>${months.map((m) => `<option value="${m}" ${m === f.month ? 'selected' : ''}>${esc(monthName(m))}</option>`).join('')}</select></label>
        <label>Cuenta<select id="f-acc"><option value="">Todas</option>${S.accounts.map((a) => `<option value="${a.id}" ${a.id === f.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label>Categoría<select id="f-cat"><option value="">Todas</option><option value="__pendiente" ${f.category === '__pendiente' ? 'selected' : ''}>❓ Sin clasificar</option>${categoryOptions(f.category, { includeEmpty: false, includeNew: false })}</select></label>
        <label style="flex:1;min-width:160px">Buscar<input id="f-q" value="${esc(f.q)}" placeholder="Mercadona, Bizum…"></label>
      </div>
      <div class="card" style="padding:6px 12px"><div class="tx-list" id="mv-list"></div></div>`;
    const draw = () => {
      const q = C.norm(f.q);
      const list = S.txs.filter((t) => (!f.month || t.date.startsWith(f.month)) && (!f.account || t.account_id === f.account)
        && (!f.category || (f.category === '__pendiente' ? !t.category_id && !t.linked_to : C.effCategory(t, ctx) === f.category))
        && (!q || C.norm(t.description).includes(q))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const sum = list.reduce((s, t) => s + t.amount, 0);
      $('#mv-count').textContent = `${list.length} movimientos · suma ${eur(sum, 2)}`;
      $('#mv-list').innerHTML = list.slice(0, 600).map(txRow).join('') || '<div class="empty">No hay movimientos con estos filtros</div>';
    };
    $('#f-month').onchange = (e) => { f.month = e.target.value; draw(); };
    $('#f-acc').onchange = (e) => { f.account = e.target.value; draw(); };
    $('#f-cat').onchange = (e) => { f.category = e.target.value; draw(); };
    $('#f-q').oninput = (e) => { f.q = e.target.value; draw(); };
    bindTxRows($('#mv-list'), draw); draw();
  }

  // =================================================================
  //  PENDIENTES
  // =================================================================
  function renderPendientes(v) {
    const draw = () => {
      const list = S.txs.filter((t) => t.needs_review).sort((a, b) => (a.date < b.date ? 1 : -1));
      const sug = list.filter((t) => t.category_id);
      v.innerHTML = `<div class="head"><h2>Pendientes de revisar</h2>
          ${sug.length ? `<button class="btn primary" id="p-all">✓ Confirmar las ${sug.length} sugeridas</button>` : ''}</div>
        <p class="muted small">Clasifica lo nuevo. Al elegir una categoría te propongo crear una regla para que la próxima vez se haga solo. Para Bizum o transferencias que te devuelven dinero, usa ↩ para vincularlos al gasto.</p>
        <div class="card" style="padding:6px 12px"><div class="tx-list" id="p-list">${list.map(txRow).join('') || '<div class="empty"><div style="font-size:40px">🎉</div>No hay nada pendiente</div>'}</div></div>`;
      bindTxRows($('#p-list'), draw);
      const all = $('#p-all'); if (all) all.onclick = async () => { try { await updateTxs(sug.map((t) => t.id), { needs_review: false, categorized_by: 'usuario' }); toast(`${sug.length} confirmadas`); draw(); } catch (e) { fail(e); } };
    };
    draw();
  }

  // =================================================================
  //  IMPORTAR
  // =================================================================
  function renderImportar(v) {
    v.innerHTML = `<div class="head"><h2>Importar extractos</h2></div>
      <div class="drop" id="drop"><div style="font-size:38px">⬆️</div><b>Arrastra aquí los archivos</b> o haz clic para elegirlos<br>
        <span class="muted small">ING (.xls) · Carrefour Pass (.xls) · Revolut (.csv) · otros Excel/CSV con el importador genérico. Puedes subir varios a la vez.</span>
        <input type="file" id="file" multiple accept=".xls,.xlsx,.csv" hidden></div>
      <div id="imp-out" style="margin-top:16px;display:flex;flex-direction:column;gap:16px"></div>
      <div class="card" style="margin-top:16px"><h3>Cómo descargar cada extracto</h3>
        <ul class="small" style="margin:0;padding-left:18px;line-height:1.8">
          <li><b>ING</b>: web → cuenta → Movimientos → elegir fechas → descargar Excel. Máximo 500 movimientos por descarga: si necesitas más, descarga varios tramos (los repetidos se ignoran).</li>
          <li><b>Carrefour Pass</b>: web de Pass → Movimientos → «Movimientos de contado y crédito» → ciclo (del 21 al 20) → Excel. Solo se puede descargar cuando el ciclo está cerrado, así que se importa <b>una vez al mes, a partir del día 21</b>. Mientras tanto, sus cargos en ING cuentan como gasto provisional.</li>
          <li><b>Revolut</b>: app → Cuenta → Extracto → Excel/CSV → periodo.</li>
          <li>Sube sin miedo periodos que se solapan: la app detecta y salta los movimientos que ya tiene.</li></ul></div>`;
    const drop = $('#drop'); const inp = $('#file');
    drop.onclick = () => inp.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); };
    inp.onchange = () => { handleFiles([...inp.files]); inp.value = ''; };
  }

  async function readRows(file) {
    const isCSV = /\.csv$/i.test(file.name);
    if (isCSV) return C.parseCSV(await file.text());
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }

  async function handleFiles(files) {
    for (const file of files) {
      const box = document.createElement('div'); box.className = 'card'; box.innerHTML = `<b>${esc(file.name)}</b> <span class="muted">· leyendo…</span>`;
      $('#imp-out').prepend(box);
      try {
        const rows = await readRows(file);
        const p = C.parseStatement(rows);
        if (!p.source) genericMapper(box, file, rows); else preview(box, file, p.source, p.rows, p.meta);
      } catch (e) { box.innerHTML = `<b>${esc(file.name)}</b><p class="error">No he podido leer el archivo: ${esc(e.message)}</p>`; console.error(e); }
    }
  }

  function preview(box, file, source, rows, meta, accountOverride) {
    const acc = accountOverride || S.accounts.find((a) => a.source === source);
    if (!acc) { box.innerHTML = `<p class="error">No hay ninguna cuenta configurada para ${esc(SOURCE_LABEL[source] || source)}.</p>`; return; }
    const keyed = C.addDedupeKeys(acc.source, rows);
    const have = new Set(S.txs.map((t) => t.dedupe_key));
    const nuevos = keyed.filter((r) => !have.has(r.dedupe_key));
    const sorted = C.sortRules(S.rules);
    const classified = nuevos.map((r) => ({ r, cl: C.classify(r, acc.source, sorted) }));
    const nRule = classified.filter((x) => x.cl.categorized_by === 'regla').length;
    const nSug = classified.filter((x) => x.cl.categorized_by === 'banco').length;
    const nNone = classified.filter((x) => !x.cl.category_id).length;
    const nTransfer = classified.filter((x) => { const c = catById(x.cl.category_id); return c && ['traspaso', 'financiacion', 'pago_tarjeta'].includes(c.kind); }).length;
    const dates = rows.map((r) => r.date).sort();
    box.innerHTML = `<div class="row"><b>${esc(file.name)}</b><span class="chip">${esc(acc.name)}</span><span class="space"></span>
        <span class="muted small">${dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : ''}${meta.from ? ` · ciclo ${fmtDate(meta.from)}–${fmtDate(meta.to)}` : ''}</span></div>
      <div class="stats"><div><b>${rows.length}</b><span class="muted small">en el archivo</span></div><div><b>${nuevos.length}</b><span class="muted small">nuevos</span></div>
        <div><b>${rows.length - nuevos.length}</b><span class="muted small">ya importados</span></div><div><b>${nRule}</b><span class="muted small">clasificados por reglas</span></div>
        <div><b>${nTransfer}</b><span class="muted small">traspasos / pagos tarjeta</span></div><div><b>${nSug + nNone}</b><span class="muted small">a Pendientes</span></div></div>
      ${source === 'ing' && rows.length >= 500 ? '<div class="warn">⚠️ El archivo tiene 500 movimientos, el máximo de ING por descarga. Si te faltan días más antiguos, descarga otro tramo anterior.</div>' : ''}
      <div class="row"><span class="space"></span>${nuevos.length ? `<button class="btn primary" data-go>Importar ${nuevos.length} movimientos</button>` : '<span class="muted">Nada nuevo que importar</span>'}</div>`;
    const go = $('[data-go]', box);
    if (go) go.onclick = async () => {
      go.disabled = true; go.textContent = 'Importando…';
      try {
        const { data: imp, error: e1 } = await sb.from('imports').insert({
          household_id: S.household.id, account_id: acc.id, file_name: file.name, date_from: dates[0], date_to: dates[dates.length - 1],
          rows_total: rows.length, rows_new: nuevos.length, rows_dup: rows.length - nuevos.length, imported_by: S.user.id,
        }).select().single();
        if (e1) throw e1;
        const payload = classified.map(({ r, cl }) => ({
          household_id: S.household.id, account_id: acc.id, import_id: imp.id, date: r.date, description: r.description,
          merchant: C.merchantOf(r.description), amount: r.amount, balance: r.balance, bank_category: r.bank_category, bank_subcategory: r.bank_subcategory,
          category_id: cl.category_id, card_account_id: cl.card_account_id, categorized_by: cl.categorized_by, needs_review: cl.needs_review, dedupe_key: r.dedupe_key,
        }));
        for (let i = 0; i < payload.length; i += 500) {
          const { error } = await sb.from('transactions').upsert(payload.slice(i, i + 500), { onConflict: 'household_id,dedupe_key', ignoreDuplicates: true });
          if (error) throw error;
        }
        await loadAll();
        box.innerHTML = `✅ <b>${esc(file.name)}</b>: ${nuevos.length} movimientos importados en ${esc(acc.name)}. ${nSug + nNone ? `<a href="#pendientes">Revisar ${nSug + nNone} pendientes</a>` : ''}`;
      } catch (e) { fail(e); go.disabled = false; go.textContent = 'Reintentar'; }
    };
  }

  // Importador genérico: el usuario indica las columnas
  function genericMapper(box, file, rows) {
    const saved = S.accounts.find((a) => a.column_map && a.column_map.signature && a.column_map.signature === signature(rows, a.column_map.headerRow));
    const map = saved ? { ...saved.column_map } : { headerRow: guessHeader(rows), date: 0, desc: 1, amount: 2, invert: false };
    if (saved) { return preview(box, file, saved.source, C.parseGeneric(rows, map), {}, saved); }
    const draw = () => {
      const hdr = rows[map.headerRow] || []; const opts = (sel) => hdr.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i + 1}: ${esc(String(h).slice(0, 30))}</option>`).join('');
      const sample = C.parseGeneric(rows, map).slice(0, 5);
      box.innerHTML = `<b>${esc(file.name)}</b> <span class="chip">formato nuevo</span>
        <p class="muted small">No reconozco este formato. Dime qué es cada columna y lo recordaré para la próxima vez.</p>
        <div class="filters">
          <label>Cuenta<select data-k="acc">${S.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
          <label>Fila de títulos<select data-k="headerRow">${rows.slice(0, 40).map((r, i) => `<option value="${i}" ${i === map.headerRow ? 'selected' : ''}>${i + 1}: ${esc(r.filter(Boolean).slice(0, 3).join(' | ').slice(0, 40))}</option>`).join('')}</select></label>
          <label>Fecha<select data-k="date">${opts(map.date)}</select></label>
          <label>Concepto<select data-k="desc">${opts(map.desc)}</select></label>
          <label>Importe<select data-k="amount">${opts(map.amount)}</select></label>
          <label class="switch"><input type="checkbox" data-k="invert" ${map.invert ? 'checked' : ''}> Los cargos vienen en positivo</label>
        </div>
        <table class="simple"><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>${sample.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.description)}</td><td class="num">${eur(r.amount, 2)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin filas válidas con esta configuración</td></tr>'}</tbody></table>
        <div class="row" style="margin-top:10px"><span class="space"></span><button class="btn primary" data-ok>Continuar</button></div>`;
      $$('[data-k]', box).forEach((el) => el.onchange = () => {
        const k = el.dataset.k; if (k === 'acc') return;
        map[k] = k === 'invert' ? el.checked : Number(el.value); draw();
      });
      $('[data-ok]', box).onclick = async () => {
        const acc = accById($('[data-k=acc]', box).value);
        const cm = { ...map, signature: signature(rows, map.headerRow) };
        const { error } = await sb.from('accounts').update({ column_map: cm }).eq('id', acc.id);
        if (error) return fail(error); acc.column_map = cm;
        preview(box, file, acc.source, C.parseGeneric(rows, map), {}, acc);
      };
    };
    draw();
  }
  const signature = (rows, h) => (rows[h] || []).map((x) => C.norm(x)).join('|');
  const guessHeader = (rows) => Math.max(0, rows.findIndex((r) => r.filter((x) => typeof x === 'string' && x.trim()).length >= 3));

  // =================================================================
  //  AJUSTES
  // =================================================================
  function renderAjustes(v) {
    const tabs = { cuentas: 'Cuentas y tarjetas', categorias: 'Categorías', reglas: 'Reglas', importaciones: 'Importaciones', hogar: 'Hogar' };
    v.innerHTML = `<div class="head"><h2>Ajustes</h2></div>
      <div class="tabs">${Object.entries(tabs).map(([k, l]) => `<button data-tab="${k}" class="${S.ajTab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="aj"></div>`;
    $$('[data-tab]', v).forEach((b) => b.onclick = () => { S.ajTab = b.dataset.tab; renderAjustes(v); });
    ({ cuentas: ajCuentas, categorias: ajCategorias, reglas: ajReglas, importaciones: ajImportaciones, hogar: ajHogar })[S.ajTab]($('#aj'));
  }

  function ajCuentas(el) {
    el.innerHTML = `<div class="card"><table class="simple"><thead><tr><th>Cuenta</th><th>Titular</th><th>Movimientos</th><th>Último</th><th>Modo</th></tr></thead><tbody>
      ${S.accounts.map((a) => { const own = S.txs.filter((t) => t.account_id === a.id); const last = own.map((t) => t.date).sort().pop();
        return `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.owner || '—')}</td><td>${own.length}</td><td>${last ? fmtDate(last) : '—'}</td>
          <td>${a.kind === 'tarjeta' ? `<label class="switch"><input type="checkbox" data-acc="${a.id}" ${a.detail_mode ? 'checked' : ''}> Con detalle</label>` : '<span class="muted">cuenta</span>'}</td></tr>`; }).join('')}
      </tbody></table>
      <p class="muted small" style="margin-top:12px"><b>Con detalle</b>: importas el extracto de la tarjeta y sus compras cuentan una a una; el cargo de la tarjeta en ING no cuenta (si no, se contaría dos veces).<br>
      <b>Sin detalle</b>: no importas el extracto y el cargo en ING cuenta como un único gasto.</p></div>`;
    $$('[data-acc]', el).forEach((cb) => cb.onchange = async () => {
      const { error } = await sb.from('accounts').update({ detail_mode: cb.checked }).eq('id', cb.dataset.acc);
      if (error) return fail(error); accById(cb.dataset.acc).detail_mode = cb.checked; rebuildCtx(); toast('Guardado');
    });
  }

  function ajCategorias(el) {
    const used = new Map(); for (const t of S.txs) if (t.category_id) used.set(t.category_id, (used.get(t.category_id) || 0) + 1);
    el.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><span class="space"></span><button class="btn primary" id="cat-new">＋ Nueva categoría</button></div>
      <table class="simple"><thead><tr><th></th><th>Nombre</th><th>Tipo</th><th>Fijo</th><th>Color</th><th>Movs.</th><th></th></tr></thead><tbody>
      ${[...S.categories].sort((a, b) => a.sort - b.sort).map((c) => `<tr data-id="${c.id}">
        <td><input data-f="icon" value="${esc(c.icon)}" style="width:52px"></td><td><input data-f="name" value="${esc(c.name)}"></td>
        <td class="small">${esc(KIND_LABEL[c.kind])}</td><td><input type="checkbox" data-f="fixed" ${c.fixed ? 'checked' : ''}></td>
        <td><input type="color" data-f="color" value="${esc(c.color)}" style="width:44px;padding:2px"></td><td>${used.get(c.id) || 0}</td>
        <td><button class="btn small danger" data-del>Borrar</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#cat-new').onclick = () => newCategoryModal(() => ajCategorias(el));
    el.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-f]'); if (!inp) return; const id = inp.closest('tr').dataset.id; const f = inp.dataset.f;
      const val = f === 'fixed' ? inp.checked : inp.value;
      const { error } = await sb.from('categories').update({ [f]: val }).eq('id', id);
      if (error) return fail(error); catById(id)[f] = val; rebuildCtx(); toast('Guardado');
    });
    $$('[data-del]', el).forEach((b) => b.onclick = async () => {
      const id = b.closest('tr').dataset.id; const n = used.get(id) || 0;
      if (!confirm(n ? `Esta categoría tiene ${n} movimientos, que volverán a Pendientes. Las reglas que la usan se borrarán. ¿Borrar?` : '¿Borrar la categoría?')) return;
      const { error } = await sb.from('categories').delete().eq('id', id); if (error) return fail(error);
      await loadAll(); if (n) await updateTxs(S.txs.filter((t) => !t.category_id && !t.linked_to && !t.needs_review).map((t) => t.id), { needs_review: true });
      ajCategorias(el);
    });
  }

  function ajReglas(el) {
    const draw = (q = '') => {
      const nq = C.norm(q);
      const list = C.sortRules(S.rules).filter((r) => !nq || C.norm(r.pattern).includes(nq) || C.norm(catById(r.category_id)?.name).includes(nq));
      el.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><input id="rq" placeholder="Buscar regla o categoría" value="${esc(q)}" style="flex:1">
        <button class="btn" id="r-reapply" data-tip="Vuelve a aplicar todas las reglas a los movimientos no clasificados a mano">↻ Reaplicar reglas</button></div>
        <p class="muted small">Se evalúan de arriba abajo: gana la primera que coincide. Las tuyas (100) van antes que las predefinidas (50-60) y que las pistas de ING (10).</p>
        <table class="simple"><thead><tr><th>Si…</th><th>Cuenta</th><th>→ Categoría</th><th>Prioridad</th><th>Origen</th><th></th></tr></thead><tbody>
        ${list.map((r) => { const c = catById(r.category_id); return `<tr data-id="${r.id}"><td>${r.match_field === 'bank_subcategory' ? 'tipo/categoría del banco =' : 'contiene'} <b>${esc(r.pattern)}</b>${r.amount_sign ? ` <span class="chip">${r.amount_sign > 0 ? 'abonos' : 'cargos'}</span>` : ''}</td>
          <td class="small">${esc(SOURCE_LABEL[r.account_source] || 'todas')}</td><td>${c ? `${esc(c.icon)} ${esc(c.name)}` : '?'}</td>
          <td><input type="number" value="${r.priority}" data-prio style="width:70px"></td><td class="small">${esc(r.origin)}</td><td><button class="btn small danger" data-del>Borrar</button></td></tr>`; }).join('')}
        </tbody></table></div>`;
      $('#rq').oninput = (e) => { const pos = e.target.selectionStart; draw(e.target.value); const n = $('#rq'); n.focus(); n.setSelectionRange(pos, pos); };
      $$('[data-del]', el).forEach((b) => b.onclick = async () => {
        const id = b.closest('tr').dataset.id; const { error } = await sb.from('rules').delete().eq('id', id); if (error) return fail(error);
        S.rules = S.rules.filter((r) => r.id !== id); draw(q);
      });
      $$('[data-prio]', el).forEach((i) => i.onchange = async () => {
        const id = i.closest('tr').dataset.id; const { error } = await sb.from('rules').update({ priority: Number(i.value) }).eq('id', id); if (error) return fail(error);
        S.rules.find((r) => r.id === id).priority = Number(i.value); toast('Guardado');
      });
      $('#r-reapply').onclick = () => reapplyRules().then(() => draw(q));
    };
    draw();
  }
  async function reapplyRules() {
    const sorted = C.sortRules(S.rules); const groups = new Map();
    for (const t of S.txs) {
      if (t.categorized_by === 'usuario' || t.linked_to) continue;
      const cl = C.classify(t, accById(t.account_id)?.source, sorted);
      if (cl.category_id === t.category_id && cl.card_account_id === t.card_account_id) continue;
      const patch = { category_id: cl.category_id, card_account_id: cl.card_account_id, categorized_by: cl.categorized_by, needs_review: cl.needs_review };
      const k = JSON.stringify(patch); if (!groups.has(k)) groups.set(k, { patch, ids: [] }); groups.get(k).ids.push(t.id);
    }
    let n = 0; try { for (const { patch, ids } of groups.values()) { await updateTxs(ids, patch); n += ids.length; } toast(`${n} movimientos actualizados`); } catch (e) { fail(e); }
  }

  function ajImportaciones(el) {
    el.innerHTML = `<div class="card"><table class="simple"><thead><tr><th>Fecha</th><th>Archivo</th><th>Cuenta</th><th>Periodo</th><th>Nuevos</th><th>Por</th><th></th></tr></thead><tbody>
      ${S.imports.map((i) => `<tr data-id="${i.id}"><td>${new Date(i.imported_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="small">${esc(i.file_name)}</td>
        <td>${esc(accById(i.account_id)?.name || '')}</td><td class="small">${i.date_from ? fmtDate(i.date_from) + ' → ' + fmtDate(i.date_to) : ''}</td><td>${i.rows_new}</td>
        <td class="small">${esc(S.members.find((m) => m.user_id === i.imported_by)?.display_name || '')}</td><td><button class="btn small danger" data-undo>Deshacer</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aún no hay importaciones</td></tr>'}
      </tbody></table><p class="muted small">«Deshacer» borra los movimientos que entraron con esa importación (útil si subiste el archivo equivocado).</p></div>`;
    $$('[data-undo]', el).forEach((b) => b.onclick = async () => {
      const id = b.closest('tr').dataset.id; if (!confirm('¿Borrar todos los movimientos de esta importación?')) return;
      const r1 = await sb.from('transactions').delete().eq('import_id', id); if (r1.error) return fail(r1.error);
      const r2 = await sb.from('imports').delete().eq('id', id); if (r2.error) return fail(r2.error);
      await loadAll(); ajImportaciones(el); toast('Importación deshecha');
    });
  }

  function ajHogar(el) {
    el.innerHTML = `<div class="card"><h3>${esc(S.household.name || 'Hogar')}</h3>
      <ul>${S.members.map((m) => `<li>${esc(m.display_name)}${m.user_id === S.user.id ? ' (tú)' : ''}</li>`).join('')}</ul>
      <p class="muted small">Recordatorio semanal: cada domingo a las 18:57 te llega un aviso al móvil para actualizar los extractos.</p></div>`;
  }

  start().catch((e) => { $('#loading').textContent = 'Error: ' + e.message; console.error(e); });
})();
