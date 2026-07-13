// 写真を縮小して中央に配置し、余白をぼかして加工するアプリのロジック

const previewFrame = document.getElementById('previewFrame');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const toastEl = document.getElementById('toast');

const blurRange = document.getElementById('blurRange');
const blurValue = document.getElementById('blurValue');

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
};

let toastTimer = null;
let resizeRaf = null;

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

// ---- ぼかし強度スライダー ----

blurRange.addEventListener('input', () => {
  state.blur = Number(blurRange.value);
  blurValue.textContent = `${state.blur}px`;
  draw();
});

// ---- Canvasのリサイズ ----

function resizeCanvas() {
  const rect = previewFrame.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const resizeObserver = new ResizeObserver(() => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeCanvas();
    draw();
  });
});
resizeObserver.observe(previewFrame);

// ---- 描画 ----

function draw() {
  const img = state.image;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);
  if (!img) return;

  drawBlurredBackground(img, w, h);
  drawForeground(img, w, h);
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

function drawForeground(img, w, h) {
  const containScale = Math.min(w / img.width, h / img.height) * FOREGROUND_SCALE;
  const dw = img.width * containScale;
  const dh = img.height * containScale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
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
resizeCanvas();
