/* =====================================================================
   Gastos Casa · core.js
   Lógica pura (sin interfaz): lectura de extractos, reglas y cálculos.
   Funciona en el navegador (window.Core) y en Node (pruebas).
   ===================================================================== */
(function (root) {
  'use strict';

  // ---------- Utilidades ----------
  const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/¥/g, 'N')
    .toUpperCase().replace(/\s+/g, ' ').trim();

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  // Número de serie de Excel (base 1899-12-30) -> 'AAAA-MM-DD'
  function excelSerialToISO(n) {
    const ms = Math.round(Number(n)) * 86400000 + Date.UTC(1899, 11, 30);
    const d = new Date(ms);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // Acepta número de serie, Date, 'dd/mm/aaaa', 'aaaa-mm-dd[ hh:mm:ss]'
  function toISODate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return excelSerialToISO(v);
    if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return ymd(y, +m[2], +m[1]); }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  // '1.234,56' | '1234.56' | -12.5 -> número
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return NaN;
    let s = String(v).replace(/[€\s]/g, '');
    if (s === '') return NaN;
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) s = s.replace(',', '.');
    return Number(s);
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  // CSV sencillo con comillas
  function parseCSV(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    text = String(text).replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((x) => x !== '')) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
    return rows;
  }

  // ---------- Comercio normalizado ----------
  const PREFIXES = [
    'PAGO EN ', 'RECIBO ', 'DEVOLUCION TARJETA ', 'DEVOLUCION DE RECIBO ', 'BIZUM ENVIADO A ',
    'BIZUM RECIBIDO DE ', 'TRANSFERENCIA RECIBIDA DE ', 'TRANSFERENCIA EMITIDA A ', 'TRASPASO EMITIDO A ',
    'TRASPASO RECIBIDO DE ', 'TRASPASO INTERNO RECIBIDO ', 'PAGO BIZUM EN ', 'TO ', 'COMPRA TARJ ',
  ];
  function merchantOf(description) {
    let s = norm(description);
    for (const p of PREFIXES) if (s.startsWith(p)) { s = s.slice(p.length); break; }
    s = s.replace(/ (DEVOLUCION DE COMPRA|COMPRA)$/, '');
    s = s.replace(/\*+/g, ' ');
    // fuera: números, códigos largos con dígitos (referencias) y códigos de país finales
    const words = s.split(' ').filter((w) => w && !/^\d+$/.test(w) && !(/\d/.test(w) && w.length >= 5) && !/^(ES|LU|IE|FI|SE|FR|NL|GB|PT)$/.test(w));
    return words.join(' ').trim() || norm(description);
  }
  // Patrón propuesto para una regla nueva: las dos primeras palabras del comercio
  const STOP = new Set(['EL', 'LA', 'LOS', 'LAS', 'DE', 'DEL', 'Y', 'N', 'S', 'L', 'SL', 'SA', 'CB']);
  function suggestPattern(description) {
    const m = merchantOf(description).split(' ');
    const out = []; let sig = 0;
    for (const w of m) { out.push(w); if (!STOP.has(w)) sig++; if (sig >= 2) break; }
    while (out.length > 1 && STOP.has(out[out.length - 1])) out.pop();
    return out.join(' ');
  }

  // ---------- Detección y lectura de extractos ----------
  const findRow = (rows, pred) => rows.findIndex((r) => Array.isArray(r) && pred(r.map(norm)));

  function parseING(rows) {
    const h = findRow(rows, (r) => r.includes('F. VALOR') && r.includes('DESCRIPCION'));
    const hdr = rows[h].map(norm);
    const ix = {
      date: hdr.indexOf('F. VALOR'), cat: hdr.indexOf('CATEGORIA'), sub: hdr.indexOf('SUBCATEGORIA'),
      desc: hdr.indexOf('DESCRIPCION'), com: hdr.indexOf('COMENTARIO'),
      amt: hdr.findIndex((x) => x.startsWith('IMPORTE')), bal: hdr.findIndex((x) => x.startsWith('SALDO')),
    };
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const date = toISODate(r[ix.date]); const amount = toNumber(r[ix.amt]);
      if (!date || !isFinite(amount)) continue;
      const comment = ix.com >= 0 ? String(r[ix.com] || '').trim() : '';
      out.push({
        date, amount: round2(amount),
        description: String(r[ix.desc] || '').trim() + (comment ? ` · ${comment}` : ''),
        balance: ix.bal >= 0 && isFinite(toNumber(r[ix.bal])) ? round2(toNumber(r[ix.bal])) : null,
        bank_category: String(r[ix.cat] || '') || null, bank_subcategory: String(r[ix.sub] || '') || null,
      });
    }
    return out;
  }

  function parseCarrefour(rows) {
    const h = findRow(rows, (r) => r[0] === 'FECHA' && r.includes('CONCEPTO') && r.some((x) => x.startsWith('CARGO/ABONO')));
    const hdr = rows[h].map(norm);
    const ix = { date: 0, desc: hdr.indexOf('CONCEPTO'), mode: hdr.indexOf('MODO DE PAGO'), amt: hdr.findIndex((x) => x.startsWith('CARGO/ABONO')) };
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const date = toISODate(r[ix.date]); const amount = toNumber(r[ix.amt]);
      if (!date || !isFinite(amount)) continue;
      out.push({
        date, amount: round2(amount),
        description: String(r[ix.desc] || '').replace(/\s+/g, ' ').trim(),
        balance: null, bank_category: null, bank_subcategory: String(r[ix.mode] || '') || null,
      });
    }
    const meta = {};
    for (const r of rows.slice(0, h)) {
      const k = norm(r[0]);
      if (k.startsWith('FECHA DESDE')) meta.from = toISODate(r[1]);
      if (k.startsWith('FECHA HASTA')) meta.to = toISODate(r[1]);
    }
    return { rows: out, meta };
  }

  function parseRevolut(rows) {
    const hdr = rows[0].map(norm);
    const g = (name) => hdr.indexOf(name);
    const ix = {
      type: g('TIPO'), start: g('FECHA DE INICIO'), desc: g('DESCRIPCION'), amt: g('IMPORTE'),
      fee: g('COMISION'), state: g('STATE') >= 0 ? g('STATE') : g('ESTADO'), bal: g('SALDO'), cur: g('DIVISA'),
    };
    const out = [];
    for (const r of rows.slice(1)) {
      if (ix.state >= 0 && !['COMPLETADO', 'COMPLETED'].includes(norm(r[ix.state]))) continue;
      const date = toISODate(r[ix.start]);
      const amount = toNumber(r[ix.amt]) - (ix.fee >= 0 ? (toNumber(r[ix.fee]) || 0) : 0);
      if (!date || !isFinite(amount)) continue;
      out.push({
        date, amount: round2(amount),
        description: String(r[ix.desc] || '').trim(),
        balance: ix.bal >= 0 && isFinite(toNumber(r[ix.bal])) ? round2(toNumber(r[ix.bal])) : null,
        bank_category: null, bank_subcategory: String(r[ix.type] || '') || null,
        time: String(r[ix.start] || '').slice(11, 19),
      });
    }
    return out;
  }

  // Importador genérico: map = {headerRow, date, desc, amount}
  function parseGeneric(rows, map) {
    const out = [];
    for (const r of rows.slice((map.headerRow ?? 0) + 1)) {
      const date = toISODate(r[map.date]); const amount = toNumber(r[map.amount]);
      if (!date || !isFinite(amount)) continue;
      out.push({ date, amount: round2(map.invert ? -amount : amount), description: String(r[map.desc] || '').replace(/\s+/g, ' ').trim(), balance: null, bank_category: null, bank_subcategory: null });
    }
    return out;
  }

  // Devuelve {source, rows, meta} o {source:null} si no reconoce el formato
  function parseStatement(rows) {
    rows = (rows || []).filter((r) => Array.isArray(r));
    if (findRow(rows, (r) => r.includes('F. VALOR') && r.includes('DESCRIPCION')) >= 0) return { source: 'ing', rows: parseING(rows), meta: {} };
    if (findRow(rows, (r) => r[0] === 'FECHA' && r.includes('CONCEPTO') && r.includes('MODO DE PAGO')) >= 0) {
      const p = parseCarrefour(rows); return { source: 'carrefour', rows: p.rows, meta: p.meta };
    }
    if (rows[0] && rows[0].map(norm).includes('FECHA DE INICIO') && rows[0].map(norm).includes('PRODUCTO')) return { source: 'revolut', rows: parseRevolut(rows), meta: {} };
    return { source: null, rows: [], meta: {} };
  }

  // ---------- Duplicados ----------
  // Clave estable: cuenta|fecha|hora|importe|descripción|saldo|nº de aparición dentro del archivo
  function addDedupeKeys(source, rows) {
    const seen = new Map();
    return rows.map((r) => {
      const base = [source, r.date, r.time || '', r.amount.toFixed(2), norm(r.description), r.balance ?? ''].join('|');
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      return { ...r, dedupe_key: `${base}|${n}` };
    });
  }

  // ---------- Reglas ----------
  function sortRules(rules) {
    return [...rules].sort((a, b) => (b.priority - a.priority) || (String(b.pattern).length - String(a.pattern).length));
  }
  function ruleMatches(rule, tx, source) {
    if (rule.amount_sign && Math.sign(tx.amount) !== rule.amount_sign) return false;
    if (rule.account_source && rule.account_source !== source) return false;
    const p = norm(rule.pattern);
    if (!p) return false;
    if (rule.match_field === 'bank_subcategory') return norm(tx.bank_subcategory) === p;
    return norm(tx.description).includes(p);
  }
  // Devuelve {rule|null, category_id, card_account_id, categorized_by, needs_review}
  function classify(tx, source, sortedRules) {
    for (const r of sortedRules) {
      if (ruleMatches(r, tx, source)) {
        return {
          rule: r, category_id: r.category_id, card_account_id: r.card_account_id || null,
          // las pistas de ING se proponen, pero quedan en Pendientes para confirmarlas
          categorized_by: r.origin === 'banco' ? 'banco' : 'regla', needs_review: r.origin === 'banco',
        };
      }
    }
    return { rule: null, category_id: null, card_account_id: null, categorized_by: null, needs_review: true };
  }

  // ---------- Efecto contable ----------
  // gasto | ingreso | ahorro | excluido | pendiente
  function effectOf(tx, ctx) {
    if (tx.linked_to) return 'gasto';
    const c = ctx.catById.get(tx.category_id);
    if (!c) return 'pendiente';
    if (c.kind === 'pago_tarjeta') {
      const card = ctx.accById.get(tx.card_account_id);
      if (!card || !card.detail_mode) return 'gasto';
      // Con detalle: el cargo solo se excluye si el extracto de la tarjeta ya cubre esa fecha.
      // Si aún no se ha importado (p. ej. el ciclo de Carrefour no se ha cerrado), cuenta como gasto provisional.
      return isProvisional(tx, ctx) ? 'gasto' : 'excluido';
    }
    if (c.kind === 'traspaso' || c.kind === 'financiacion') return 'excluido';
    return c.kind;
  }
  function makeCtx(categories, accounts, txs) {
    const cardLast = new Map(); // tarjeta -> fecha del último movimiento importado de su extracto
    for (const t of txs || []) if (!cardLast.has(t.account_id) || t.date > cardLast.get(t.account_id)) cardLast.set(t.account_id, t.date);
    return {
      catById: new Map(categories.map((c) => [c.id, c])),
      accById: new Map(accounts.map((a) => [a.id, a])),
      txById: new Map((txs || []).map((t) => [t.id, t])),
      cardLast,
    };
  }
  // ¿Es un cargo de tarjeta "con detalle" cuyo extracto aún no se ha importado?
  function isProvisional(tx, ctx) {
    const c = ctx.catById.get(tx.category_id);
    if (!c || c.kind !== 'pago_tarjeta') return false;
    const card = ctx.accById.get(tx.card_account_id);
    if (!card || !card.detail_mode) return false;
    const last = ctx.cardLast.get(card.id);
    return !last || tx.date > last;
  }
  // Categoría efectiva (los reembolsos toman la del gasto original)
  function effCategory(tx, ctx) {
    if (tx.linked_to) { const p = ctx.txById.get(tx.linked_to); return p ? p.category_id : tx.category_id; }
    return tx.category_id;
  }

  const monthOf = (d) => String(d).slice(0, 7);
  function addMonths(ym, k) {
    let [y, m] = ym.split('-').map(Number); m += k;
    while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
    return `${y}-${pad(m)}`;
  }

  // Resumen de un mes (cifras reales, sin prorrateo)
  function monthSummary(txs, ym, ctx) {
    const s = { ingresos: 0, gastos: 0, ahorro: 0, pendientes: 0, pendientesImporte: 0, byCat: new Map(), byMerchant: new Map(), excepcional: 0 };
    for (const t of txs) {
      if (monthOf(t.date) !== ym) continue;
      const e = effectOf(t, ctx);
      if (t.needs_review) s.pendientes++;
      if (e === 'ingreso') s.ingresos += t.amount;
      else if (e === 'ahorro') s.ahorro += -t.amount;
      else if (e === 'gasto' || (e === 'pendiente' && t.amount < 0)) {
        const k = e === 'pendiente' ? '__pendiente' : effCategory(t, ctx);
        s.gastos += -t.amount;
        s.byCat.set(k, (s.byCat.get(k) || 0) - t.amount);
        if (t.exceptional) s.excepcional += -t.amount;
        if (e === 'pendiente') s.pendientesImporte += -t.amount;
        if (t.amount < 0) {
          const m = t.merchant || merchantOf(t.description);
          s.byMerchant.set(m, (s.byMerchant.get(m) || 0) - t.amount);
        }
      }
    }
    for (const k of ['ingresos', 'gastos', 'ahorro', 'excepcional', 'pendientesImporte']) s[k] = round2(s[k]);
    s.balance = round2(s.ingresos - s.gastos);
    s.tasaAhorro = s.ingresos > 0 ? (s.ingresos - s.gastos) / s.ingresos : null;
    return s;
  }

  // Gasto por categoría y mes "normalizado": sin excepcionales y con anuales prorrateados en 12 meses
  function normalizedByMonth(txs, ctx) {
    const res = new Map(); // ym -> Map(cat -> importe)
    const add = (ym, cat, v) => { if (!res.has(ym)) res.set(ym, new Map()); const m = res.get(ym); m.set(cat, (m.get(cat) || 0) + v); };
    for (const t of txs) {
      const e = effectOf(t, ctx);
      if (!(e === 'gasto' || (e === 'pendiente' && t.amount < 0)) || t.exceptional) continue;
      const cat = e === 'pendiente' ? '__pendiente' : effCategory(t, ctx);
      const ym = monthOf(t.date);
      if (t.annual) for (let i = 0; i < 12; i++) add(addMonths(ym, i), cat, -t.amount / 12);
      else add(ym, cat, -t.amount);
    }
    return res;
  }

  // Primer mes completo: el primer mes entero cubierto por la cuenta principal (la que más movimientos tiene)
  function firstFullMonth(txs) {
    if (!txs.length) return null;
    const count = new Map(); for (const t of txs) count.set(t.account_id, (count.get(t.account_id) || 0) + 1);
    const main = [...count].sort((a, b) => b[1] - a[1])[0][0];
    const first = txs.filter((t) => t.account_id === main).map((t) => t.date).sort()[0];
    return first.endsWith('-01') ? monthOf(first) : addMonths(monthOf(first), 1);
  }

  // Media de los N meses completos anteriores (normalizada) por categoría
  function averages(txs, ym, ctx, n = 6) {
    const nb = normalizedByMonth(txs, ctx); const ff = firstFullMonth(txs);
    const months = [...new Set(txs.map((t) => monthOf(t.date)))].filter((m) => m < ym && ff && m >= ff).sort().slice(-n);
    const avg = new Map(); let total = 0;
    for (const m of months) for (const [c, v] of (nb.get(m) || new Map())) { avg.set(c, (avg.get(c) || 0) + v / months.length); total += v / months.length; }
    return { months, byCat: avg, total: round2(total) };
  }

  // Tarjetas "con detalle": ¿hay pagos en ING posteriores al último movimiento importado?
  function cardWarnings(txs, ctx) {
    const out = [];
    for (const card of ctx.accById.values()) {
      if (card.kind !== 'tarjeta' || !card.detail_mode) continue;
      const own = txs.filter((t) => t.account_id === card.id).map((t) => t.date).sort();
      const last = own[own.length - 1] || null;
      const pays = txs.filter((t) => t.card_account_id === card.id && (!last || t.date > last)).sort((a, b) => a.date < b.date ? -1 : 1);
      if (pays.length) out.push({ card, last, since: pays[0].date, count: pays.length, amount: round2(pays.reduce((s, t) => s - t.amount, 0)) });
    }
    return out;
  }

  // Candidatos para vincular un reembolso (gastos de ±90 días con importe ≥ reembolso)
  function reimbursementCandidates(tx, txs, ctx) {
    const d0 = new Date(tx.date).getTime();
    return txs.filter((t) => t.amount < 0 && t.id !== tx.id && !t.linked_to
      && Math.abs(new Date(t.date).getTime() - d0) <= 90 * 86400000
      && -t.amount >= tx.amount * 0.5 && effectOf(t, ctx) !== 'excluido')
      .sort((a, b) => (-b.amount) - (-a.amount)).slice(0, 30);
  }

  const api = {
    norm, toISODate, toNumber, parseCSV, merchantOf, suggestPattern,
    parseStatement, parseGeneric, addDedupeKeys, sortRules, ruleMatches, classify,
    effectOf, effCategory, makeCtx, isProvisional, monthOf, addMonths, monthSummary, normalizedByMonth, averages, firstFullMonth,
    cardWarnings, reimbursementCandidates, round2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
