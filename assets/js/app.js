/**
 * 图片元数据清除器 —— 主逻辑
 *
 * 流水线：读取文件 → scanMetadata 扫描 → createImageBitmap 解码 →
 * Canvas 重编码（EXIF/XMP/IPTC 等元数据天然不被带入）→ toBlob 输出 →
 * 再次扫描自检（结果应为空）→ 本地下载 / ZIP 打包。
 * 全部在浏览器内完成，没有任何网络请求。
 */

import { startWaveBackground } from './wave-bg.js';
import { scanMetadata } from './metadata-scan.js';
import { stripFileMeta } from './strip.js';
import { createLogBus, formatLine } from './log.js';
import { revealAll } from './reveal.js?v=3';
import { createZip } from './zip-writer.js';
import { t, applyI18n, getLang, setLang, detectLang } from './i18n.js';

const MAX_CANVAS_PIXELS = 268_000_000; // 主流浏览器画布面积上限（约 2^28 像素）
const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/gif', 'image/avif'];
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const state = {
  quality: 0.92,
  format: 'auto',       // auto | image/jpeg | image/png
  suffix: 'keep',       // keep | clean
  items: [],            // {id, file, name, base, size, status, meta, out, error, el}
  processing: false,
};

/** 处理日志总线（终端窗口的数据源） */
const logBus = createLogBus();

let seq = 0;

// ---------------------------------------------------------------- 工具

const $ = (sel) => document.querySelector(sel);

