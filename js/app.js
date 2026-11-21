import { isConfigured } from './config.js';
import { sb } from './supabase.js';
import { getSession, checkBendahara, logout } from './auth.js';
import { fetchEvents, renderEventList, openEventForm, setEventStatus, rangeText } from './events.js';
import {
  fetchTransactions, filterByPeriod, filterList, renderList, openDetail,
  openIncomeForm, openExpenseForm, fetchAudit, renderAudit,
} from './transactions.js';
import { renderChart } from './charts.js';
import { exportPDF, exportExcel } from './reports.js';
import {
  $, esc, rp, rpSaldo, MINUS, summarize, periodRange, periodLabel,
  toast, closeModal, errMsg,
} from './utils.js';

const LS_KEY = 'kas.eventId';
const lsGet = () => { try { return localStorage.getItem(LS_KEY); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS_KEY, v); } catch { /* abaikan */ } };

const state = {
  events: [], eventId: null, rows: [], bendahara: false,
  period: 'all', from: '', to: '', jenis: '', kategori: '', q: '',
  view: { periodRows: [], listRows: [] },
};

const activeEvent = () => state.events.find((e) => e.id === state.eventId) || null;
const canEdit = () => !!(state.bendahara && activeEvent() && activeEvent().status === 'aktif');

const ctx = {
  get canEdit() { return canEdit(); },
  reload: async () => {
    await loadRows();
    if (state.bendahara) loadAudit();
  },
};

/* ---------- init ---------- */
async function init() {
  if (!isConfigured() || !sb) {
    $('#config-warn').hidden = false;
    renderAuth(false, false);
    return;
  }
  $('#app').hidden = false;
  const session = await getSession();
  state.bendahara = await checkBendahara(session);
  renderAuth(!!session, state.bendahara);
  bindUI();
  try {
    await loadEvents();
    if (state.bendahara) loadAudit();
  } catch (err) {
    toast('Gagal memuat data: ' + errMsg(err));
  }
}

function renderAuth(loggedIn, isBendahara) {
  const box = $('#auth-box');
  if (!loggedIn) {
    box.innerHTML = '<a class="btn" href="login.html">Masuk bendahara</a>';
    return;
  }
  box.innerHTML = `<span class="r-sub">${isBendahara ? 'Bendahara' : 'Bukan akun bendahara'}</span>
    <button class="btn" id="btn-logout" type="button">Keluar</button>`;
}

/* ---------- load data ---------- */
async function loadEvents(selectId) {
  state.events = await fetchEvents();
  const want = selectId || state.eventId || lsGet();
  const found = state.events.find((e) => e.id === want);
  const fallback = state.events.find((e) => e.status === 'aktif') || state.events[0];
  state.eventId = found ? found.id : fallback ? fallback.id : null;
  if (state.eventId) lsSet(state.eventId);
  renderEvents();
  await loadRows();
}

async function loadRows() {
  if (!state.eventId) {
    state.rows = [];
    render();
    return;
  }
  try {
    state.rows = await fetchTransactions(state.eventId);
  } catch (err) {
    state.rows = [];
    toast('Gagal memuat transaksi: ' + errMsg(err));
  }
  render();
}

async function loadAudit() {
  $('#sec-audit').hidden = false;
  try {
    renderAudit($('#audit-list'), await fetchAudit());
  } catch (err) {
    $('#audit-list').innerHTML = `<p class="empty">Gagal memuat: ${esc(errMsg(err))}</p>`;
  }
}

/* ---------- render ---------- */
function renderEvents() {
  const e = activeEvent();
  renderEventList($('#event-list'), state.events, state.eventId);
  $('#btn-new-event').hidden = !state.bendahara;
  $('#ev-sections').hidden = !e;
  if (!e) return;

  $('#active').innerHTML = `<div class="label">Kegiatan dipilih</div>
    <h2>${esc(e.nama)}</h2>
    ${rangeText(e) ? `<p class="r-sub">${esc(rangeText(e))}</p>` : ''}
    ${e.deskripsi ? `<p>${esc(e.deskripsi)}</p>` : ''}
    ${e.status === 'arsip' ? '<p class="r-sub">Kegiatan ini diarsipkan. Data masih bisa dilihat dan diunduh, tapi tidak bisa diubah.</p>' : ''}`;
  $('#ev-actions').hidden = !state.bendahara;
  $('#btn-archive').textContent = e.status === 'aktif' ? 'Arsipkan kegiatan' : 'Aktifkan lagi';
  $('#btn-in').hidden = !canEdit();
  $('#btn-out').hidden = !canEdit();
}

