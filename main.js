// 写真を縮小して中央に配置し、余白をぼかして加工するアプリのロジック

const APP_VERSION = '1.5.0';
const APP_NAME = '写真ぼかしスタジオ';
const FILE_PREFIX = 'photo-blur-studio';

// SNSシェア用
// navigator.share()はfilesと同時にurlを渡すと多くのブラウザ(特にAndroid)で
// urlが無視されタイトルしか表示されないため、textにアプリ名+URLをまとめて渡す
const APP_SHARE_URL = 'https://photo-blur-pwa.vercel.app/';
const SHARE_HASHTAGS = '#写真ぼかし #PhotoBlurPWA #画像加工';
const SHARE_MESSAGE = `${APP_NAME} ${SHARE_HASHTAGS}`; // URLを含まない文言(X/LINEのtextパラメータ用)
const SHARE_TEXT = `${SHARE_MESSAGE}\n${APP_SHARE_URL}`; // Web Share API/Instagramコピー用(URL込み)

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
const brushTypePaintBtn = document.getElementById('brushTypePaintBtn');
const paintColorOptions = document.getElementById('paintColorOptions');
const colorSwatches = document.querySelectorAll('.color-swatch');
const blurOptions = document.getElementById('blurOptions');

const selectBtn = document.getElementById('selectBtn');
const saveBtn = document.getElementById('saveBtn');
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
  brushMode: 'blur', // 'blur'(なぞりぼかし) | 'erase'(消しゴムブラシ) | 'paint'(塗りつぶしペン)
  paintColor: '#000000',
  // ブラシで加えたぼかし/消しゴム編集は、画像そのものの座標系(image.width x image.height)の
  // マスクとして保持する。パン・ズーム・ぼかし強度変更のたびに全体を再描画しても、
  // マスクは画像に固定されているため編集内容が消えない
  editMask: null,
  // ペイントで塗った線も同じ理由で画像座標系のレイヤーとして保持する
  paintLayer: null,
  blurredFullCache: { strength: null, canvas: null },
  compositeCache: { canvas: null, dirty: true },
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
    state.editMask = document.createElement('canvas');
    state.editMask.width = img.width;
    state.editMask.height = img.height;
    state.paintLayer = document.createElement('canvas');
    state.paintLayer.width = img.width;
    state.paintLayer.height = img.height;
    state.blurredFullCache = { strength: null, canvas: null };
    state.compositeCache = { canvas: null, dirty: true };
    previewFrame.classList.add('has-image');
    saveBtn.disabled = false;
    closeShareModal(); // 新しい画像を選んだら前の共有モーダルは閉じる
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
  // ぼかし＆ペイント(ぼかしブラシ/消しゴムブラシ/ペイント)はどちらのモードでも使用できる

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
  invalidateComposite();
  draw();
});

function invalidateComposite() {
  state.compositeCache.dirty = true;
}

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

// ---- ブラシ種類切り替え（ぼかしブラシ / 消しゴムブラシ / ペイント） ----

function setBrushType(type) {
  state.brushMode = type;
  brushTypeBlurBtn.classList.toggle('active', type === 'blur');
  brushTypeEraseBtn.classList.toggle('active', type === 'erase');
  brushTypePaintBtn.classList.toggle('active', type === 'paint');
  // ペイント選択時のみ色選択UIを表示し、無関係な「ぼかし強度」は隠す
  paintColorOptions.hidden = type !== 'paint';
  blurOptions.hidden = type === 'paint';
  paintLastPoint = null;
}

brushTypeBlurBtn.addEventListener('click', () => setBrushType('blur'));
brushTypeEraseBtn.addEventListener('click', () => setBrushType('erase'));
brushTypePaintBtn.addEventListener('click', () => setBrushType('paint'));

// ---- ペンの色選択 ----

colorSwatches.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.paintColor = btn.dataset.color;
    colorSwatches.forEach((b) => b.classList.toggle('active', b === btn));
  });
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

  renderScene(ctx, w, h);
}

// 現在のstate(モード・ぼかし強度・パン/ズーム)に基づいて1コマ描画する。
// ブラシで加えた編集は画像座標系のマスクとして別途合成されるため、
// パン/ズーム/ぼかし強度の変更だけではブラシ編集は失われない
function renderScene(targetCtx, w, h) {
  const displayImg = getCompositeImage();
  if (state.renderMode === 'original') {
    drawOriginalImage(targetCtx, displayImg, w, h);
  } else {
    drawBlurredBackground(targetCtx, state.image, w, h);
    drawForeground(targetCtx, displayImg, w, h);
  }
}

