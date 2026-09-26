/**
 * 波动线条背景（复刻参考的 Three.js WebGL shader，零第三方依赖版）
 *
 * 原作为 React + three.js 的 <WebGLShader />：RawShaderMaterial 全屏四边形，
 * 每个通道按 `0.05 / abs(p.y + sin((p.x + time) * xScale) * yScale)` 画发散的
 * 正弦亮线，distortion 让 R/B 通道随半径横向错位，形成色散边缘。
 * 这里用原生 WebGL1 等价实现，uniforms 默认值与参考一致。
 *
 * 与参考的两点差异（都是修正而非改风格）：
 * 1. resolution 用绘制缓冲像素而非 CSS 像素——参考混合了两套坐标系，
 *    在 retina 屏上图案会偏移；
 * 2. 页面隐藏时暂停渲染、prefers-reduced-motion 只画一帧静态画面。
 *
 * 清晰度：绘制缓冲按设备像素比渲染（上限 2 档，即 retina 原生分辨率），
 * 亮线边缘不再被浏览器拉伸发虚；弱设备实测帧时间不达标时退到 1.5 档
 * ——与旧版持平，绝不更糊。shader 图案按 min(分辨率) 归一化，换倍率
 * 只改变锐度、不改变画面。
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float xScale;
uniform float yScale;
uniform float distortion;

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

  float d = length(p) * distortion;

  float rx = p.x * (1.0 + d);
  float gx = p.x;
  float bx = p.x * (1.0 - d);

  float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
  float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
  float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);

  gl_FragColor = vec4(r, g, b, 1.0);
}
`;

const DPR_CAP = 2;          // retina 原生分辨率：缓冲与设备像素 1:1，线条边缘不发虚
const SCALE_FLOOR = 1.5;    // 兜底档：与旧版上限持平，任何设备都不会比原来更糊
const TARGET_FRAME_MS = 17.5; // ≈57fps 的帧预算
const TIME_STEP = 0.01; // 与参考一致：每帧步进（非按时间）

/**
 * 依据实测帧时间挑渲染倍率（纯函数，便于单测）。
 * 2 档不达标就退到兜底档；绝不低于 SCALE_FLOOR——清晰度只升不降。
 */
export function pickScaleTier(avgMs, p95Ms) {
  const worst = Math.max(avgMs, p95Ms * 0.7);
  return worst <= TARGET_FRAME_MS ? DPR_CAP : SCALE_FLOOR;
}

function createGL(canvas) {
  const opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' };
  return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
}

/**
 * 启动波动线条背景。
 * @returns {{stop: () => void, ok: boolean}} ok=false 表示环境不支持，调用方应保留 CSS 兜底
 */
export function startWaveBackground(canvas) {
  if (!canvas) return { stop() {}, ok: false };

  const gl = createGL(canvas);
  if (!gl) return { stop() {}, ok: false };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[wave-bg] shader 编译失败：', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return { stop() {}, ok: false };

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[wave-bg] program 链接失败：', gl.getProgramInfoLog(prog));
    return { stop() {}, ok: false };
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'resolution');
  const uTime = gl.getUniformLocation(prog, 'time');
  const uXScale = gl.getUniformLocation(prog, 'xScale');
  const uYScale = gl.getUniformLocation(prog, 'yScale');
  const uDistortion = gl.getUniformLocation(prog, 'distortion');

  // 与参考组件一致的默认参数
  gl.uniform1f(uXScale, 1.0);
  gl.uniform1f(uYScale, 0.5);
  gl.uniform1f(uDistortion, 0.05);
  gl.clearColor(0, 0, 0, 1);

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let stopped = false;
  let t = 0;

  // —— 稳定尺寸捕获 ——
  // 移动端滚动时地址栏收放会持续改变视口高度。若每次都重建画布并刷新
  // resolution uniform，波浪图案会不断重排，看起来就是”背景在滑动、卡顿”。
  // 策略：画布只在「宽度变化」「高度剧烈变化（>20%，如横竖屏切换）」
  // 「设备像素比变化（缩放/切换显示器）」或 tuner 强制时重建，
  // 地址栏带来的微小高度变化由 CSS 拉伸吸收（图案锚点不变，视觉上钉在原地）。
  let stableW = 0;
  let stableH = 0;
  let lastDpr = 0;
  let resizeTimer = 0;
  let renderScale = DPR_CAP; // 实测不达标时由 tuner 降到 SCALE_FLOOR

  function captureSize(force = false) {
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const first = stableW === 0;
    const widthChanged = Math.abs(cssW - stableW) > 2;
    const heightJump = stableH > 0 && Math.abs(cssH - stableH) / stableH > 0.2;
    const dprChanged = lastDpr !== 0 && dpr !== lastDpr;
    if (!first && !widthChanged && !heightJump && !dprChanged && !force) return;

    stableW = cssW;
    stableH = cssH;
    lastDpr = dpr;
    const scale = Math.min(dpr, renderScale);
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }

  function draw() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame() {
    if (stopped) return;
    t += TIME_STEP; // 与参考一致：每帧固定步进
    gl.uniform1f(uTime, t);
    draw();
    raf = requestAnimationFrame(frame);
  }

  /** 采样约 1.5 秒帧时间：返回 { avg, p95 } */
  function measureFrameTime() {
    return new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const tick = (now) => {
        deltas.push(now - last);
        last = now;
        if (deltas.length <= 90) requestAnimationFrame(tick);
        else {
          deltas.sort((a, b) => a - b);
          const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
          const p95 = deltas[Math.floor(deltas.length * 0.95)];
          resolve({ avg, p95 });
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * 清晰度自适应。仅当 2 档真实生效（dpr > 1.5）时才值得测——dpr≤1.5 时
   * min(dpr, scale) 至多 1.5，测了也无档可降。rAF 不回调的环境（个别内嵌
   * WebView）采样永远不 resolve， tuner 静默停住，不影响已经跑起来的渲染。
   */
  async function tuneRenderScale() {
    if ((window.devicePixelRatio || 1) <= SCALE_FLOOR) return;
    await new Promise((r) => setTimeout(r, 900));
    if (stopped) return;
    const { avg, p95 } = await measureFrameTime();
    if (stopped) return;
    const next = pickScaleTier(avg, p95);
    if (next !== renderScale) {
      renderScale = next;
      captureSize(true);
    }
  }

  captureSize();
  gl.uniform1f(uTime, 0);
  draw();

  if (reduced) return { ok: true, stop() { stopped = true; } };

  raf = requestAnimationFrame(frame);
  tuneRenderScale(); // 起步 2 档，实测帧时间不达标自动退到 1.5 档

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !stopped) {
      raf = requestAnimationFrame(frame);
    }
  };
  // resize 防抖：地址栏收放会连发多个 resize，汇总后只判断一次
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(captureSize, 150);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  return {
    ok: true,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    },
  };
}
