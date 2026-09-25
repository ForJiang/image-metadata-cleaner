/**
 * 处理日志总线：把清除流水线的执行过程广播给终端窗口。
 *
 * 纯逻辑、零依赖：环形缓冲（最多保留 MAX_LINES 条）+ 订阅通知 + 行格式化，
 * 可以直接在 Node 里测试；DOM 渲染留在 app.js。
 */

export const LEVELS = ['cmd', 'info', 'ok', 'warn', 'err'];
const MAX_LINES = 500;

/** 生成一行日志：{level, text, detail, ts} */
export function makeLine(level, text, detail, now = 0) {
  return {
    level: LEVELS.includes(level) ? level : 'info',
    text: String(text ?? ''),
    detail: detail === undefined || detail === null || detail === '' ? undefined : String(detail),
    ts: Number(now) || 0,
  };
}

/** 时间戳 → HH:MM:SS.mmm */
export function formatTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * 行 → 展示文本（终端窗口用）。
 * cmd 行渲染成 `$ open · photo.jpg`，其余渲染成 `› scan …` / `✓ verify …` 形式。
 */
export function formatLine(line) {
  const head = formatTime(line.ts);
  const mark = line.level === 'ok' ? '✓' : line.level === 'warn' ? '!' : line.level === 'err' ? '✗' : '›';
  const body = line.detail ? `${line.text} · ${line.detail}` : line.text;
  return `[${head}] ${line.level === 'cmd' ? '$' : mark} ${body}`;
}

/** 环形缓冲：超量时丢弃最旧的行 */
export function pushLine(lines, line, max = MAX_LINES) {
  const next = [...lines, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 创建日志总线 */
export function createLogBus(max = MAX_LINES) {
  let lines = [];
  const listeners = new Set();

  function emit(level, text, detail) {
    const line = makeLine(level, text, detail, Date.now());
    lines = pushLine(lines, line, max);
    for (const fn of listeners) {
      try { fn(line, lines); } catch { /* 订阅者异常不影响流水线 */ }
    }
    return line;
  }

  return {
    cmd: (text, detail) => emit('cmd', text, detail),
    info: (text, detail) => emit('info', text, detail),
    ok: (text, detail) => emit('ok', text, detail),
    warn: (text, detail) => emit('warn', text, detail),
    err: (text, detail) => emit('err', text, detail),
    /** 订阅新行；返回取消函数 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getLines: () => lines,
    clear() {
      lines = [];
      for (const fn of listeners) {
        try { fn(null, lines); } catch { /* ignore */ }
      }
    },
  };
}
