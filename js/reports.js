import { summarize, rp, fmtTanggal, fmtTanggalLengkap, todayISO, itemsOf, titleOf, safeName } from './utils.js';

const pdfSigned = (n, jenis) => (jenis === 'masuk' ? '+ ' : '- ') + rp(n);
const byDateAsc = (a, b) => (a.tanggal === b.tanggal ? 0 : a.tanggal < b.tanggal ? -1 : 1);

/* ========================= PDF ========================= */
export function exportPDF({ event, rows, periodText, filterText }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const s = summarize(rows);
  const sorted = [...rows].sort(byDateAsc);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Laporan kas kegiatan', M, 50);
  doc.setFontSize(12);
  doc.text(event.nama, M, 70);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let y = 88;
  const info = [`Periode: ${periodText}`];
  if (filterText) info.push(`Filter: ${filterText}`);
  info.push(`Dicetak: ${fmtTanggalLengkap(todayISO())}`);
  info.forEach((l) => { doc.text(l, M, y); y += 14; });

  const head = { fillColor: [30, 30, 30], textColor: 255 };

  doc.autoTable({
    startY: y + 6,
    head: [['Ringkasan', '']],
    body: [
      ['Total uang masuk', rp(s.masuk)],
      ['Total uang keluar', rp(s.keluar)],
      ['Saldo akhir', (s.saldo < 0 ? '- ' : '') + rp(s.saldo)],
      ['Jumlah transaksi', String(s.count)],
    ],
    theme: 'grid',
    headStyles: head,
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: M, right: M },
    tableWidth: 300,
  });

  y = doc.lastAutoTable.finalY + 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Daftar transaksi', M, y);
  doc.autoTable({
    startY: y + 6,
    head: [['Tanggal', 'Jenis', 'Uraian', 'Kategori', 'Nominal']],
    body: sorted.map((r) => [
      fmtTanggalLengkap(r.tanggal),
      r.jenis === 'masuk' ? 'Masuk' : 'Keluar',
      titleOf(r) + (r.keterangan ? ` - ${r.keterangan}` : ''),
      r.kategori || '-',
      pdfSigned(r.total, r.jenis),
    ]),
    theme: 'grid',
    headStyles: head,
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 4: { halign: 'right', cellWidth: 90 }, 0: { cellWidth: 85 }, 1: { cellWidth: 40 } },
    margin: { left: M, right: M },
  });

  const detail = [];
  sorted.filter((r) => r.jenis === 'keluar').forEach((r) =>
    itemsOf(r).forEach((i) =>
      detail.push([
        fmtTanggal(r.tanggal),
        i.nama_barang + (i.sub_barang ? ` (${i.sub_barang})` : ''),
        `${i.qty} ${i.satuan}`,
        i.harga_satuan != null ? rp(i.harga_satuan) : '-',
        rp(i.total_harga),
      ])
    )
  );
  if (detail.length) {
    y = doc.lastAutoTable.finalY + 24;
    if (y > H - 100) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Rincian barang pengeluaran', M, y);
    doc.autoTable({
      startY: y + 6,
      head: [['Tanggal', 'Barang', 'Qty', 'Harga satuan', 'Total']],
      body: detail,
      theme: 'grid',
      headStyles: head,
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { left: M, right: M },
    });
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Halaman ${i} dari ${n}`, W - M, H - 20, { align: 'right' });
  }
  doc.save(`Kas_${safeName(event.nama)}_${todayISO()}.pdf`);
}

/* ========================= EXCEL ========================= */
function setFmt(ws, cols, z) {
  Object.keys(ws).forEach((addr) => {
    if (addr[0] === '!') return;
    const col = addr.replace(/[0-9]/g, '');
    if (cols.includes(col) && ws[addr].t === 'n') ws[addr].z = z;
  });
}

export function exportExcel({ event, rows, periodText }) {
  const wb = XLSX.utils.book_new();
  const s = summarize(rows);
  const sorted = [...rows].sort(byDateAsc);

  const ringkasan = XLSX.utils.aoa_to_sheet([
    ['Laporan kas kegiatan'],
    ['Kegiatan', event.nama],
    ['Periode', periodText],
    ['Dicetak', todayISO()],
    [],
    ['Total pemasukan', s.masuk],
    ['Total pengeluaran', s.keluar],
    ['Saldo akhir', s.saldo],
    ['Jumlah transaksi', s.count],
  ]);
  ringkasan['!cols'] = [{ wch: 22 }, { wch: 36 }];
  setFmt(ringkasan, ['B'], '#,##0');
  XLSX.utils.book_append_sheet(wb, ringkasan, 'Ringkasan');

  const masuk = XLSX.utils.aoa_to_sheet([
    ['Tanggal', 'Nama penyetor', 'Asal', 'Nominal', 'Keterangan', 'Jumlah bukti'],
    ...sorted.filter((r) => r.jenis === 'masuk').map((r) => [
      r.tanggal, r.nama_penyetor || '', r.kategori || '', Number(r.total), r.keterangan || '', (r.receipts || []).length,
    ]),
  ]);
  masuk['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 12 }];
  setFmt(masuk, ['D'], '#,##0');
  XLSX.utils.book_append_sheet(wb, masuk, 'Pemasukan');

  const keluar = XLSX.utils.aoa_to_sheet([
    ['Tanggal', 'Barang', 'Kategori', 'Total', 'Keterangan', 'Mode'],
    ...sorted.filter((r) => r.jenis === 'keluar').map((r) => [
      r.tanggal, titleOf(r), r.kategori || '', Number(r.total), r.keterangan || '',
      r.mode === 'B' ? 'Satu barang' : 'Banyak barang',
    ]),
  ]);
  keluar['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 16 }];
  setFmt(keluar, ['D'], '#,##0');
  XLSX.utils.book_append_sheet(wb, keluar, 'Pengeluaran');

  const detail = [['Tanggal', 'Kategori', 'Nama barang', 'Sub barang', 'Qty', 'Satuan', 'Harga satuan', 'Total harga']];
  sorted.filter((r) => r.jenis === 'keluar').forEach((r) =>
    itemsOf(r).forEach((i) =>
      detail.push([
        r.tanggal, r.kategori || '', i.nama_barang, i.sub_barang || '', Number(i.qty), i.satuan,
        i.harga_satuan != null ? Number(i.harga_satuan) : '', Number(i.total_harga),
      ])
    )
  );
  const wsDetail = XLSX.utils.aoa_to_sheet(detail);
  wsDetail['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 20 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
  setFmt(wsDetail, ['G', 'H'], '#,##0');
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail Barang');

  XLSX.writeFile(wb, `Kas_${safeName(event.nama)}_${todayISO()}.xlsx`);
}