function fmtBytes(n) {
  if (n === undefined || n === null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtSigned(n) {
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${fmtBytes(Math.abs(n))}`;
}

function toast(key, vars) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = t(key, vars);
  box.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

// ---------------------------------------------------------------- 文件入队

function isAcceptable(file) {
  if (file.type && file.type.startsWith('image/') && file.type !== 'image/svg+xml') return true;
  return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'].includes(extOf(file.name));
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let skipped = 0;

  for (const file of files) {
    if (!isAcceptable(file)) { skipped++; continue; }
    const dup = state.items.find((it) => it.file === file || (it.name === file.name && it.size === file.size));
    if (dup) { logBus.warn('skip duplicate', file.name); continue; }

    const item = {
      id: ++seq,
      file,
      name: file.name,
      base: file.name.replace(/\.[a-z0-9]+$/i, ''),
      size: file.size,
      status: 'queued',
      meta: null,
      out: null,
      error: null,
      el: null,
      thumbUrl: URL.createObjectURL(file),
    };
    state.items.push(item);
    logBus.cmd('open', `${file.name} · ${fmtBytes(file.size)}`);
    void scanItem(item); // 入队即扫描，先把“将移除什么”摆出来
  }

  if (skipped) toast('toast.unsupported', { n: skipped });
  renderList();
  updateButtons();
}

/** 扫描单个文件的元数据（轻量、同步、只读） */
async function scanItem(item) {
  try {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    item.meta = scanMetadata(bytes, item.file.type);
    const metas = item.meta.items;
    if (metas.length) {
      logBus.info('scan', `${item.name} → ${item.meta.container} · ${metas.length} segments`);
      for (const m of metas) {
        logBus.info(`  ${m.type}`, m.detail || (m.size ? `${fmtBytes(m.size)}` : undefined));
      }
    } else {
      logBus.ok('scan', `${item.name} → clean (no metadata)`);
    }
  } catch {
    item.meta = { container: 'unknown', items: [], totalMetaBytes: 0, hasGPS: false };
    logBus.err('scan failed', item.name);
  }
  if (item.el) renderRow(item);
  updateSummary();
}

// ---------------------------------------------------------------- 解码与重编码

/** 优先 createImageBitmap（顺带烘焙 EXIF 方向），失败回退 <img> 路径 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* 老浏览器不支持参数时走回退 */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** Canvas 重编码：这一步就是“清除”——新文件只含像素，不含任何元数据 */
async function encodeCanvas(bitmap, mime, quality) {
  const w = bitmap.width;
  const h = bitmap.height;
  if (!w || !h) throw new Error('decode');
  if (w * h > MAX_CANVAS_PIXELS) throw new Error('tooLarge');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (mime === 'image/jpeg') { // JPEG 不支持透明，先铺白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), mime, quality);
  });
  return { blob, w, h };
}

function pickOutputMime(fileType, target) {
  if (target === 'image/jpeg' || target === 'image/png') return target;
  if (fileType === 'image/jpeg') return 'image/jpeg';
  if (fileType === 'image/png') return 'image/png';
  if (fileType === 'image/webp') return 'image/webp';
  return 'image/png'; // BMP / GIF / AVIF → 无损 PNG
}

function outName(item, mime) {
  const ext = EXT_BY_MIME[mime] || 'png';
  const suffix = state.suffix === 'clean' ? '_clean' : '';
  return `${item.base}${suffix}.${ext}`;
}

async function cleanItem(item) {
  item.status = 'cleaning';
  item.error = null;
  renderRow(item);
  logBus.cmd('clean', item.name);
  try {
    const bitmap = await decodeImage(item.file);
    logBus.info('decode', `${bitmap.width}×${bitmap.height} · EXIF orientation baked in`);
    const wantMime = pickOutputMime(item.file.type, state.format);
    const { blob, w, h } = await encodeCanvas(bitmap, wantMime, state.quality);
    logBus.info('encode', `${wantMime} q=${state.quality.toFixed(2)} → ${fmtBytes(blob.size)}`);
    // 个别浏览器（如 Safari）的编码器会自行写回 ICC 等段，这里二次物理拆除
    const mime = blob.type || wantMime;
    const stripped = stripFileMeta(new Uint8Array(await blob.arrayBuffer()), mime);
    logBus.info('strip', `${fmtBytes(blob.size)} → ${fmtBytes(stripped.length)} · ${mime}`);
    const outBlob = new Blob([stripped], { type: mime });
    const afterScan = scanMetadata(stripped, mime); // 自检：应为空
    if (afterScan.items.length) logBus.warn('verify', `${afterScan.items.length} metadata segment(s) left`);
    else logBus.ok('verify', '0 metadata segments left');

    if (item.out?.url) URL.revokeObjectURL(item.out.url);
    item.out = {
      blob: outBlob,
      url: URL.createObjectURL(outBlob),
      size: outBlob.size,
      w,
      h,
      mime,
      name: outName(item, mime),
      leftover: afterScan.items.length, // >0 说明还有残留（理论上为 0）
    };
    item.status = 'done';
    logBus.ok('done', `${item.out.name} · ${fmtBytes(item.out.size)}`);
  } catch (err) {
    item.status = 'error';
    item.error = err && err.message === 'tooLarge' ? 'tooLarge' : 'decode';
    logBus.err('failed', `${item.name} — ${item.error === 'tooLarge' ? 'canvas size limit' : 'decode error'}`);
  }
  renderRow(item);
  updateButtons();
  updateSummary();
}

async function cleanAll() {
  if (state.processing) return;
  const targets = state.items.filter((it) => it.status !== 'done');
  const queue = targets.length ? targets : state.items;
  if (!queue.length) return;

  state.processing = true;
  updateButtons();
  let done = 0;
  for (const item of queue) {
    // 让出主线程，保持进度条和按钮的响应
    await new Promise((r) => setTimeout(r, 0));
    await cleanItem(item);
    if (item.status === 'done') done++;
    updateProgress(++done, queue.length);
  }
  state.processing = false;
  updateProgress(queue.length, queue.length, true);
  updateButtons();
  if (done) {
    const segments = queue.reduce((s, it) => s + (it.status === 'done' ? (it.meta?.items?.length || 0) : 0), 0);
    toast('toast.cleaned', { n: done, m: segments });
  }
}

// ---------------------------------------------------------------- 渲染

/** 元数据芯片的说明文字：优先原始 detail（相机型号/GPS 坐标/keyword 等），否则退化为体积 */
function chipDetail(m) {
  if (m.detail) return m.detail;
  if (m.size) return fmtBytes(m.size);
  return '';
}

function metaChips(item) {
  const metas = item.meta?.items || [];
  if (item.status === 'done') {
    // 已完成：逐项展示“清掉了什么”——类别 + 具体内容（相机型号、GPS 坐标、体积等）
    const kinds = [...new Set((item.meta?.items || []).map((m) => m.type))];
    if (!kinds.length) return `<span class="chip chip-ok">✓ ${t('meta.none')}</span>`;
    if (item.out?.leftover) kinds.push('leftover');
    return kinds
      .map((k) => {
        const label = t(`meta.${k}`) || k;
        const detail = k === 'leftover' ? '' : chipDetail(metas.find((m) => m.type === k) || {});
        return `<span class="chip chip-ok" title="${detail.replace(/"/g, '&quot;')}">✓ ${label}${detail ? ` · ${detail}` : ''}</span>`;
      })
      .join('');
  }
  if (!metas.length) return `<span class="chip chip-quiet">${t('meta.none')}</span>`;
  const seen = new Set();
  return metas
    .filter((m) => (seen.has(m.type) ? false : (seen.add(m.type), true)))
    .map((m) => {
      const cls = m.type === 'exif-gps' || m.type === 'trailing' ? 'chip chip-danger' : 'chip';
      const label = t(`meta.${m.type}`) || m.type;
      const detail = chipDetail(m);
      return `<span class="${cls}" title="${detail.replace(/"/g, '&quot;')}">${label}${detail ? ` · ${detail}` : ''}</span>`;
    })
    .join('');
}

