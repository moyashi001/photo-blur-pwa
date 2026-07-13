// 写真を縮小して中央に配置し、余白をぼかして加工するアプリのロジック

const APP_VERSION = '1.2.1';

const ASPECTS = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
// ドラッグでキャンバス外に出しすぎないよう残しておく最小の可視幅/高さ(CSS px)
const MIN_VISIBLE = 40;

const previewWrap = document.querySelector('.preview-wrap');
const previewFrame = document.getElementById('previewFrame');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toastEl = document.getElementById('toast');

const renderModeBgBtn = document.getElementById('renderModeBgBtn');
const renderModeOrigBtn = document.getElementById('renderModeOrigBtn');

const aspectSelect = document.getElementById('aspectSelect');

const blurRange = document.getElementById('blurRange');
const blurValue = document.getElementById('blurValue');

const modeMoveBtn = document.getElementById('modeMoveBtn');
const modeBrushBtn = document.getElementById('modeBrushBtn');
const brushOptions = document.getElementById('brushOptions');
const brushSizeRange = document.getElementById('brushSizeRange');
const brushSizeValue = document.getElementById('brushSizeValue');

const selectBtn = document.getElementById('selectBtn');
const saveBtn = document.getElementById('saveBtn');
const shareBtn = document.getElementById('shareBtn');
const fileInput = document.getElementById('fileInput');

// 元画像を囲む余白の割合（この分だけ縮小して中央配置する）
const FOREGROUND_SCALE = 0.82;
// 背景をぼかしたときに縁が透けないよう、あらかじめ拡大しておく倍率
const BACKGROUND_OVERSCAN = 1.15;

const state = {
  image: null,
  blur: Number(blurRange.value),
  aspect: aspectSelect.value,
  renderMode: 'background', // 'background'(縮小+背景ぼかし) | 'original'(原寸+部分ぼかし)
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  mode: 'move', // 'move' | 'brush'
  brushSize: Number(brushSizeRange.value),
};

let toastTimer = null;
let layoutRaf = null;

// ---- 画像選択 ----

selectBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) loadImageFile(file);
  fileInput.value = '';
});

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    state.image = img;
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    previewFrame.classList.add('has-image');
    saveBtn.disabled = false;
    shareBtn.disabled = false;
    resizeCanvas();
    draw();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('画像を読み込めませんでした');
  };
  img.src = url;
}

// ---- ぼかしモード切り替え（背景ぼかしモード / 元画像ぼかしモード） ----

function setRenderMode(mode) {
  state.renderMode = mode;
  renderModeBgBtn.classList.toggle('active', mode === 'background');
  renderModeOrigBtn.classList.toggle('active', mode === 'original');
  state.offsetX = 0;
  state.offsetY = 0;
  state.scale = 1;

  // なぞりぼかし(ぼかしペン)は元画像ぼかしモードでのみ使用できる
  modeBrushBtn.disabled = mode === 'background';
  if (mode === 'background' && state.mode === 'brush') setMode('move');

  draw();
}

renderModeBgBtn.addEventListener('click', () => setRenderMode('background'));
renderModeOrigBtn.addEventListener('click', () => setRenderMode('original'));

// ---- アスペクト比選択 ----

aspectSelect.addEventListener('change', () => {
  state.aspect = aspectSelect.value;
  state.offsetX = 0;
  state.offsetY = 0;
  layoutPreviewFrame();
  resizeCanvas();
  draw();
});

// ---- ぼかし強度スライダー ----

blurRange.addEventListener('input', () => {
  state.blur = Number(blurRange.value);
  blurValue.textContent = `${state.blur}px`;
  draw();
});

// ---- 操作モード切り替え（移動・拡大縮小 / ぼかしペン） ----

function setMode(mode) {
  state.mode = mode;
  modeMoveBtn.classList.toggle('active', mode === 'move');
  modeBrushBtn.classList.toggle('active', mode === 'brush');
  brushOptions.hidden = mode !== 'brush';
}

modeMoveBtn.addEventListener('click', () => setMode('move'));
modeBrushBtn.addEventListener('click', () => setMode('brush'));

brushSizeRange.addEventListener('input', () => {
  state.brushSize = Number(brushSizeRange.value);
  brushSizeValue.textContent = `${state.brushSize}px`;
});

// ---- プレビュー枠のサイズ計算（選択中のアスペクト比で最大に収まるサイズにする） ----

function layoutPreviewFrame() {
  const wrapRect = previewWrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(previewWrap);
  const padX = parseFloat(wrapStyle.paddingLeft) + parseFloat(wrapStyle.paddingRight);
  const padY = parseFloat(wrapStyle.paddingTop) + parseFloat(wrapStyle.paddingBottom);
  const availW = Math.max(1, wrapRect.width - padX);
  const availH = Math.max(1, wrapRect.height - padY);

  const ratio = ASPECTS[state.aspect] || 1;
  let frameW = availW;
  let frameH = frameW / ratio;
  if (frameH > availH) {
    frameH = availH;
    frameW = frameH * ratio;
  }
  previewFrame.style.width = `${frameW}px`;
  previewFrame.style.height = `${frameH}px`;
}

