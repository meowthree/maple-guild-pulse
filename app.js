const state = { metric: 'conquest', history: null, config: null, selectedSnap: null };
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const escHtml = s => String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = n => n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
// MapleStory number suffixes: K M B T then AA AB AC ... AZ BA BB ...
const SUFFIXES = ['', 'K', 'M', 'B', 'T'];
function alphaSuffix(tier) {
  const idx = tier - SUFFIXES.length;
  const first = String.fromCharCode(65 + Math.floor(idx / 26));
  const second = String.fromCharCode(65 + (idx % 26));
  return first + second;
}
const fmtCompact = n => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs < 1000) return fmt(n);
  let tier = Math.floor(Math.log10(abs) / 3);
  const divisor = Math.pow(10, tier * 3);
  const val = n / divisor;
  const suffix = tier < SUFFIXES.length ? SUFFIXES[tier] : alphaSuffix(tier);
  const decimals = Math.abs(val) >= 100 ? 0 : Math.abs(val) >= 10 ? 1 : 2;
  return val.toFixed(decimals) + suffix;
};

function pct(prev, cur) {
  if (prev == null || cur == null) return null;
  if (prev === 0) return cur > 0 ? Infinity : 0;
  return (cur - prev) / prev;
}

function snapshots() {
  return [...state.history.snapshots].sort((a, b) => a.date.localeCompare(b.date));
}

function latestIdx() {
  const snaps = snapshots();
  if (state.selectedSnap) {
    const idx = snaps.findIndex(s => s.date === state.selectedSnap);
    if (idx >= 0) return idx;
  }
  return snaps.length - 1;
}

// Build the roster from snapshot data. The latest snapshot with a `members` field is
// the source of truth — no hardcoded members.json needed.
function getRoster() {
  const snaps = snapshots();
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].members && Object.keys(snaps[i].members).length > 0) {
      return snaps[i].members;
    }
  }
  // Fallback for seed data without a members field: derive names from score keys
  const names = new Set();
  for (const s of snaps) {
    for (const key of ['conquest', 'guildWar']) {
      if (s[key]) Object.keys(s[key]).forEach(n => names.add(n));
    }
  }
  const roster = {};
  for (const n of names) roster[n] = { level: null, job: null, cp: null };
  return roster;
}

function getMemberMeta(name) {
  const snaps = snapshots();
  for (let i = snaps.length - 1; i >= 0; i--) {
    const m = snaps[i].members?.[name];
    if (m) return m;
  }
  return { level: null, job: null, cp: null };
}

function buildRows() {
  const snaps = snapshots();
  const idx = latestIdx();
  const cur = snaps[idx];
  const prev = idx > 0 ? snaps[idx - 1] : null;
  const roster = getRoster();

  const metricKey = state.metric;
  const curScores = cur?.[metricKey] || {};
  const prevScores = prev?.[metricKey] || {};
  const errors = cur?.errors || [];

  return Object.keys(roster).map(name => {
    const meta = cur?.members?.[name] || getMemberMeta(name);
    const curVal = curScores[name] ?? null;
    const prevVal = prevScores[name] ?? null;
    const growth = pct(prevVal, curVal);
    const threshold = state.config?.threshold ?? 0.05;
    const pass = growth != null && growth >= threshold;
    const isFetchError = errors.includes(name);

    let status;
    if (isFetchError) status = 'error';
    else if (curVal == null && prevVal == null) status = 'new';
    else if (curVal == null) status = 'missing';
    else if (prevVal == null) status = 'nobaseline';
    else if (pass) status = 'good';
    else status = 'bad';

    return {
      name,
      level: meta.level ?? null,
      job: meta.job ?? null,
      cp: meta.cp ?? null,
      previous: prevVal,
      current: curVal,
      growth,
      pass,
      status,
    };
  });
}

