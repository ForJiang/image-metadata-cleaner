/**
 * 中英双语文案。静态文本用 data-i18n="key" 标注，动态文本用 t('key') 获取。
 */

const DICT = {
  zh: {
    'brand.name': '图片元数据清除器',
    'brand.tag': '批量 · 本地 · 隐私',
    'hero.title': '批量抹掉照片里的隐藏信息',
    'hero.sub': '相机型号、拍摄时间、GPS 定位、内嵌缩略图、修图软件痕迹——全部在浏览器里清除，照片不会上传到任何服务器。',
    'hero.badge.privacy': '100% 本地处理',
    'hero.badge.formats': 'JPEG · PNG · WebP',
    'hero.badge.oss': '免费 · 开源 · 无广告',
    'drop.title': '拖入图片，或点击选择',
    'drop.sub': '支持批量选择、整个文件夹拖入、Ctrl/⌘+V 粘贴',
    'drop.btn': '选择图片',
    'options.quality': 'JPEG 质量',
    'options.format': '输出格式',
    'options.format.auto': '保持原格式',
    'options.format.jpeg': '全部转 JPEG',
    'options.format.png': '全部转 PNG',
    'options.suffix': '文件名',
    'options.suffix.keep': '保持原名',
    'options.suffix.clean': '加 _clean 后缀',
    'action.clean': '清除全部元数据',
    'action.cleaning': '正在清除…',
    'action.downloadAll': '打包下载 ZIP',
    'action.clear': '清空列表',
    'progress.label': '处理进度',
    'list.title': '队列',
    'list.empty': '还没有文件——把图片拖上来，或点上方按钮选择。',
    'summary.title': '汇总',
    'summary.files': '处理文件',
    'summary.metaRemoved': '移除元数据段',
    'summary.bytes': '体积变化',
    'status.queued': '待处理',
    'status.cleaning': '清除中',
    'status.done': '已清除',
    'status.error': '失败',
    'row.removed': '已移除 {n} 项元数据（共 {size}）',
    'meta.exif': 'EXIF 拍摄信息',
    'meta.exif-gps': 'GPS 定位',
    'meta.thumbnail': '内嵌缩略图',
    'meta.xmp': 'XMP 信息',
    'meta.iptc': 'IPTC / Photoshop',
    'meta.icc': 'ICC 色彩配置',
    'meta.comment': '注释段',
    'meta.png-text': 'PNG 文本块',
    'meta.app-segment': '其他应用段',
    'meta.trailing': '尾部隐藏数据',
    'meta.none': '未发现元数据',
    'meta.leftover': '自检发现残留',
    'meta.danger': '高危',
    'action.downloadOne': '下载',
    'action.retry': '重试',
    'action.remove': '移除',
    'size.before': '原始',
    'size.after': '清除后',
    'faq.title': '常见问题',
    'faq.q1': '它会改变画质吗？',
    'faq.a1': '通过 Canvas 重新编码完成：PNG 保持无损，JPEG 默认按 92% 质量重存（肉眼几乎不可辨），EXIF 等信息随之消失。追求完全无损时建议选「全部转 PNG」。',
    'faq.q2': '支持 HEIC（iPhone 默认格式）吗？',
    'faq.a2': '主流浏览器无法直接解码 HEIC。先在手机上将照片导出为 JPEG，或用系统相册的「兼容性最好」选项后再拖进来。',
    'faq.q3': '为什么 PNG 清除后有时反而变大？',
    'faq.a3': 'Canvas 用浏览器自带的 PNG 编码器重新压缩，与 Photoshop 等工具算法不同，体积可能有小幅波动，像素数据完全一致。',
    'faq.q4': '照片会被上传吗？',
    'faq.a4': '不会。所有解码、扫描、重编码都在你的浏览器里完成，断网也能用；页面没有任何上传代码。',
    'faq.q5': 'ICC 色彩配置也会被移除吗？',
    'faq.a5': '是的。绝大多数照片是 sRGB，浏览器显示不受影响；只有广色域专业工作流才需要留意，可先用其他工具单独处理。',
    'footer.privacy': '无服务器 · 无日志 · 无追踪',
    'footer.made': '用 HTML + Canvas 手工制作',
    'lang.btn': 'EN',
    'lang.switched': '已切换为中文',
    'toast.unsupported': '有 {n} 个文件不是受支持的图片格式，已跳过',
    'toast.decoded': '图片解码失败：{name}（可能是不支持的格式或文件损坏）',
    'toast.cleaned': '已清除 {n} 个文件的元数据（共 {m} 项）',
    'toast.zipFailed': '打包 ZIP 失败，请改为单独下载',
    'toast.cleared': '列表已清空',
    'toast.zipDownloaded': 'ZIP 已开始下载（{n} 个文件）',
    'error.tooLarge': '图片尺寸超出浏览器画布上限',
  },
  en: {
    'brand.name': 'Image Meta Cleaner',
    'brand.tag': 'Batch · Local · Private',
    'hero.title': 'Batch-strip the hidden data in your photos',
    'hero.sub': 'Camera model, capture time, GPS location, embedded thumbnails, editor traces — all removed inside your browser. No photo ever leaves your device.',
    'hero.badge.privacy': '100% in-browser',
    'hero.badge.formats': 'JPEG · PNG · WebP',
    'hero.badge.oss': 'Free · Open source · No ads',
    'drop.title': 'Drop images here, or click to choose',
    'drop.sub': 'Batch select, whole folders, and Ctrl/⌘+V paste all work',
    'drop.btn': 'Choose images',
    'options.quality': 'JPEG quality',
    'options.format': 'Output format',
    'options.format.auto': 'Keep original',
    'options.format.jpeg': 'Convert all to JPEG',
    'options.format.png': 'Convert all to PNG',
    'options.suffix': 'File name',
    'options.suffix.keep': 'Keep original',
    'options.suffix.clean': 'Add _clean suffix',
    'action.clean': 'Remove all metadata',
    'action.cleaning': 'Cleaning…',
    'action.downloadAll': 'Download all as ZIP',
    'action.clear': 'Clear list',
    'progress.label': 'Progress',
    'list.title': 'Queue',
    'list.empty': 'No files yet — drop images above or use the button.',
    'summary.title': 'Summary',
    'summary.files': 'Files processed',
    'summary.metaRemoved': 'Metadata segments removed',
    'summary.bytes': 'Size change',
    'status.queued': 'Queued',
    'status.cleaning': 'Cleaning',
    'status.done': 'Cleaned',
    'status.error': 'Failed',
    'row.removed': 'Removed {n} metadata items ({size} total)',
    'meta.exif': 'EXIF camera data',
    'meta.exif-gps': 'GPS location',
    'meta.thumbnail': 'Embedded thumbnail',
    'meta.xmp': 'XMP metadata',
    'meta.iptc': 'IPTC / Photoshop',
    'meta.icc': 'ICC color profile',
    'meta.comment': 'Comment segment',
    'meta.png-text': 'PNG text chunk',
    'meta.app-segment': 'Other APP segments',
    'meta.trailing': 'Trailing hidden data',
    'meta.none': 'No metadata found',
    'meta.leftover': 'Self-check leftover',
    'meta.danger': 'sensitive',
    'action.downloadOne': 'Download',
    'action.retry': 'Retry',
    'action.remove': 'Remove',
    'size.before': 'Original',
    'size.after': 'Cleaned',
    'faq.title': 'FAQ',
    'faq.q1': 'Does it change image quality?',
    'faq.a1': 'Cleaning re-encodes through a canvas: PNG stays lossless, JPEG is re-saved at 92% quality by default (visually near-identical), and all EXIF-like data disappears. Pick “Convert all to PNG” for a fully lossless result.',
    'faq.q2': 'What about HEIC (iPhone default)?',
    'faq.a2': 'Browsers can’t decode HEIC directly. Export the photos as JPEG from your phone first (or set “Most Compatible” in camera settings), then drop them here.',
    'faq.q3': 'Why did my PNG get bigger after cleaning?',
    'faq.a3': 'Canvas uses the browser’s built-in PNG encoder, which differs from Photoshop and friends. File size can wobble a little; the pixel data is identical.',
    'faq.q4': 'Are my photos uploaded anywhere?',
    'faq.a4': 'No. Decoding, scanning and re-encoding all happen in your browser — it even works offline. The page contains no upload code at all.',
    'faq.q5': 'Is the ICC color profile removed too?',
    'faq.a5': 'Yes. Nearly all photos are sRGB and display identically; only wide-gamut professional workflows need to keep it, and those are better handled by dedicated tools.',
    'footer.privacy': 'No server · No logs · No tracking',
    'footer.made': 'Handmade with HTML + Canvas',
    'lang.btn': '中文',
    'lang.switched': 'Switched to English',
    'toast.unsupported': 'Skipped {n} file(s) that are not supported image formats',
    'toast.decoded': 'Could not decode: {name} (unsupported format or corrupted file)',
    'toast.cleaned': 'Metadata removed from {n} file(s), {m} items in total',
    'toast.zipFailed': 'ZIP packing failed — please download files individually',
    'toast.cleared': 'List cleared',
    'toast.zipDownloaded': 'ZIP download started ({n} files)',
    'error.tooLarge': 'Image exceeds the browser canvas size limit',
  },
};

const LANG_KEY = 'imc-lang';
let lang = 'zh';

export function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* 隐私模式下 localStorage 不可用 */ }
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function getLang() { return lang; }

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  return lang;
}

/** 取文案；{name} / {n} 占位符会被 vars 替换 */
export function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]) || DICT.zh[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** 把文档里所有 data-i18n 元素的文本刷成当前语言 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const v = t(key);
    if (v && v !== key) el.textContent = v;
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}