function statusLabel(item) {
  if (item.status === 'cleaning') return t('status.cleaning');
  if (item.status === 'error') return t('status.error');
  if (item.status === 'done') return t('status.done');
  return t('status.queued');
}

function rowHtml(item, index) {
  const dims = item.out ? `${item.out.w}×${item.out.h}` : '';
  const metaInfo = dims ? `${fmtBytes(item.size)} → ${fmtBytes(item.out.size)}（${dims}）` : fmtBytes(item.size);
  return `
    <img class="row-thumb" src="${item.thumbUrl}" alt="" loading="lazy" />
    <div class="row-main">
      <div class="row-name" title="${item.name.replace(/"/g, '&quot;')}">${item.name}</div>
      <div class="row-sub">
        <span>${metaInfo}</span>
        ${item.status === 'error' ? `<span class="row-err">${t(item.error === 'tooLarge' ? 'error.tooLarge' : 'toast.decoded', { name: item.name })}</span>` : ''}
      </div>
      ${item.status === 'done' && item.meta?.items?.length ? `<div class="row-removed">${t('row.removed', { n: item.meta.items.length, size: fmtBytes(item.meta.totalMetaBytes) })}</div>` : ''}
      <div class="row-chips">${metaChips(item)}</div>
    </div>
    <div class="row-side">
      <span class="row-status st-${item.status}">${statusLabel(item)}</span>
      <span class="row-actions">
        ${item.status === 'done' ? `<a class="btn-icon" href="${item.out.url}" download="${item.out.name}" title="${t('action.downloadOne')}">↓ ${t('action.downloadOne')}</a>` : ''}
        ${item.status === 'error' || item.status === 'queued' ? `<button class="btn-icon" data-act="retry" title="${t('action.retry')}">↻</button>` : ''}
        <button class="btn-icon" data-act="remove" title="${t('action.remove')}">✕</button>
      </span>
    </div>`;
}

function renderRow(item) {
  if (!item.el) return;
  item.el.innerHTML = rowHtml(item);
}

/** 已播过入场动画的 item id——重新渲染时不再重放 */
const revealed = new Set();

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  state.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    li.innerHTML = rowHtml(item, i);
    if (!revealed.has(item.id)) {
      revealed.add(item.id);
      li.setAttribute('data-reveal', '');
      li.style.transitionDelay = `${Math.min(i * 45, 270)}ms`; // 错峰入场，最多 270ms
    }
    item.el = li;
    list.appendChild(li);
  });
  $('#listEmpty').hidden = state.items.length > 0;
  $('#listCount').textContent = state.items.length ? String(state.items.length) : '';
  revealAll(list); // 观察新入队的行
  updateSummary();
}

/** 列表事件（下载/重试/移除在行内） */
$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('.row');
  if (!li) return;
  const item = state.items.find((it) => it.el === li);
  if (!item) return;
  const act = e.target.dataset.act;
  if (act === 'retry') cleanItem(item);
  else if (act === 'remove') removeItem(item);
});