function render() {
  const rows = buildRows();
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const filtered = rows.filter(r =>
    r.name.toLowerCase().includes(q) || (r.job || '').toLowerCase().includes(q)
  );

  filtered.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'growth') return (b.growth ?? -999) - (a.growth ?? -999);
    if (sort === 'status') return statusOrder(a.status) - statusOrder(b.status);
    if (sort === 'cp') return (b.cp ?? -1) - (a.cp ?? -1);
    if (sort === 'level') return (b.level ?? -1) - (a.level ?? -1);
    if (sort === 'job') return (a.job || 'zzz').localeCompare(b.job || 'zzz');
    return (b.current ?? -1) - (a.current ?? -1);
  });

  const tbody = $('#memberRows');
  tbody.innerHTML = filtered.map((r, idx) => {
    const cls = r.status === 'good' ? 'good' : r.status === 'bad' ? 'bad' : 'new';
    const growthText = r.growth == null ? '—'
      : r.growth === Infinity ? '∞'
        : `${r.growth >= 0 ? '+' : ''}${(r.growth * 100).toFixed(1)}%`;

    let pulseLabel, pulseIcon;
    if (r.status === 'good') { pulseIcon = '▲'; pulseLabel = 'GREAT'; }
    else if (r.status === 'bad') { pulseIcon = '▼'; pulseLabel = 'CHECK'; }
    else if (r.status === 'error') { pulseIcon = '⚠'; pulseLabel = 'FAILED'; }
    else if (r.status === 'missing') { pulseIcon = '◆'; pulseLabel = 'MISSING'; }
    else if (r.status === 'nobaseline') { pulseIcon = '◆'; pulseLabel = 'NO BASE'; }
    else { pulseIcon = '◆'; pulseLabel = 'NEW'; }

    const rowCls = r.status === 'good' ? 'row-good' : r.status === 'bad' ? 'row-bad' : 'row-new';
    const change = (r.current != null && r.previous != null) ? r.current - r.previous : null;
    const changeText = change == null ? '' : `${change >= 0 ? '+' : ''}${fmtCompact(change)}`;
    const jobText = r.job ? escHtml(r.job) : '<span class="muted-cell">—</span>';
    const lvlText = r.level != null ? r.level : '—';
    const cpText = r.cp != null ? fmtCompact(r.cp) : '—';

    return `<tr class="${rowCls} clickable-row" data-member="${escHtml(r.name)}">
      <td>${idx + 1}</td>
      <td><span class="member-badge"><span class="maple-leaf">★</span><span class="member-name">${escHtml(r.name)}</span></span></td>
      <td class="job-col">${jobText}</td>
      <td class="num lvl-col">${lvlText}</td>
      <td class="num cp-col">${cpText}</td>
      <td class="num score">${fmtCompact(r.previous)}</td>
      <td class="num score">${fmtCompact(r.current)}</td>
      <td class="num change-col">${changeText}</td>
      <td class="growth ${cls}">${growthText}</td>
      <td class="trend-col"><span class="arrow ${cls}">${pulseIcon} ${pulseLabel}</span></td>
    </tr>`;
  }).join('');

  $('#empty').classList.toggle('hidden', filtered.length > 0);

  const withBoth = rows.filter(r => r.current != null && r.previous != null);
  const good = withBoth.filter(r => r.pass);
  const attention = withBoth.filter(r => !r.pass);
  const noBaseline = rows.filter(r => r.status === 'new' || r.status === 'nobaseline');
  const biggest = withBoth.reduce((a, b) => (b.growth ?? -Infinity) > (a?.growth ?? -Infinity) ? b : a, null);

  $('#membersCount').textContent = rows.length;
  $('#improvedCount').textContent = good.length;
  $('#attentionCount').textContent = attention.length;
  $('#noBaseCount').textContent = noBaseline.length;
  $('#biggestJump').textContent = biggest ? `${biggest.growth >= 0 ? '+' : ''}${(biggest.growth * 100).toFixed(1)}%` : '—';
  $('#biggestName').textContent = biggest?.name || '—';

  const snaps = snapshots();
  const idx = latestIdx();
  const snap = snaps[idx];
  const scores = snap?.[state.metric] || {};
  const errorCount = snap?.errors?.length || 0;
  const scoreCount = Object.keys(scores).length;
  const total = rows.length;

  const dateStr = snap?.timestamp
    ? new Date(snap.timestamp).toLocaleString('en-SG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Singapore' })
    : snap?.date || 'No snapshot yet';

  if (snap?.source === 'manual-seed') {
    $('#sourceStatus').textContent = 'Seed data (manually entered)';
    $('.status-dot').style.background = 'var(--gold)';
  } else if (snap?.source === 'mapleidle.gg') {
    $('#sourceStatus').textContent = 'Live data from mapleidle.gg';
    $('.status-dot').style.background = 'var(--good)';
  } else {
    $('#sourceStatus').textContent = 'Snapshot loaded';
    $('.status-dot').style.background = 'var(--good)';
  }

  $('#lastUpdated').textContent = dateStr;

  if (errorCount > 0) {
    $('#collectionStatus').textContent = `⚠ ${scoreCount}/${total} collected · ${errorCount} failed`;
    $('#collectionStatus').classList.remove('hidden');
  } else {
    $('#collectionStatus').textContent = `${scoreCount}/${total} members collected`;
    $('#collectionStatus').classList.remove('hidden');
  }

  $('#weekLabel').textContent = snap?.date || 'NONE';
  renderSnapshotSelector(snaps, idx);
}