// ぼかし強度に応じて画像全体をぼかした版を作る（image座標系、ブラシのぼかし合成に使う）
function getBlurredFullImage() {
  const img = state.image;
  const cache = state.blurredFullCache;
  if (cache.canvas && cache.strength === state.blur) return cache.canvas;

  const factor = 1 + state.blur * 0.9;
  const smallW = Math.max(2, Math.round(img.width / factor));
  const smallH = Math.max(2, Math.round(img.height / factor));
  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  sctx.drawImage(img, 0, 0, smallW, smallH);

  const full = document.createElement('canvas');
  full.width = img.width;
  full.height = img.height;
  const fctx = full.getContext('2d');
  fctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in fctx) fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(small, 0, 0, smallW, smallH, 0, 0, img.width, img.height);

  cache.canvas = full;
  cache.strength = state.blur;
  return full;
}

// 元画像に「ぼかし版 × 編集マスク」を重ねた、表示用の合成画像を作る（image座標系）。
// マスクとぼかし強度が変わっていなければキャッシュを再利用する
function getCompositeImage() {
  const img = state.image;
  const cache = state.compositeCache;
  if (!cache.dirty && cache.canvas) return cache.canvas;

  const blurredFull = getBlurredFullImage();
  const masked = document.createElement('canvas');
  masked.width = img.width;
  masked.height = img.height;
  const mctx = masked.getContext('2d');
  mctx.drawImage(blurredFull, 0, 0);
  mctx.globalCompositeOperation = 'destination-in';
  mctx.drawImage(state.editMask, 0, 0);

  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const octx = out.getContext('2d');
  octx.drawImage(img, 0, 0);
  octx.drawImage(masked, 0, 0);
  octx.drawImage(state.paintLayer, 0, 0); // ペイントは一番上に重ねる

  cache.canvas = out;
  cache.dirty = false;
  return out;
}

// 現在のrenderMode・パン・ズームに基づき、画像をキャンバス上のどこに(dx,dy,dw,dh)で
// 描画するかを計算する。ブラシ処理での逆変換(canvas座標→画像座標)にも同じ式を使う
function computeImageTransform(img, w, h, baseScaleFactor) {
  const fitScale = Math.min(w / img.width, h / img.height) * baseScaleFactor * state.scale;
  const dw = img.width * fitScale;
  const dh = img.height * fitScale;

  const maxOffsetX = Math.max(0, (w + dw) / 2 - MIN_VISIBLE);
  const maxOffsetY = Math.max(0, (h + dh) / 2 - MIN_VISIBLE);
  state.offsetX = clampNum(state.offsetX, -maxOffsetX, maxOffsetX);
  state.offsetY = clampNum(state.offsetY, -maxOffsetY, maxOffsetY);

  const dx = (w - dw) / 2 + state.offsetX;
  const dy = (h - dh) / 2 + state.offsetY;
  return { dx, dy, dw, dh };
}

function getActiveForegroundTransform(w, h) {
  const baseScaleFactor = state.renderMode === 'original' ? 1 : FOREGROUND_SCALE;
  return computeImageTransform(state.image, w, h, baseScaleFactor);
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
  const { dx, dy, dw, dh } = computeImageTransform(state.image, w, h, FOREGROUND_SCALE);
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
  const { dx, dy, dw, dh } = computeImageTransform(state.image, w, h, 1);
  targetCtx.drawImage(img, dx, dy, dw, dh);
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
    if (state.brushMode === 'paint') paintLastPoint = null;
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
    paintLastPoint = null;
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
    if (state.brushMode === 'paint') paintLastPoint = null;
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
  paintLastPoint = null;
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
    } else if (state.brushMode === 'paint') {
      applyPaintAt(pendingBrushPoint.x, pendingBrushPoint.y);
    } else {
      applyBrushBlurAt(pendingBrushPoint.x, pendingBrushPoint.y);
    }
  });
}