function fillKategori(periodRows) {
  const sel = $('#f-kat');
  const kats = [...new Set(periodRows.map((r) => r.kategori).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Semua kategori</option>' + kats.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  if (!kats.includes(state.kategori)) state.kategori = '';
  sel.value = state.kategori;
}

function render() {
  if (!activeEvent()) return;
  const range = periodRange(state.period, state.from, state.to);
  const periodRows = filterByPeriod(state.rows, range);
  fillKategori(periodRows);
  const listRows = filterList(periodRows, state);
  state.view = { periodRows, listRows };

  const s = summarize(periodRows);
  $('#saldo').textContent = rpSaldo(s.saldo);
  $('#st-in').textContent = '+ ' + rp(s.masuk);
  $('#st-out').textContent = MINUS + ' ' + rp(s.keluar);
  $('#st-n').textContent = String(s.count);

  renderChart(periodRows);
  renderList($('#tx-list'), listRows);
  $('#btn-in').hidden = !canEdit();
  $('#btn-out').hidden = !canEdit();
}

function filterText() {
  const p = [];
  if (state.jenis) p.push(state.jenis === 'masuk' ? 'hanya uang masuk' : 'hanya uang keluar');
  if (state.kategori) p.push(`kategori ${state.kategori}`);
  if (state.q.trim()) p.push(`cari "${state.q.trim()}"`);
  return p.join('; ');
}

/* ---------- events UI ---------- */
function bindUI() {
  $('#auth-box').addEventListener('click', async (e) => {
    if (e.target.closest('#btn-logout')) {
      await logout();
      location.reload();
    }
  });

  $('#event-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    state.eventId = b.dataset.id;
    lsSet(state.eventId);
    state.jenis = ''; state.kategori = ''; state.q = '';
    $('#f-jenis').value = ''; $('#f-q').value = '';
    renderEvents();
    await loadRows();
  });

  $('#btn-new-event').addEventListener('click', () => openEventForm(null, (id) => loadEvents(id)));
  $('#btn-edit-event').addEventListener('click', () => openEventForm(activeEvent(), (id) => loadEvents(id)));
  $('#btn-archive').addEventListener('click', async () => {
    const e = activeEvent();
    if (!e) return;
    const to = e.status === 'aktif' ? 'arsip' : 'aktif';
    if (to === 'arsip' && !confirm('Arsipkan kegiatan ini? Datanya tetap tersimpan, hanya tidak bisa diubah.')) return;
    try {
      await setEventStatus(e.id, to);
      toast(to === 'arsip' ? 'Kegiatan diarsipkan.' : 'Kegiatan diaktifkan lagi.');
      await loadEvents();
    } catch (err) {
      toast(errMsg(err));
    }
  });

  $('#f-period').addEventListener('change', (e) => {
    state.period = e.target.value;
    $('#w-from').hidden = $('#w-to').hidden = state.period !== 'custom';
    render();
  });
  $('#f-from').addEventListener('change', (e) => { state.from = e.target.value; render(); });
  $('#f-to').addEventListener('change', (e) => { state.to = e.target.value; render(); });
  $('#f-jenis').addEventListener('change', (e) => { state.jenis = e.target.value; render(); });
  $('#f-kat').addEventListener('change', (e) => { state.kategori = e.target.value; render(); });
  let t;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; render(); }, 200);
  });

  const openRow = (el) => {
    const row = el.closest('.row[data-id]');
    if (!row) return;
    const tx = state.rows.find((r) => r.id === row.dataset.id);
    if (tx) openDetail(tx, ctx);
  };
  $('#tx-list').addEventListener('click', (e) => openRow(e.target));
  $('#tx-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(e.target); }
  });

  $('#btn-in').addEventListener('click', () => openIncomeForm(state.eventId, null, ctx));
  $('#btn-out').addEventListener('click', () => openExpenseForm(state.eventId, null, ctx));

  const exportArgs = () => ({
    event: activeEvent(),
    rows: state.view.listRows,
    periodText: periodLabel(state.period, state.from, state.to),
    filterText: filterText(),
  });
  $('#btn-pdf').addEventListener('click', () => {
    if (!activeEvent()) return;
    try { exportPDF(exportArgs()); } catch (err) { toast('Gagal membuat PDF: ' + errMsg(err)); }
  });
  $('#btn-xlsx').addEventListener('click', () => {
    if (!activeEvent()) return;
    try { exportExcel(exportArgs()); } catch (err) { toast('Gagal membuat Excel: ' + errMsg(err)); }
  });

  $('#modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

init();