function statusOrder(s) {
  const order = { good: 0, bad: 1, nobaseline: 2, new: 3, missing: 4, error: 5 };
  return order[s] ?? 9;
}

function renderSnapshotSelector(snaps, currentIdx) {
  const sel = $('#snapshotSelect');
  if (!sel) return;
  const opts = snaps.map((s, i) =>
    `<option value="${s.date}"${i === currentIdx ? ' selected' : ''}>${s.date}</option>`
  ).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
}

// --- Member detail modal ---
function showMemberDetail(memberName) {
  const snaps = snapshots();
  const meta = getMemberMeta(memberName);
  const modal = $('#memberModal');

  $('#modalName').textContent = memberName;
  const metricLabel = state.metric === 'conquest' ? 'Guild Conquest' : 'Guild War';
  $('#modalMetric').textContent = metricLabel;

  const statParts = [];
  if (meta.job) statParts.push(meta.job);
  if (meta.level != null) statParts.push('Lv ' + meta.level);
  if (meta.cp != null) statParts.push('CP ' + fmt(meta.cp));
  $('#modalStats').textContent = statParts.join(' · ') || '—';

  const dataPoints = snaps.map(s => ({
    date: s.date,
    score: s[state.metric]?.[memberName] ?? null,
  }));

  const tableHtml = dataPoints.map((d, i) => {
    const prev = i > 0 ? dataPoints[i - 1].score : null;
    const growth = pct(prev, d.score);
    const growthText = growth == null ? '—'
      : `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(1)}%`;
    const cls = growth == null ? 'new' : growth >= (state.config?.threshold ?? 0.05) ? 'good' : 'bad';
    return `<tr>
      <td>${d.date}</td>
      <td class="num score">${fmtCompact(d.score)}</td>
      <td class="growth ${cls}">${growthText}</td>
    </tr>`;
  }).join('');

  $('#modalHistory').innerHTML = tableHtml;
  renderChart(dataPoints);

  modal.classList.remove('hidden');
  modal.addEventListener('click', closeModalOnBackdrop);
}

