// 写真を縮小して中央に配置し、余白をぼかして加工するアプリのロジック

const APP_VERSION = '1.4.0';
const APP_NAME = '写真ぼかしスタジオ';
const FILE_PREFIX = 'photo-blur-studio';

// SNSシェア用
const APP_SHARE_URL = 'https://photo-blur-pwa.vercel.app/';
const SHARE_MESSAGE = 'このアプリで写真をぼかしました！';

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
const brushTypeBlurBtn = document.getElementById('brushTypeBlurBtn');
const brushTypeEraseBtn = document.getElementById('brushTypeEraseBtn');

const selectBtn = document.getElementById('selectBtn');
const saveBtn = document.getElementById('saveBtn');
const shareBtn = document.getElementById('shareBtn');
const fileInput = document.getElementById('fileInput');

const shareModalOverlay = document.getElementById('shareModalOverlay');
const shareModalCloseBtn = document.getElementById('shareModalCloseBtn');
const shareButtons = document.querySelectorAll('.share-btn');

// 元画像を囲む余白の割合（この分だけ縮小して中央配置する）
const FOREGROUND_SCALE = 0.82;
// 背景をぼかしたときに縁が透けないよう、あらかじめ拡大しておく倍率
const BACKGROUND_OVERSCAN = 1.15;

const state = {
  image: null,
  blur: Number(blurRange.value),
  aspect: aspectSelect.value,
  renderMode: 'original', // 'original'(画像ぼかしモード：等倍fit+部分ぼかし) | 'background'(背景ぼかしモード：縮小+背景ぼかし)
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  mode: 'move', // 'move' | 'brush'
  brushSize: Number(brushSizeRange.value),
  brushMode: 'blur', // 'blur'(なぞりぼかし) | 'erase'(消しゴムブラシ)
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

// ---- ぼかしモード切り替え（画像ぼかしモード / 背景ぼかしモード） ----

function setRenderMode(mode) {
  state.renderMode = mode;
  renderModeBgBtn.classList.toggle('active', mode === 'background');
  renderModeOrigBtn.classList.toggle('active', mode === 'original');
  state.offsetX = 0;
  state.offsetY = 0;
  state.scale = 1;
  // ぼかしペン(ぼかしブラシ/消しゴムブラシ)はどちらのモードでも使用できる

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

// ---- ブラシ種類切り替え（ぼかしブラシ / 消しゴムブラシ） ----

function setBrushType(type) {
  state.brushMode = type;
  brushTypeBlurBtn.classList.toggle('active', type === 'blur');
  brushTypeEraseBtn.classList.toggle('active', type === 'erase');
}

brushTypeBlurBtn.addEventListener('click', () => setBrushType('blur'));
brushTypeEraseBtn.addEventListener('click', () => setBrushType('erase'));

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

  renderScene(ctx, img, w, h);
}

// 現在のstate(モード・ぼかし強度・パン/ズーム)に基づいて1コマ描画する。
// 消しゴムブラシがブラシ編集を含まない「まっさらな状態」を作るためにも同じ関数を使う
function renderScene(targetCtx, img, w, h) {
  if (state.renderMode === 'original') {
    drawOriginalImage(targetCtx, img, w, h);
  } else {
    drawBlurredBackground(targetCtx, img, w, h);
    drawForeground(targetCtx, img, w, h);
  }
}

function drawBlurredBackground(targetCtx, img, w, h) {
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

  targetCtx.save();
  targetCtx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in targetCtx) targetCtx.imageSmoothingQuality = 'high';
  targetCtx.drawImage(small, 0, 0, smallW, smallH, 0, 0, w, h);
  targetCtx.restore();
}