function removeItem(item) {
  if (item.out?.url) URL.revokeObjectURL(item.out.url);
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  state.items = state.items.filter((it) => it !== item);
  renderList();
  updateButtons();
  updateSummary();
}

function clearAll() {
  for (const item of state.items) {
    if (item.out?.url) URL.revokeObjectURL(item.out.url);
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  }
  logBus.cmd('clear', `${state.items.length} files removed from queue`);
  state.items = [];
  revealed.clear();
  renderList();
  updateButtons();
  toast('toast.cleared');
}

// ---------------------------------------------------------------- 汇总与按钮

/** 选项变化后，已完成的项回到待处理（新质量/格式/命名需要重跑） */
function requeueDone() {
  let changed = false;
  for (const item of state.items) {
    if (item.status === 'done') {
      item.status = 'queued';
      if (item.out?.url) URL.revokeObjectURL(item.out.url);
      item.out = null;
      changed = true;
    }
  }
  if (changed) {
    renderList();
    updateButtons();
    updateSummary();
  }
}

function updateProgress(done, total, final = false) {
  const wrap = $('#progressWrap');
  const bar = $('#progressBar');
  const text = $('#progressText');
  wrap.hidden = total === 0;
  if (!total) return;
  const pct = Math.round((done / total) * 100);
  bar.style.width = `${pct}%`;
  text.textContent = `${done}/${total}`;
  if (final) {
    setTimeout(() => { wrap.hidden = true; bar.style.width = '0%'; }, 900);
  }
}

function updateButtons() {
  const queued = state.items.filter((it) => it.status !== 'done').length;
  const cleaned = state.items.filter((it) => it.status === 'done').length;
  const cleanBtn = $('#cleanBtn');
  const zipBtn = $('#zipBtn');
  const clearBtn = $('#clearBtn');
  cleanBtn.disabled = state.processing || state.items.length === 0;
  cleanBtn.textContent = state.processing
    ? t('action.cleaning')
    : `${t('action.clean')}${queued ? ` (${queued})` : ''}`;
  zipBtn.disabled = cleaned === 0;
  zipBtn.textContent = `${t('action.downloadAll')}${cleaned ? ` (${cleaned})` : ''}`;
  clearBtn.disabled = state.items.length === 0;
}

function updateSummary() {
  const box = $('#summary');
  const done = state.items.filter((it) => it.status === 'done');
  if (!done.length) { box.hidden = true; return; }
  let before = 0;
  let after = 0;
  let metas = 0;
  for (const it of done) {
    before += it.size;
    after += it.out.size;
    metas += (it.meta?.items || []).length;
  }
  $('#sumFiles').textContent = String(done.length);
  $('#sumMeta').textContent = String(metas);
  $('#sumSize').textContent = fmtSigned(after - before);
  box.hidden = false;
  revealAll(box); // 汇总卡出现时入场
}

// ---------------------------------------------------------------- 下载

async function downloadZip() {
  const done = state.items.filter((it) => it.status === 'done');
  if (!done.length) return;
  try {
    const entries = [];
    const used = new Set();
    for (const it of done) {
      let name = it.out.name;
      let n = 1;
      while (used.has(name)) name = it.out.name.replace(/(\.[a-z0-9]+)$/i, `-${++n}$1`);
      used.add(name);
      entries.push({ name, data: new Uint8Array(await it.out.blob.arrayBuffer()) });
    }
    logBus.cmd('zip', `${entries.length} files`);
    const blob = await createZip(entries);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cleaned-images-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    logBus.ok('zip saved', `${a.download} · ${fmtBytes(blob.size)}`);
    toast('toast.zipDownloaded', { n: done.length });
  } catch {
    logBus.err('zip failed');
    toast('toast.zipFailed');
  }
}

// ---------------------------------------------------------------- 拖拽 / 粘贴 / 文件夹

/** 递归读取拖入的目录项 */
async function readEntries(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    for (;;) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const child of batch) all.push(...(await readEntries(child)).filter(Boolean));
    }
    return all;
  }
  return [];
}

function hasEntrySupport(dt) {
  return dt && Array.from(dt.items || []).some((it) => typeof it.webkitGetAsEntry === 'function' && it.webkitGetAsEntry());
}

