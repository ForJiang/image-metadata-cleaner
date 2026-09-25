/**
 * 液态金属背景（视觉对齐 ForJiang.github.io 的 LiquidMetal / RVC Sound Clone）
 *
 * 深色底 #0a0a0c + 银色液滴 #ced2da，metaballs 形状，柔和边缘扰动。
 * 自研 fragment shader，无第三方依赖，WebGL1 即可运行。
 * 画质自适应：从最高档渲染缓冲起步，实测 p95 帧时间不达标才逐级降档；
 * 抗锯齿靠超采样，降档只影响锐度、不产生锯齿。
 */

const QUALITY_TIERS = [2560 * 1440, 1920 * 1080, 1280 * 720];
const TARGET_FRAME_MS = 17.5; // ≈57fps 的帧预算
const DPR_CAP = 1.5;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

// 单个软球：r / (d^2 + eps)，多个叠加即成 metaballs
float blob(vec2 uv, vec2 c, float r) {
  float d = length(uv - c);
  return r / (d * d + 0.012);
}

/** 液态金属场：5 个缓慢漂移的液滴 + fbm 边缘扰动 */
float fieldAt(vec2 uv, float t) {
  float f = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(
      sin(t * (0.70 + fi * 0.13) + fi * 2.1) * 0.44,
      cos(t * (0.55 + fi * 0.11) + fi * 1.7) * 0.24 + 0.18
    );
    float r = 0.052 + 0.018 * sin(t * 1.3 + fi);
    f += blob(uv, c, r);
  }
  float w = fbm(uv * 2.4 + vec2(t * 0.35, -t * 0.22));
  f += (w - 0.5) * 0.26;
  return f;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.7;

  float f = fieldAt(uv, t);

  float edge = smoothstep(0.90, 1.08, f);

  // 由场的梯度近似法线，做金属高光
  float e = 2.0 / uRes.y;
  float fx = fieldAt(uv + vec2(e, 0.0), t) - fieldAt(uv - vec2(e, 0.0), t);
  float fy = fieldAt(uv + vec2(0.0, e), t) - fieldAt(uv - vec2(0.0, e), t);
  vec3 n = normalize(vec3(-fx, -fy, 0.55));
  vec3 lightDir = normalize(vec3(0.35, 0.72, 0.6));
  float spec = pow(max(dot(n, lightDir), 0.0), 26.0);
  float sheen = pow(max(dot(n, normalize(vec3(-0.5, 0.2, 0.8))), 0.0), 8.0) * 0.25;

  vec3 back = vec3(0.039, 0.039, 0.047);   // #0a0a0c
  vec3 tint = vec3(0.808, 0.824, 0.855);   // #ced2da
  vec3 col = mix(back, tint, edge);

  col += spec * vec3(1.0, 0.97, 0.93) * 0.55;
  col += sheen * vec3(0.75, 0.82, 1.0);

  // 液面内侧的细腻纹理，避免大面积色带
  float grain = hash(gl_FragCoord.xy + fract(uTime)) * 0.018 - 0.009;
  col += grain;

  // 暗角，让中心的玻璃面板更突出
  float vig = 1.0 - 0.35 * length(uv * vec2(0.55, 0.75));
  col *= clamp(vig, 0.0, 1.0);

  // 整体压暗一档，保证白字 + 玻璃面板的可读性
  col *= 0.88;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function createGL(canvas) {
  const opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' };
  return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
}

/**
 * 启动液态金属背景。
 * @returns {{stop: () => void, ok: boolean}} ok=false 表示环境不支持，调用方应保留 CSS 渐变兜底
 */
export function startLiquidBackground(canvas) {
  if (!canvas) return { stop() {}, ok: false };

  const gl = createGL(canvas);
  if (!gl) return { stop() {}, ok: false };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[liquid-bg] shader 编译失败：', gl.getShaderInfoLog(s));
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
    console.warn('[liquid-bg] program 链接失败：', gl.getProgramInfoLog(prog));
    return { stop() {}, ok: false };
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let maxPixels = QUALITY_TIERS[0];
  let raf = 0;
  let stopped = false;
  let startTime = performance.now();

  function resize() {
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const px = w * h;
    if (px > maxPixels) {
      const k = Math.sqrt(maxPixels / px);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    }
  }

  function draw(now) {
    if (stopped) return;
    resize();
    gl.uniform1f(uTime, (now - startTime) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  }

  resize();
  gl.uniform1f(uTime, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (reduced) return { ok: true, stop() { stopped = true; } };

  raf = requestAnimationFrame(draw);

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !stopped) {
      raf = requestAnimationFrame(draw);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  /** 采样约 1.5 秒帧时间，p95 不达标就降一档 */
  async function tuneQuality() {
    await new Promise((r) => setTimeout(r, 1200));
    if (stopped) return;
    for (const tier of QUALITY_TIERS) {
      if (stopped) return;
      maxPixels = tier;
      resize();
      await new Promise((r) => setTimeout(r, 900));
      if (stopped) return;
      const ms = await measureFrameTime();
      if (stopped) return;
      if (ms <= TARGET_FRAME_MS) return;
    }
  }

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
          resolve(Math.max(avg, p95 * 0.7));
        }
      };
      requestAnimationFrame(tick);
    });
  }

  tuneQuality();

  return {
    ok: true,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