// ---- Canvasのリサイズ ----

function resizeCanvas() {
  const rect = previewFrame.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const resizeObserver = new ResizeObserver(() => {
  if (layoutRaf) cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    layoutPreviewFrame();
    resizeCanvas();
    draw();
  });
});
resizeObserver.observe(previewWrap);

// ---- 描画 ----

function draw() {
  const img = state.image;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);
  if (!img) return;

  if (state.renderMode === 'original') {
    drawOriginalImage(img, w, h);
  } else {
    drawBlurredBackground(img, w, h);
    drawForeground(img, w, h);
  }
}

function drawBlurredBackground(img, w, h) {
  const coverScale = Math.max(w / img.width, h / img.height) * BACKGROUND_OVERSCAN;
  const dw = img.width * coverScale;
  const dh = img.height * coverScale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  // ctx.filter の blur() は Safari/一部ブラウザで効かないことがあるため、
  // 縮小してから拡大描画する方式でぼかしを再現する（blur=0なら等倍で描画）
  const factor = 1 + state.blur * 0.9;
  const smallW = Math.max(2, Math.round(w / factor));
  const smallH = Math.max(2, Math.round(h / factor));

  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  sctx.drawImage(img, dx / factor, dy / factor, dw / factor, dh / factor);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, smallW, smallH, 0, 0, w, h);
  ctx.restore();
}