function bindDropzone() {
  const zone = $('#dropzone');
  const input = $('#fileInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return; zone.classList.remove('drag'); })
  );
  zone.addEventListener('drop', async (e) => {
    if (hasEntrySupport(e.dataTransfer)) {
      const entries = Array.from(e.dataTransfer.items)
        .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
        .filter(Boolean);
      const files = [];
      for (const entry of entries) files.push(...(await readEntries(entry)));
      addFiles(files);
    } else {
      addFiles(e.dataTransfer.files);
    }
  });

  document.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) addFiles(files);
  });
}

// ---------------------------------------------------------------- 设置持久化

// ---------------------------------------------------------------- 选项持久化

function bindOptions() {
  const quality = $('#optQuality');
  const val = $('#optQualityVal');
  const fmt = $('#optFormat');
  const suffix = $('#optSuffix');

  try {
    const saved = JSON.parse(localStorage.getItem('imc-options') || '{}');
    if (typeof saved.quality === 'number') state.quality = saved.quality;
    if (saved.format) state.format = saved.format;
    if (saved.suffix) state.suffix = saved.suffix;
  } catch { /* ignore */ }

  quality.value = String(state.quality);
  val.textContent = state.quality.toFixed(2);
  fmt.value = state.format;
  suffix.value = state.suffix;

  quality.addEventListener('input', () => {
    state.quality = Number(quality.value);
    val.textContent = state.quality.toFixed(2);
    persistOptions();
    requeueDone();
  });
  fmt.addEventListener('change', () => { state.format = fmt.value; persistOptions(); requeueDone(); });
  suffix.addEventListener('change', () => { state.suffix = suffix.value; persistOptions(); requeueDone(); });

  function persistOptions() {
    try {
      localStorage.setItem('imc-options', JSON.stringify({ quality: state.quality, format: state.format, suffix: state.suffix }));
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 终端日志窗口

function bindConsole() {
  const body = $('#logBody');
  const empty = $('#logEmpty');
  const count = $('#logCount');
  const clearBtn = $('#logClear');
  const toggleBtn = $('#logToggle');
  const panel = $('#logPanel');

  logBus.subscribe((line, lines) => {
    if (line) {
      const div = document.createElement('div');
      div.className = `log-line log-lv-${line.level}`;
      div.textContent = formatLine(line);
      body.appendChild(div);
    } else {
      body.querySelectorAll('.log-line').forEach((el) => el.remove());
    }
    // DOM 行数跟随环形缓冲裁剪
    while (body.querySelectorAll('.log-line').length > lines.length) {
      body.querySelector('.log-line')?.remove();
    }
    count.textContent = String(lines.length);
    empty.hidden = lines.length > 0;
    // 用户停在底部附近才自动滚动，方便回看历史
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    if (nearBottom) body.scrollTop = body.scrollHeight;
  });

  clearBtn.addEventListener('click', () => logBus.clear());
  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    body.hidden = collapsed;
    toggleBtn.textContent = collapsed ? t('log.expand') : t('log.collapse');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });
  toggleBtn.textContent = t('log.collapse');
}

function refreshConsoleLabels() {
  const panel = $('#logPanel');
  const toggleBtn = $('#logToggle');
  if (panel && toggleBtn) toggleBtn.textContent = panel.classList.contains('collapsed') ? t('log.expand') : t('log.collapse');
}

// ---------------------------------------------------------------- 启动

function boot() {
  setLang(detectLang());
  applyI18n();
  startWaveBackground($('#bgCanvas'));
  bindDropzone();
  bindOptions();
  bindConsole();
  bindActions();
  refreshLangButton();
  updateButtons();
  revealAll(); // 扫描页面内所有卡片的入场动画
}

function bindActions() {
  $('#cleanBtn').addEventListener('click', cleanAll);
  $('#zipBtn').addEventListener('click', downloadZip);
  $('#clearBtn').addEventListener('click', clearAll);
  $('#langBtn').addEventListener('click', () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    applyI18n();
    renderList();
    updateButtons();
    refreshConsoleLabels();
    refreshLangButton();
  });
}

function refreshLangButton() {
  const btn = $('#langBtn');
  btn.textContent = getLang() === 'zh' ? 'EN' : '中文';
  btn.title = getLang() === 'zh' ? 'Switch to English' : '切换到中文';
}

boot();
