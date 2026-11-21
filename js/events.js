import { sb } from './supabase.js';
import { $, esc, fmtTanggalLengkap, openModal, closeModal, formError, errMsg } from './utils.js';

export async function fetchEvents() {
  const { data, error } = await sb.from('events').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function rangeText(e) {
  if (e.tanggal_mulai && e.tanggal_selesai) return `${fmtTanggalLengkap(e.tanggal_mulai)} s/d ${fmtTanggalLengkap(e.tanggal_selesai)}`;
  if (e.tanggal_mulai) return `Mulai ${fmtTanggalLengkap(e.tanggal_mulai)}`;
  return '';
}

export function renderEventList(el, events, activeId) {
  if (!events.length) {
    el.innerHTML = '<p class="empty">Belum ada kegiatan.</p>';
    return;
  }
  const sorted = [...events].sort((a, b) => (a.status === b.status ? 0 : a.status === 'aktif' ? -1 : 1));
  el.innerHTML = sorted
    .map(
      (e) => `<button type="button" class="ev${e.id === activeId ? ' is-active' : ''}" data-id="${e.id}">
        <span><span class="ev-name">${esc(e.nama)}</span><span class="r-sub db">${esc(rangeText(e))}</span></span>
        <span class="r-sub">${e.status === 'aktif' ? 'Aktif' : 'Diarsipkan'}</span>
      </button>`
    )
    .join('');
}

export async function setEventStatus(id, status) {
  const { error } = await sb.from('events').update({ status }).eq('id', id);
  if (error) throw error;
}

export function openEventForm(ev, onSaved) {
  const t = ev || {};
  openModal(`
    <h2>${ev ? 'Ubah kegiatan' : 'Kegiatan baru'}</h2>
    <div id="f-err" class="err" hidden></div>
    <form id="form-ev" novalidate>
      <label class="field"><span class="lbl">Nama kegiatan</span>
        <input id="ev-nama" required placeholder="Classmeeting 2026" value="${esc(t.nama)}" autocomplete="off"></label>
      <label class="field"><span class="lbl">Deskripsi (opsional)</span>
        <textarea id="ev-desc" rows="2">${esc(t.deskripsi)}</textarea></label>
      <div class="grid2">
        <label class="field"><span class="lbl">Tanggal mulai</span><input id="ev-mulai" type="date" value="${esc(t.tanggal_mulai)}"></label>
        <label class="field"><span class="lbl">Tanggal selesai</span><input id="ev-selesai" type="date" value="${esc(t.tanggal_selesai)}"></label>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn" type="button" id="f-cancel">Batal</button>
      </div>
    </form>`);
  $('#f-cancel').onclick = closeModal;
  $('#form-ev').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('#ev-nama').value.trim();
    const deskripsi = $('#ev-desc').value.trim() || null;
    const mulai = $('#ev-mulai').value || null;
    const selesai = $('#ev-selesai').value || null;
    if (!nama) return formError('Nama kegiatan wajib diisi.');
    if (mulai && selesai && selesai < mulai) return formError('Tanggal selesai tidak boleh sebelum tanggal mulai.');
    const btn = e.submitter || $('#form-ev button[type=submit]');
    btn.disabled = true;
    try {
      const payload = { nama, deskripsi, tanggal_mulai: mulai, tanggal_selesai: selesai };
      let id = ev?.id;
      if (ev) {
        const { error } = await sb.from('events').update(payload).eq('id', ev.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('events').insert(payload).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      closeModal();
      await onSaved(id);
    } catch (err) {
      formError(errMsg(err));
      btn.disabled = false;
    }
  });
}
