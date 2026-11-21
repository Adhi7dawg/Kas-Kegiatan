import { sb } from './supabase.js';
import {
  $, $$, esc, rp, rpSigned, MINUS, fmtTanggal, fmtTanggalLengkap, todayISO, num,
  openModal, closeModal, toast, formError, errMsg, titleOf, itemsOf,
} from './utils.js';

const BUCKET = 'receipts';
const KAT_MASUK = ['Guru', 'Donatur', 'Sponsor', 'Siswa', 'Orang tua', 'Lainnya'];
const KAT_KELUAR = ['Konsumsi', 'Perlengkapan', 'Hadiah', 'Dekorasi', 'Transport', 'Sewa', 'Lainnya'];
const SATUAN = ['pcs', 'buah', 'kotak', 'pak', 'botol', 'lembar', 'kg', 'liter', 'meter', 'set', 'porsi'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const opts = (arr) => arr.map((k) => `<option value="${esc(k)}">`).join('');

/* ======================= DATA & FILTER ======================= */

export async function fetchTransactions(eventId) {
  const { data, error } = await sb
    .from('transactions')
    .select('*, expense_items(*), receipts(*)')
    .eq('event_id', eventId)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

export function filterByPeriod(rows, { from, to }) {
  return rows.filter((r) => (!from || r.tanggal >= from) && (!to || r.tanggal <= to));
}

export function filterList(rows, f) {
  const q = (f.q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.jenis && r.jenis !== f.jenis) return false;
    if (f.kategori && (r.kategori || '') !== f.kategori) return false;
    if (q) {
      const hay = [r.nama_penyetor, r.keterangan, r.kategori, ...itemsOf(r).flatMap((i) => [i.nama_barang, i.sub_barang])]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function renderList(el, rows) {
  if (!rows.length) {
    el.innerHTML = '<p class="empty">Belum ada transaksi yang cocok.</p>';
    return;
  }
  el.innerHTML =
    '<div class="row-head"><span>Tanggal</span><span>Uraian</span><span class="num">Nominal</span></div>' +
    rows
      .map((r) => {
        const sub = [r.kategori, r.keterangan, (r.receipts || []).length ? 'ada bukti' : ''].filter(Boolean).join(' · ');
        return `<div class="row" role="button" tabindex="0" data-id="${r.id}">
          <div class="r-date">${esc(fmtTanggal(r.tanggal))}</div>
          <div class="r-main"><div class="r-title">${esc(titleOf(r))}</div><div class="r-sub">${esc(sub)}</div></div>
          <div class="r-amt num">${esc(rpSigned(r.total, r.jenis))}</div>
        </div>`;
      })
      .join('');
}

/* ======================= AUDIT ======================= */

export async function fetchAudit() {
  const { data, error } = await sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export function renderAudit(el, logs) {
  if (!logs.length) {
    el.innerHTML = '<p class="empty">Belum ada catatan.</p>';
    return;
  }
  el.innerHTML = logs
    .map((l) => {
      const d = l.new_data || l.old_data || {};
      const aksi = { INSERT: 'Tambah', UPDATE: 'Ubah', DELETE: 'Hapus' }[l.action] || l.action;
      const tabel = { transactions: 'transaksi', events: 'kegiatan', receipts: 'bukti' }[l.table_name] || l.table_name;
      let ring = '';
      if (l.table_name === 'transactions') {
        ring = `${d.jenis === 'masuk' ? '+' : MINUS} ${rp(d.total)} ${d.nama_penyetor || d.kategori || d.keterangan || ''}`;
      } else if (l.table_name === 'events') {
        ring = d.nama || '';
      } else {
        ring = d.is_public === false ? 'foto bukti (privat)' : 'foto bukti';
      }
      const waktu = new Date(l.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<div class="arow"><div class="r-sub">${esc(waktu)} · ${esc(l.user_email || 'sistem')}</div><div>${esc(aksi)} ${esc(tabel)}: ${esc(ring)}</div></div>`;
    })
    .join('');
}

/* ======================= BUKTI (STORAGE) ======================= */

const fileFieldHTML = `
  <div id="file-box">
    <label class="field"><span class="lbl">Foto bukti (opsional, JPG/PNG/WebP, maks 5 MB)</span>
      <input type="file" accept="image/jpeg,image/png,image/webp"></label>
    <div class="preview"></div>
    <div class="r-sub file-err"></div>
  </div>
  <label class="check"><input type="checkbox" id="f-public" checked> Tampilkan bukti ini ke publik</label>`;

function mountFile(root) {
  const input = $('input[type=file]', root);
  const prev = $('.preview', root);
  const err = $('.file-err', root);
  let file = null;
  input.addEventListener('change', () => {
    err.textContent = '';
    prev.innerHTML = '';
    file = null;
    const f = input.files[0];
    if (!f) return;
    if (!EXT[f.type]) { err.textContent = 'Format harus JPG, PNG, atau WebP.'; input.value = ''; return; }
    if (f.size > 5 * 1024 * 1024) { err.textContent = 'Ukuran maksimal 5 MB.'; input.value = ''; return; }
    file = f;
    const img = document.createElement('img');
    img.className = 'thumb';
    img.alt = 'Pratinjau bukti';
    img.src = URL.createObjectURL(f);
    prev.appendChild(img);
  });
  return () => file;
}

async function uploadReceipt(file, eventId, txId, isPublic) {
  const path = `${eventId}/${txId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const ins = await sb.from('receipts').insert({ transaction_id: txId, file_path: path, is_public: isPublic });
  if (ins.error) {
    await sb.storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
}

async function removeFiles(paths) {
  if (!paths.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

async function afterSave(ctx, uploadErr, okMsg) {
  closeModal();
  toast(uploadErr ? `${okMsg} Tapi foto bukti gagal diunggah: ${errMsg(uploadErr)}` : okMsg);
  await ctx.reload();
}

/* ======================= DETAIL ======================= */

export async function openDetail(tx, ctx) {
  const isIn = tx.jenis === 'masuk';
  const items = itemsOf(tx);
  const canEdit = ctx.canEdit;

  const itemsHTML = !isIn
    ? `<h3>Rincian barang</h3>` +
      (items.length
        ? items
            .map(
              (i) => `<div class="irow">
                <div><div>${esc(i.nama_barang)}${i.sub_barang ? ' · ' + esc(i.sub_barang) : ''}</div>
                <div class="r-sub">${esc(i.qty)} ${esc(i.satuan)}${i.harga_satuan != null ? ' × ' + esc(rp(i.harga_satuan)) : ''}</div></div>
                <div class="num">${esc(rp(i.total_harga))}</div></div>`
            )
            .join('')
        : '<p class="r-sub">Tidak ada rincian.</p>')
    : '';

  openModal(`
    <h2>${isIn ? 'Uang masuk' : 'Uang keluar'}</h2>
    <div class="amt">${esc(rpSigned(tx.total, tx.jenis))}</div>
    <dl class="kv">
      <div><dt>Tanggal</dt><dd>${esc(fmtTanggalLengkap(tx.tanggal))}</dd></div>
      ${isIn ? `<div><dt>Nama penyetor</dt><dd>${esc(tx.nama_penyetor)}</dd></div>` : ''}
      <div><dt>${isIn ? 'Asal' : 'Kategori'}</dt><dd>${esc(tx.kategori || '-')}</dd></div>
      <div><dt>Keterangan</dt><dd>${esc(tx.keterangan || '-')}</dd></div>
    </dl>
    ${itemsHTML}
    <h3>Bukti</h3>
    <div id="d-receipts"><p class="r-sub">Memuat...</p></div>
    ${canEdit ? `<div class="actions"><button class="btn" id="d-edit" type="button">Ubah</button><button class="btn" id="d-del" type="button">Hapus</button></div>` : ''}
  `);

  const box = $('#d-receipts');

  async function renderReceipts() {
    const list = tx.receipts || [];
    if (!list.length) { box.innerHTML = '<p class="r-sub">Tidak ada bukti.</p>'; return; }
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(list.map((r) => r.file_path), 3600);
    const urlOf = new Map((data || []).map((d) => [d.path, d.signedUrl]));
    box.innerHTML =
      '<div class="rcp">' +
      list
        .map((r) => {
          const u = urlOf.get(r.file_path);
          return `<div class="rc">
            ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Bukti transaksi"></a>` : '<div class="r-sub">Gagal memuat</div>'}
            ${canEdit ? `<div class="rc-act"><span class="r-sub">${r.is_public ? 'Publik' : 'Privat'}</span>
              <button type="button" class="btn-text" data-act="toggle" data-id="${r.id}">Ubah</button>
              <button type="button" class="btn-text" data-act="del" data-id="${r.id}">Hapus</button></div>` : ''}
          </div>`;
        })
        .join('') +
      '</div>';
  }
  renderReceipts();

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const r = (tx.receipts || []).find((x) => x.id === b.dataset.id);
    if (!r) return;
    b.disabled = true;
    try {
      if (b.dataset.act === 'toggle') {
        const { error } = await sb.from('receipts').update({ is_public: !r.is_public }).eq('id', r.id);
        if (error) throw error;
        r.is_public = !r.is_public;
      } else {
        if (!confirm('Hapus foto bukti ini?')) { b.disabled = false; return; }
        await removeFiles([r.file_path]);
        const { error } = await sb.from('receipts').delete().eq('id', r.id);
        if (error) throw error;
        tx.receipts = tx.receipts.filter((x) => x.id !== r.id);
      }
      await renderReceipts();
      ctx.reload();
    } catch (err) {
      toast(errMsg(err));
      b.disabled = false;
    }
  });

  if (canEdit) {
    $('#d-edit').onclick = () => {
      closeModal();
      (isIn ? openIncomeForm : openExpenseForm)(tx.event_id, tx, ctx);
    };
    $('#d-del').onclick = async () => {
      if (!confirm('Hapus transaksi ini? Foto buktinya juga ikut terhapus.')) return;
      $('#d-del').disabled = true;
      try {
        await removeFiles((tx.receipts || []).map((r) => r.file_path)); // hapus file dulu, supaya tidak ada file yatim
        const { error } = await sb.from('transactions').delete().eq('id', tx.id);
        if (error) throw error;
        closeModal();
        toast('Transaksi dihapus.');
        await ctx.reload();
      } catch (err) {
        toast(errMsg(err));
        $('#d-del').disabled = false;
      }
    };
  }
}

/* ======================= FORM PEMASUKAN ======================= */

export function openIncomeForm(eventId, tx, ctx) {
  const t = tx || {};
  const body = openModal(`
    <h2>${tx ? 'Ubah pemasukan' : 'Catat pemasukan'}</h2>
    <div id="f-err" class="err" hidden></div>
    <form id="form-in" novalidate>
      <label class="field"><span class="lbl">Nama penyetor</span>
        <input id="in-nama" required autocomplete="off" value="${esc(t.nama_penyetor)}"></label>
      <label class="field"><span class="lbl">Asal (guru, donatur, sponsor, dll)</span>
        <input id="in-asal" list="dl-asal" autocomplete="off" value="${esc(t.kategori)}"></label>
      <datalist id="dl-asal">${opts(KAT_MASUK)}</datalist>
      <div class="grid2">
        <label class="field"><span class="lbl">Nominal (Rp)</span>
          <input id="in-nominal" type="number" inputmode="decimal" min="0" step="any" required value="${esc(t.total ?? '')}"></label>
        <label class="field"><span class="lbl">Tanggal</span>
          <input id="in-tgl" type="date" required value="${esc(t.tanggal || todayISO())}"></label>
      </div>
      <label class="field"><span class="lbl">Keterangan (opsional)</span>
        <textarea id="in-ket" rows="2">${esc(t.keterangan)}</textarea></label>
      ${fileFieldHTML}
      <div class="actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn" type="button" id="f-cancel">Batal</button>
      </div>
    </form>`);
  $('#f-cancel').onclick = closeModal;
  const getFile = mountFile($('#file-box', body));

  $('#form-in').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('#in-nama').value.trim();
    const asal = $('#in-asal').value.trim();
    const nominal = num($('#in-nominal').value);
    const tgl = $('#in-tgl').value;
    const ket = $('#in-ket').value.trim();
    if (!nama) return formError('Nama penyetor wajib diisi.');
    if (!(nominal > 0)) return formError('Nominal harus lebih dari 0.');
    if (!tgl) return formError('Tanggal wajib diisi.');
    const btn = e.submitter || $('#form-in button[type=submit]');
    btn.disabled = true;
    try {
      const payload = { tanggal: tgl, nama_penyetor: nama, kategori: asal || null, total: nominal, keterangan: ket || null };
      let id = tx?.id;
      if (tx) {
        const { error } = await sb.from('transactions').update(payload).eq('id', tx.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb
          .from('transactions')
          .insert({ ...payload, event_id: eventId, jenis: 'masuk' })
          .select('id')
          .single();
        if (error) throw error;
        id = data.id;
      }
      let upErr = null;
      const f = getFile();
      if (f) {
        try { await uploadReceipt(f, eventId, id, $('#f-public').checked); } catch (ex) { upErr = ex; }
      }
      await afterSave(ctx, upErr, 'Pemasukan tersimpan.');
    } catch (err) {
      formError(errMsg(err));
      btn.disabled = false;
    }
  });
}

/* ======================= FORM PENGELUARAN ======================= */

export function openExpenseForm(eventId, tx, ctx) {
  const t = tx || {};
  const old = tx ? itemsOf(tx) : [];
  const mode0 = t.mode === 'B' ? 'B' : 'A';

  const body = openModal(`
    <h2>${tx ? 'Ubah pengeluaran' : 'Catat pengeluaran'}</h2>
    <div id="f-err" class="err" hidden></div>
    <form id="form-out" novalidate>
      <div class="field"><span class="lbl">Mode</span>
        <div class="seg">
          <label><input type="radio" name="mode" value="A" ${mode0 === 'A' ? 'checked' : ''}><span>Banyak barang</span></label>
          <label><input type="radio" name="mode" value="B" ${mode0 === 'B' ? 'checked' : ''}><span>Satu barang</span></label>
        </div>
      </div>
      <div class="grid2">
        <label class="field"><span class="lbl">Tanggal</span>
          <input id="out-tgl" type="date" required value="${esc(t.tanggal || todayISO())}"></label>
        <label class="field"><span class="lbl">Kategori (opsional)</span>
          <input id="out-kat" list="dl-kat-out" autocomplete="off" value="${esc(t.kategori)}"></label>
      </div>
      <datalist id="dl-kat-out">${opts(KAT_KELUAR)}</datalist>
      <datalist id="dl-sat">${opts(SATUAN)}</datalist>
      <label class="field"><span class="lbl">Keterangan (opsional)</span>
        <textarea id="out-ket" rows="2">${esc(t.keterangan)}</textarea></label>
      <div id="items"></div>
      <button type="button" class="btn" id="add-item">Tambah barang</button>
      <div class="total-row"><span>Total pengeluaran</span><span class="num" id="grand">Rp 0</span></div>
      ${fileFieldHTML}
      <div class="actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn" type="button" id="f-cancel">Batal</button>
      </div>
    </form>`);

  const itemsBox = $('#items', body);
  const grand = $('#grand', body);
  const addBtn = $('#add-item', body);
  const curMode = () => $('input[name=mode]:checked', body).value;
  $('#f-cancel').onclick = closeModal;
  const getFile = mountFile($('#file-box', body));

  function updateGrand() {
    let sum = 0;
    $$('.i-total', itemsBox).forEach((i) => { const v = num(i.value); if (v >= 0) sum += v; });
    grand.textContent = rp(sum);
  }

  function recalc(row) {
    const qty = num($('.i-qty', row).value);
    const hargaRaw = $('.i-harga', row).value;
    const tot = $('.i-total', row);
    if (hargaRaw !== '') {
      const h = num(hargaRaw);
      tot.readOnly = true;
      tot.value = qty >= 0 && h >= 0 ? String(Math.round(qty * h * 100) / 100) : '';
    } else {
      tot.readOnly = false;
    }
    updateGrand();
  }

  function addItem(d = {}) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <label class="field"><span class="lbl">Nama barang</span><input class="i-nama" autocomplete="off" value="${esc(d.nama_barang)}"></label>
      <label class="field"><span class="lbl">Sub barang (opsional)</span><input class="i-sub" autocomplete="off" value="${esc(d.sub_barang)}"></label>
      <div class="grid2">
        <label class="field"><span class="lbl">Qty</span><input class="i-qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.qty ?? '')}"></label>
        <label class="field"><span class="lbl">Satuan</span><input class="i-sat" list="dl-sat" autocomplete="off" value="${esc(d.satuan)}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span class="lbl">Harga satuan (opsional)</span><input class="i-harga" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.harga_satuan ?? '')}"></label>
        <label class="field"><span class="lbl">Total harga</span><input class="i-total" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.total_harga ?? '')}"></label>
      </div>
      <button type="button" class="btn-text i-del">Hapus barang ini</button>`;
    itemsBox.appendChild(el);
    $$('input', el).forEach((i) => i.addEventListener('input', () => recalc(el)));
    $('.i-del', el).addEventListener('click', () => {
      if ($$('.item', itemsBox).length > 1) { el.remove(); updateGrand(); }
    });
    recalc(el);
  }

  function applyMode() {
    const single = curMode() === 'B';
    itemsBox.classList.toggle('single', single);
    addBtn.hidden = single;
  }

  (mode0 === 'B' ? old.slice(0, 1) : old).forEach(addItem);
  if (!$$('.item', itemsBox).length) addItem();
  applyMode();

  addBtn.addEventListener('click', () => addItem());
  $$('input[name=mode]', body).forEach((r) =>
    r.addEventListener('change', () => {
      if (curMode() === 'B' && $$('.item', itemsBox).length > 1) {
        if (!confirm('Mode satu barang hanya menyimpan barang pertama. Lanjut?')) {
          $('input[name=mode][value=A]', body).checked = true;
          return;
        }
        $$('.item', itemsBox).slice(1).forEach((x) => x.remove());
        updateGrand();
      }
      applyMode();
    })
  );

  $('#form-out').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tgl = $('#out-tgl').value;
    const kat = $('#out-kat').value.trim();
    const ket = $('#out-ket').value.trim();
    if (!tgl) return formError('Tanggal wajib diisi.');

    const out = [];
    const rows = $$('.item', itemsBox);
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const n = idx + 1;
      const nama = $('.i-nama', r).value.trim();
      const sub = $('.i-sub', r).value.trim();
      const qty = num($('.i-qty', r).value);
      const sat = $('.i-sat', r).value.trim();
      const hargaRaw = $('.i-harga', r).value;
      const total = num($('.i-total', r).value);
      if (!nama) return formError(`Barang ${n}: nama barang wajib diisi.`);
      if (!(qty > 0)) return formError(`Barang ${n}: qty harus lebih dari 0.`);
      if (!sat) return formError(`Barang ${n}: satuan wajib diisi.`);
      let harga = null;
      if (hargaRaw !== '') {
        harga = num(hargaRaw);
        if (!(harga >= 0)) return formError(`Barang ${n}: harga satuan tidak boleh negatif.`);
      } else if (!(total >= 0)) {
        return formError(`Barang ${n}: total harga wajib diisi (tidak boleh negatif).`);
      }
      out.push({
        nama_barang: nama,
        sub_barang: sub || null,
        qty,
        satuan: sat,
        harga_satuan: harga,
        total_harga: harga !== null ? Math.round(qty * harga * 100) / 100 : total,
      });
    }

    const btn = e.submitter || $('#form-out button[type=submit]');
    btn.disabled = true;
    try {
      const { data, error } = await sb.rpc('save_expense', {
        p_transaction_id: tx?.id ?? null,
        p_event_id: eventId,
        p_tanggal: tgl,
        p_kategori: kat || null,
        p_keterangan: ket || null,
        p_mode: curMode(),
        p_items: out,
      });
      if (error) throw error;
      let upErr = null;
      const f = getFile();
      if (f) {
        try { await uploadReceipt(f, eventId, data, $('#f-public').checked); } catch (ex) { upErr = ex; }
      }
      await afterSave(ctx, upErr, 'Pengeluaran tersimpan.');
    } catch (err) {
      formError(errMsg(err));
      btn.disabled = false;
    }
  });
}
