import { $, rp, MINUS, BULAN, fmtTanggal, parseISO } from './utils.js';

let chart = null;
const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

export function renderChart(rows) {
  const box = $('#chart-box');
  const empty = $('#chart-empty');
  if (chart) { chart.destroy(); chart = null; }
  if (!rows.length || typeof Chart === 'undefined') {
    box.hidden = true;
    empty.hidden = false;
    return;
  }
  box.hidden = false;
  empty.hidden = true;

  // kalau rentang data > 2 bulan, kelompokkan per bulan; kalau tidak, per hari
  const dates = rows.map((r) => r.tanggal).sort();
  const span = (parseISO(dates[dates.length - 1]) - parseISO(dates[0])) / 86400000;
  const byMonth = span > 62;
  const map = new Map();
  for (const r of rows) {
    const k = byMonth ? r.tanggal.slice(0, 7) : r.tanggal;
    const o = map.get(k) || { masuk: 0, keluar: 0 };
    if (r.jenis === 'masuk') o.masuk += Number(r.total) || 0;
    else o.keluar += Number(r.total) || 0;
    map.set(k, o);
  }
  const keys = [...map.keys()].sort();
  const labels = keys.map((k) => (byMonth ? `${BULAN[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : fmtTanggal(k)));

  const deepPetrol = '#123C3D';
  const dustyBlue = '#8BA6A8';
  const warmIvory = '#F1EDE5';
  const darkCharcoal = '#242B2A';
  const gridLine = 'rgba(18, 60, 61, 0.18)';

  Chart.defaults.font.family = "'Inter Tight', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = darkCharcoal;

  chart = new Chart($('#chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Uang masuk', data: keys.map((k) => map.get(k).masuk), backgroundColor: deepPetrol, borderRadius: 0 },
        { label: 'Uang keluar', data: keys.map((k) => -map.get(k).keluar), backgroundColor: dustyBlue, borderRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: deepPetrol,
          borderColor: dustyBlue,
          borderWidth: 1,
          titleColor: warmIvory,
          bodyColor: warmIvory,
          cornerRadius: 2,
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.raw < 0 ? MINUS : '+'} ${rp(c.raw)}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { color: gridLine }, border: { color: deepPetrol }, ticks: { color: darkCharcoal } },
        y: {
          stacked: true,
          grid: { color: gridLine },
          border: { color: deepPetrol },
          ticks: {
            color: darkCharcoal,
            callback: (v) => (v < 0 ? MINUS : v > 0 ? '+' : '') + compact.format(Math.abs(v)),
          },
        },
      },
    },
  });
}