function renderChart(dataPoints) {
  const canvas = $('#modalChart');
  const validPoints = dataPoints.filter(d => d.score != null);

  if (validPoints.length < 2) {
    canvas.innerHTML = '<p class="chart-empty">Not enough data for chart</p>';
    return;
  }

  const W = 500, H = 180, PAD = 40, PADT = 10, PADR = 20;
  const scores = validPoints.map(d => d.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;

  const points = validPoints.map((d, i) => {
    const x = PAD + (i / (validPoints.length - 1)) * (W - PAD - PADR);
    const y = PADT + (1 - (d.score - minS) / range) * (H - PADT - PAD);
    return { x, y, score: d.score, date: d.date };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = pathD + ` L${points[points.length - 1].x},${H - PAD} L${points[0].x},${H - PAD} Z`;

  const yTicks = 4;
  let gridLines = '';
  let yLabels = '';
  for (let i = 0; i <= yTicks; i++) {
    const val = minS + (range * i / yTicks);
    const y = PADT + (1 - i / yTicks) * (H - PADT - PAD);
    gridLines += `<line x1="${PAD}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="rgba(168,117,255,0.12)" stroke-dasharray="3,3"/>`;
    yLabels += `<text x="${PAD - 6}" y="${y + 4}" text-anchor="end" fill="#8f819f" font-size="10">${fmtCompact(Math.round(val))}</text>`;
  }

  let xLabels = '';
  const step = Math.max(1, Math.floor(validPoints.length / 5));
  for (let i = 0; i < validPoints.length; i += step) {
    const p = points[i];
    const label = validPoints[i].date.slice(5);
    xLabels += `<text x="${p.x}" y="${H - PAD + 16}" text-anchor="middle" fill="#8f819f" font-size="10">${label}</text>`;
  }

  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#a875ff" stroke="#140b2a" stroke-width="2"/>`
  ).join('');

  canvas.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;max-height:200px">
    ${gridLines}${yLabels}${xLabels}
    <path d="${areaD}" fill="url(#chartGrad)" opacity="0.3"/>
    <path d="${pathD}" fill="none" stroke="#a875ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <defs><linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a875ff" stop-opacity="0.5"/><stop offset="100%" stop-color="#a875ff" stop-opacity="0"/></linearGradient></defs>
  </svg>`;
}

function closeModal() {
  $('#memberModal').classList.add('hidden');
  $('#memberModal').removeEventListener('click', closeModalOnBackdrop);
}

function closeModalOnBackdrop(e) {
  if (e.target === $('#memberModal')) closeModal();
}

// --- Copy report ---
function copyReport() {
  const rows = buildRows();
  const title = state.metric === 'conquest' ? 'Guild Conquest' : 'Guild War';
  const snaps = snapshots();
  const snap = snaps[latestIdx()];
  const good = rows.filter(r => r.pass);
  const attention = rows.filter(r => r.current != null && r.previous != null && !r.pass);

  let txt = `WEEKLY ${title.toUpperCase()}\n`;
  txt += `${snap?.date || ''}\n\n`;
  txt += `Improved >= 5%: ${good.length}\n`;
  txt += `Needs attention: ${attention.length}\n\n`;

  txt += rows.map(r => {
    const icon = r.status === 'good' ? '+' : r.status === 'bad' ? '-' : '?';
    const growthText = r.growth == null ? '' : ` (${(r.growth * 100).toFixed(1)}%)`;
    return `[${icon}] ${r.name}: ${fmtCompact(r.current)}${growthText}`;
  }).join('\n');

  navigator.clipboard.writeText(txt).then(() => {
    const b = $('#copyReport');
    const old = b.textContent;
    b.textContent = 'Copied!';
    setTimeout(() => b.textContent = old, 1200);
  });
}

// --- Init ---
async function init() {
  const [config, history] = await Promise.all([
    fetch('data/config.json').then(r => r.json()),
    fetch('data/history.json').then(r => r.json()),
  ]);

  state.config = config;
  state.history = history;

  if (config.guildName && config.guildName !== 'YOUR_GUILD_NAME') {
    $('#guildName').textContent = config.guildName;
    const server = config.server ? config.server.split('-').map((s,i) => i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s).join('-') : '';
    $('#guildServer').textContent = server ? '· ' + server : '';
  }

  render();
}

// --- Event listeners ---
$('#search').addEventListener('input', render);
$('#sort').addEventListener('change', render);

document.querySelector('thead').addEventListener('click', e => {
  const th = e.target.closest('[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  $('#sort').value = key;
  render();
});

$('#metricToggle').addEventListener('click', e => {
  const el = e.target.closest('[data-metric]');
  if (!el) return;
  state.metric = el.dataset.metric;
  $$('[data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === state.metric));
  render();
});

$('#copyReport').addEventListener('click', copyReport);

$('#memberRows').addEventListener('click', e => {
  const row = e.target.closest('[data-member]');
  if (row) showMemberDetail(row.dataset.member);
});

$('#modalClose').addEventListener('click', closeModal);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

const snapSel = $('#snapshotSelect');
if (snapSel) {
  snapSel.addEventListener('change', e => {
    state.selectedSnap = e.target.value;
    render();
  });
}

init().catch(err => {
  $('#sourceStatus').textContent = 'Could not load data';
  $('#lastUpdated').textContent = err.message;
  console.error(err);
});
