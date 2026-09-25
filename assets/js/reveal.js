/**
 * 卡片入场动画：「淡入 + 上移」滚动揭示。
 *
 * 元素带 data-reveal 属性即参与，进入视口后加 .in，过渡交给 CSS。
 * 实现刻意不用 IntersectionObserver（实测部分内嵌 WebView 的 IO 回调始终
 * 不触发），也不用 rAF 节流（同样有 WebView 不回调 rAF，会把节流锁死）——
 * 用时间戳 + 尾调 setTimeout，任何环境都能动。
 * 另有 400ms 轮询兜底：个别 WebView 对程序化滚动不派发 scroll 事件，
 * 真实用户的触摸/滚轮滚动不受影响，但兜底让任何滚动都能触发揭示；
 * 待揭示元素清零后轮询自动停止，新入队卡片由 revealAll 重启。
 */

let listenersBound = false;
let lastRun = 0;
let trailing = 0;
let poller = 0;

function check() {
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const els = document.querySelectorAll('[data-reveal]:not(.in)');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    // 顶端进入视口（预留 40px 提前量）即揭示；同时要求未完全滚过
    if (r.top < vh - 40 && r.bottom > 0) el.classList.add('in');
  }
}

function runCheck() {
  lastRun = Date.now();
  check();
}

function onScrollOrResize() {
  const now = Date.now();
  if (now - lastRun >= 80) {
    runCheck();
    return;
  }
  // 尾调：滚动停下来后再补一次，避免漏掉最后一段位移
  clearTimeout(trailing);
  trailing = setTimeout(runCheck, 80);
}

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;
  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('orientationchange', onScrollOrResize);
}

function startPoller() {
  if (poller) return;
  poller = setInterval(() => {
    check();
    if (!document.querySelector('[data-reveal]:not(.in)')) {
      clearInterval(poller);
      poller = 0;
    }
  }, 400);
}

/** 观察 root 内尚未揭示的 [data-reveal] 元素（新入队的卡片、刚显示的汇总区） */
export function revealAll(root = document) {
  ensureListeners();
  startPoller();
  check();
}