function clampNum(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function drawForeground(img, w, h) {
  const containScale = Math.min(w / img.width, h / img.height) * FOREGROUND_SCALE * state.scale;
  const dw = img.width * containScale;
  const dh = img.height * containScale;

  // ドラッグ量をクランプし、画像が完全にキャンバス外へ出てしまわないようにする
  const maxOffsetX = Math.max(0, (w + dw) / 2 - MIN_VISIBLE);
  const maxOffsetY = Math.max(0, (h + dh) / 2 - MIN_VISIBLE);
  state.offsetX = clampNum(state.offsetX, -maxOffsetX, maxOffsetX);
  state.offsetY = clampNum(state.offsetY, -maxOffsetY, maxOffsetY);

  const dx = (w - dw) / 2 + state.offsetX;
  const dy = (h - dh) / 2 + state.offsetY;
  const radius = Math.min(dw, dh) * 0.05;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, dx, dy, dw, dh, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, dx, dy, dw, dh, radius);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawOriginalImage(img, w, h) {
  // 元画像ぼかしモード：トリミングや背景ぼかしは使わず、まず画像全体がキャンバスに収まる
  // 最大サイズ(contain-fit)で表示する。そこからピンチでさらに拡大縮小できる
  const fitScale = Math.min(w / img.width, h / img.height);
  const dw = img.width * fitScale * state.scale;
  const dh = img.height * fitScale * state.scale;

  const maxOffsetX = Math.max(0, (w + dw) / 2 - MIN_VISIBLE);
  const maxOffsetY = Math.max(0, (h + dh) / 2 - MIN_VISIBLE);
  state.offsetX = clampNum(state.offsetX, -maxOffsetX, maxOffsetX);
  state.offsetY = clampNum(state.offsetY, -maxOffsetY, maxOffsetY);

  const dx = (w - dw) / 2 + state.offsetX;
  const dy = (h - dh) / 2 + state.offsetY;

  ctx.drawImage(img, dx, dy, dw, dh);
}

function roundRectPath(context, x, y, w, h, r) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// ---- 画像のドラッグ移動 / ピンチ拡大縮小 ----

let dragStart = null;
let pinchStart = null;
let mouseMode = null; // null | 'move' | 'brush'（デスクトップでの動作確認用）

function getCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

canvas.addEventListener('touchstart', (e) => {
  if (!state.image) return;
  e.preventDefault();

  if (state.mode === 'brush') {
    const t = e.touches[0];
    queueBrushPoint(getCanvasPos(t.clientX, t.clientY));
    return;
  }

  if (e.touches.length === 2) {
    pinchStart = { dist: touchDistance(e.touches), scale: state.scale };
    dragStart = null;
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    dragStart = { x: t.clientX, y: t.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
    pinchStart = null;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.image) return;
  e.preventDefault();

  if (state.mode === 'brush') {
    const t = e.touches[0];
    queueBrushPoint(getCanvasPos(t.clientX, t.clientY));
    return;
  }

  if (e.touches.length === 2 && pinchStart) {
    const dist = touchDistance(e.touches);
    state.scale = clampNum(pinchStart.scale * (dist / pinchStart.dist), MIN_SCALE, MAX_SCALE);
    draw();
  } else if (e.touches.length === 1 && dragStart) {
    const t = e.touches[0];
    state.offsetX = dragStart.offsetX + (t.clientX - dragStart.x);
    state.offsetY = dragStart.offsetY + (t.clientY - dragStart.y);
    draw();
  }
}, { passive: false });

function onTouchEnd(e) {
  if (e.touches.length === 0) {
    dragStart = null;
    pinchStart = null;
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    dragStart = { x: t.clientX, y: t.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
    pinchStart = null;
  }
}
canvas.addEventListener('touchend', onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

// マウス操作（デスクトップでの動作確認用。ピンチ操作は非対応）
canvas.addEventListener('mousedown', (e) => {
  if (!state.image) return;
  if (state.mode === 'brush') {
    mouseMode = 'brush';
    queueBrushPoint(getCanvasPos(e.clientX, e.clientY));
    return;
  }
  mouseMode = 'move';
  dragStart = { x: e.clientX, y: e.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
});

window.addEventListener('mousemove', (e) => {
  if (!mouseMode) return;
  if (mouseMode === 'brush') {
    queueBrushPoint(getCanvasPos(e.clientX, e.clientY));
    return;
  }
  if (dragStart) {
    state.offsetX = dragStart.offsetX + (e.clientX - dragStart.x);
    state.offsetY = dragStart.offsetY + (e.clientY - dragStart.y);
    draw();
  }
});

window.addEventListener('mouseup', () => {
  mouseMode = null;
  dragStart = null;
});

// ---- なぞった部分をぼかす（ブラシぼかし） ----

let pendingBrushPoint = null;
let brushRaf = null;

function queueBrushPoint(pos) {
  pendingBrushPoint = pos;
  if (brushRaf) return;
  brushRaf = requestAnimationFrame(() => {
    brushRaf = null;
    if (pendingBrushPoint) applyBrushBlurAt(pendingBrushPoint.x, pendingBrushPoint.y);
  });
}

function applyBrushBlurAt(cssX, cssY) {
  const dpr = window.devicePixelRatio || 1;
  const r = Math.max(4, Math.round(state.brushSize * dpr));
  const cx = Math.round(cssX * dpr);
  const cy = Math.round(cssY * dpr);

  const x0 = clampNum(cx - r, 0, canvas.width);
  const y0 = clampNum(cy - r, 0, canvas.height);
  const x1 = clampNum(cx + r, 0, canvas.width);
  const y1 = clampNum(cy + r, 0, canvas.height);
  const w = Math.round(x1 - x0);
  const h = Math.round(y1 - y0);
  if (w <= 0 || h <= 0) return;

  // この範囲だけを縮小→拡大してぼかし版を作る（既存の「ぼかし強度」スライダーの値を強さとして利用）
  const strength = clampNum(state.blur, 4, 40);
  const factor = 1 + strength * 0.5;
  const smallW = Math.max(2, Math.round(w / factor));
  const smallH = Math.max(2, Math.round(h / factor));
  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  small.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, smallW, smallH);

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = w;
  blurCanvas.height = h;
  const bctx = blurCanvas.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in bctx) bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, smallW, smallH, 0, 0, w, h);

  // getImageDataで元領域とぼかし版を取得し、円形にフェザリングしながら合成してputImageDataで書き戻す
  const region = ctx.getImageData(x0, y0, w, h);
  const blurredData = bctx.getImageData(0, 0, w, h).data;
  const src = region.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ddx = (x0 + x) - cx;
      const ddy = (y0 + y) - cy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const t = clampNum(1 - (dist - r * 0.6) / (r * 0.4), 0, 1);
      if (t <= 0) continue;
      const i = (y * w + x) * 4;
      src[i] = src[i] * (1 - t) + blurredData[i] * t;
      src[i + 1] = src[i + 1] * (1 - t) + blurredData[i + 1] * t;
      src[i + 2] = src[i + 2] * (1 - t) + blurredData[i + 2] * t;
      src[i + 3] = src[i + 3] * (1 - t) + blurredData[i + 3] * t;
    }
  }
  ctx.putImageData(region, x0, y0);
}

// ---- 保存 ----

saveBtn.addEventListener('click', () => {
  if (!state.image) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('保存に失敗しました');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blurframe-${timestamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('保存しました');
  }, 'image/png');
});

// ---- 共有 ----

shareBtn.addEventListener('click', () => {
  if (!state.image) return;
  canvas.toBlob(async (blob) => {
    if (!blob) {
      showToast('共有に失敗しました');
      return;
    }
    const file = new File([blob], `blurframe-${timestamp()}.png`, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'BlurFrame' });
        showToast('共有しました');
      } catch (err) {
        if (err && err.name !== 'AbortError') showToast('共有に失敗しました');
      }
    } else {
      showToast('この端末は共有に対応していません');
    }
  }, 'image/png');
});

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---- トースト ----

function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 200);
  }, 1500);
}

// ---- Service Worker 登録 ----

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// 初期化
document.getElementById('appVersion').textContent = `v${APP_VERSION}`;
modeBrushBtn.disabled = state.renderMode === 'background';
layoutPreviewFrame();
resizeCanvas();
