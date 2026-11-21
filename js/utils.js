export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const MINUS = '\u2212';
export const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
export const rp = (n) => 'Rp ' + nf.format(Math.abs(Number(n) || 0));
export const rpSigned = (n, jenis) => (jenis === 'masuk' ? '+ ' : MINUS + ' ') + rp(n);
export const rpSaldo = (n) => (Number(n) < 0 ? MINUS + ' ' : '') + rp(n);
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export function parseISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayISO = () => toISO(new Date());
export function fmtTanggal(s) {
  if (!s) return '';
  const d = parseISO(s);
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]}`;
}
export function fmtTanggalLengkap(s) {
  if (!s) return '';
  const d = parseISO(s);
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
export function periodRange(period, from, to) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) };
  if (period === 'lastmonth') return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) };
  if (period === 'custom') return { from: from || null, to: to || null };
  return { from: null, to: null };
}
export function periodLabel(period, from, to) {
  const r = periodRange(period, from, to);
  if (!r.from && !r.to) return 'Semua waktu';
  return `${r.from ? fmtTanggalLengkap(r.from) : 'awal'} s/d ${r.to ? fmtTanggalLengkap(r.to) : 'sekarang'}`;
}

export const itemsOf = (tx) => [...(tx.expense_items || [])].sort((a, b) => (a.urutan || 0) - (b.urutan || 0));

export function titleOf(tx) {
  if (tx.jenis === 'masuk') return tx.nama_penyetor || 'Pemasukan';
  const it = itemsOf(tx);
  if (!it.length) return tx.keterangan || 'Pengeluaran';
  return it[0].nama_barang + (it.length > 1 ? ` +${it.length - 1} barang lain` : '');
}

export function summarize(rows) {
  let masuk = 0;
  let keluar = 0;
  for (const r of rows) {
    if (r.jenis === 'masuk') masuk += Number(r.total) || 0;
    else keluar += Number(r.total) || 0;
  }
  return { masuk, keluar, saldo: masuk - keluar, count: rows.length };
}

export function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal').scrollTop = 0;
  document.body.classList.add('lock');
  return $('#modal-body');
}
export function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  document.body.classList.remove('lock');
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

export function formError(msg) {
  const e = $('#f-err');
  if (!e) return toast(msg);
  e.textContent = msg;
  e.hidden = false;
  e.scrollIntoView({ block: 'nearest' });
}

export function errMsg(err) {
  const m = err?.message || String(err || 'Terjadi kesalahan');
  if (/row-level security|permission denied|JWT/i.test(m)) {
    return 'Akses ditolak. Pastikan kamu sudah masuk sebagai bendahara.';
  }
  return m;
}

export const safeName = (s) => String(s || 'kas').replace(/[^\w\-]+/g, '_').slice(0, 40);