// ブラシ操作(cssX, cssY)を画像座標系に変換し、指定のレイヤーに円形のグラデーションを
// 指定のcompositeOperationで焼き込む共通処理（副作用(再描画)は呼び出し側の責務にする）
function paintCircleOnLayer(layer, cssX, cssY, compositeOperation) {
  const img = state.image;
  if (!img || !layer) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const t = getActiveForegroundTransform(w, h);
  if (t.dw <= 0 || t.dh <= 0) return;

  const scaleToImgX = img.width / t.dw;
  const scaleToImgY = img.height / t.dh;
  const imgX = (cssX - t.dx) * scaleToImgX;
  const imgY = (cssY - t.dy) * scaleToImgY;
  const rImg = Math.max(2, state.brushSize * scaleToImgX);

  const lctx = layer.getContext('2d');
  lctx.save();
  lctx.globalCompositeOperation = compositeOperation;
  const grad = lctx.createRadialGradient(imgX, imgY, rImg * 0.6, imgX, imgY, rImg);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  lctx.fillStyle = grad;
  lctx.beginPath();
  lctx.arc(imgX, imgY, rImg, 0, Math.PI * 2);
  lctx.fill();
  lctx.restore();
}

function applyBrushBlurAt(cssX, cssY) {
  paintCircleOnLayer(state.editMask, cssX, cssY, 'source-over');
  invalidateComposite();
  draw();
}

// ---- なぞった部分のぼかし/ペイントを消す（消しゴムブラシ） ----
// ぼかしマスクとペイントレイヤーの両方から同時に消す。これによりどちらで
// 描いた内容でも同じ消しゴムでなぞって消せる
function applyEraseBrushAt(cssX, cssY) {
  paintCircleOnLayer(state.editMask, cssX, cssY, 'destination-out');
  paintCircleOnLayer(state.paintLayer, cssX, cssY, 'destination-out');
  invalidateComposite();
  draw();
}

// ---- 塗りつぶし（ペイント）----

// なぞりの軌跡を線としてつなぐため、直前になぞった画像座標(image座標系)を覚えておく。
// なぞり開始時(touchstart/mousedown)や指を離した時にnullへリセットする
let paintLastPoint = null;

function applyPaintAt(cssX, cssY) {
  const img = state.image;
  if (!img || !state.paintLayer) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const t = getActiveForegroundTransform(w, h);
  if (t.dw <= 0 || t.dh <= 0) return;

  const scaleToImgX = img.width / t.dw;
  const scaleToImgY = img.height / t.dh;
  const imgX = (cssX - t.dx) * scaleToImgX;
  const imgY = (cssY - t.dy) * scaleToImgY;
  const lineWidthImg = Math.max(2, state.brushSize * scaleToImgX);

  const pctx = state.paintLayer.getContext('2d');
  pctx.save();
  pctx.strokeStyle = state.paintColor;
  pctx.fillStyle = state.paintColor;
  pctx.lineWidth = lineWidthImg;
  pctx.lineCap = 'round';
  pctx.lineJoin = 'round';

  if (paintLastPoint) {
    pctx.beginPath();
    pctx.moveTo(paintLastPoint.x, paintLastPoint.y);
    pctx.lineTo(imgX, imgY);
    pctx.stroke();
  } else {
    // タップしただけでも点が残るよう、最初の1点は円として塗る
    pctx.beginPath();
    pctx.arc(imgX, imgY, lineWidthImg / 2, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.restore();

  paintLastPoint = { x: imgX, y: imgY };

  invalidateComposite();
  draw();
}

// ---- 保存 ----

let lastSavedFile = null;

saveBtn.addEventListener('click', () => {
  if (!state.image) return;
  canvas.toBlob(async (blob) => {
    if (!blob) {
      showToast('保存に失敗しました');
      return;
    }
    const filename = `${FILE_PREFIX}-${timestamp()}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    lastSavedFile = file;

    // iPhone等Web Share APIに対応した端末では、<a download>だとブラウザ標準の
    // 画像プレビュー画面(「表示」)に遷移することがあり、そこにはSNS共有ボタンを
    // 出せない。共有シートの「写真に保存」を使ってもらう方式を優先することで、
    // 常にアプリ内に留まったままSNS共有モーダルを出せるようにする
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: APP_NAME });
        showToast('保存しました');
        openShareModal();
      } catch (err) {
        if (err && err.name !== 'AbortError') showToast('保存に失敗しました');
        // ユーザーが共有シートをキャンセルした場合は何もしない
      }
      return;
    }

    // Web Share API非対応環境向けのフォールバック：従来通りダウンロードする
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast('保存しました');
    // ダウンロード直後はブラウザ側の処理でモーダル表示が遅延することがあるため、
    // 少し待ってから表示する
    setTimeout(() => openShareModal(), 300);
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
      await navigator.share({ files: [lastSavedFile], title: APP_NAME, text: SHARE_TEXT });
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
  try {
    await navigator.clipboard.writeText(SHARE_TEXT);
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

// 初期化
document.getElementById('appVersion').textContent = `v${APP_VERSION}`;
layoutPreviewFrame();
resizeCanvas();