function clampNum(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function drawForeground(targetCtx, img, w, h) {
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

  targetCtx.save();
  targetCtx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  targetCtx.shadowBlur = 16;
  targetCtx.shadowOffsetY = 6;
  targetCtx.fillStyle = '#fff';
  roundRectPath(targetCtx, dx, dy, dw, dh, radius);
  targetCtx.fill();
  targetCtx.restore();

  targetCtx.save();
  roundRectPath(targetCtx, dx, dy, dw, dh, radius);
  targetCtx.clip();
  targetCtx.drawImage(img, dx, dy, dw, dh);
  targetCtx.restore();
}

function drawOriginalImage(targetCtx, img, w, h) {
  // 画像ぼかしモード：トリミングや背景ぼかしは使わず、まず画像全体がキャンバスに収まる
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

  targetCtx.drawImage(img, dx, dy, dw, dh);
}

// ブラシ編集を含まない、現在のstateだけに基づく「まっさらな」参照フレームを生成する。
// 消しゴムブラシはここからピクセルを復元することで、パン/ズーム/モードが何であっても
// 正しい位置のピクセルに戻せる
function renderCleanFrame() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  const clean = document.createElement('canvas');
  clean.width = canvas.width;
  clean.height = canvas.height;
  const cleanCtx = clean.getContext('2d');
  cleanCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  renderScene(cleanCtx, state.image, w, h);
  return clean;
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
    if (!pendingBrushPoint) return;
    if (state.brushMode === 'erase') {
      applyEraseBrushAt(pendingBrushPoint.x, pendingBrushPoint.y);
    } else {
      applyBrushBlurAt(pendingBrushPoint.x, pendingBrushPoint.y);
    }
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

// ---- なぞった部分のぼかしを消す（消しゴムブラシ） ----

function applyEraseBrushAt(cssX, cssY) {
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

  // ブラシ編集前の状態を再描画し、そこから該当範囲のピクセルを取り出す
  // (パン・ズーム・アスペクト比・モードが何であっても正しい位置の元ピクセルになる)
  const clean = renderCleanFrame();
  const cleanData = clean.getContext('2d').getImageData(x0, y0, w, h).data;

  // getImageDataで現在のピクセルを取得し、円形にフェザリングしながら元の状態と
  // 合成してputImageDataで書き戻す（ぼかしブラシと同じ合成方法）
  const region = ctx.getImageData(x0, y0, w, h);
  const src = region.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ddx = (x0 + x) - cx;
      const ddy = (y0 + y) - cy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const t = clampNum(1 - (dist - r * 0.6) / (r * 0.4), 0, 1);
      if (t <= 0) continue;
      const i = (y * w + x) * 4;
      src[i] = src[i] * (1 - t) + cleanData[i] * t;
      src[i + 1] = src[i + 1] * (1 - t) + cleanData[i + 1] * t;
      src[i + 2] = src[i + 2] * (1 - t) + cleanData[i + 2] * t;
      src[i + 3] = src[i + 3] * (1 - t) + cleanData[i + 3] * t;
    }
  }
  ctx.putImageData(region, x0, y0);
}

// ---- 保存 ----

let lastSavedFile = null;

saveBtn.addEventListener('click', () => {
  if (!state.image) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('保存に失敗しました');
      return;
    }
    const filename = `${FILE_PREFIX}-${timestamp()}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    lastSavedFile = new File([blob], filename, { type: 'image/png' });
    showToast('保存しました');
    openShareModal();
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
    const file = new File([blob], `${FILE_PREFIX}-${timestamp()}.png`, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: APP_NAME });
        showToast('共有しました');
      } catch (err) {
        if (err && err.name !== 'AbortError') showToast('共有に失敗しました');
      }
    } else {
      showToast('この端末は共有に対応していません');
    }
  }, 'image/png');
});

// ---- SNSシェアモーダル ----

function openShareModal() {
  shareModalOverlay.hidden = false;
  requestAnimationFrame(() => shareModalOverlay.classList.add('show'));
}

function closeShareModal() {
  shareModalOverlay.classList.remove('show');
  setTimeout(() => { shareModalOverlay.hidden = true; }, 280);
}

shareModalCloseBtn.addEventListener('click', closeShareModal);
shareModalOverlay.addEventListener('click', (e) => {
  if (e.target === shareModalOverlay) closeShareModal();
});

shareButtons.forEach((btn) => {
  btn.addEventListener('click', () => shareViaPlatform(btn.dataset.platform));
});

async function shareViaPlatform(platform) {
  // Web Share APIが使える場合は、実際の画像ファイルを渡せるためこちらを優先する
  if (lastSavedFile && navigator.canShare && navigator.canShare({ files: [lastSavedFile] })) {
    try {
      await navigator.share({ files: [lastSavedFile], title: APP_NAME, text: SHARE_MESSAGE });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // ユーザーがキャンセルした場合はそのまま終了
      // それ以外の失敗時は下のURLスキームにフォールバックする
    }
  }

  if (platform === 'instagram') {
    copyShareLinkForInstagram();
    return;
  }

  const platformUrls = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_MESSAGE)}&url=${encodeURIComponent(APP_SHARE_URL)}`,
    line: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(APP_SHARE_URL)}&text=${encodeURIComponent(SHARE_MESSAGE)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_SHARE_URL)}`,
  };
  const url = platformUrls[platform];
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyShareLinkForInstagram() {
  const text = `${SHARE_MESSAGE} ${APP_SHARE_URL}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('リンクをコピーしました。Instagramのストーリーに貼り付けてください');
  } catch (err) {
    showToast('コピーに失敗しました');
  }
}

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

// ---- AdSense広告の表示 ----
// data-ad-client/data-ad-slotがプレースホルダーのままだと審査通過前はエラーになるため握りつぶす
try {
  (window.adsbygoogle = window.adsbygoogle || []).push({});
} catch (err) {
  // AdSense未設定・読み込み失敗時は広告なしで継続する
}

// 初期化
document.getElementById('appVersion').textContent = `v${APP_VERSION}`;
layoutPreviewFrame();
resizeCanvas();
