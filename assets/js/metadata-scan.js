/**
 * 图片元数据扫描器（纯函数，零依赖，可在 Node 中直接测试）
 *
 * 识别 JPEG / PNG / WebP 中可能携带隐私信息的元数据：
 * EXIF（相机、时间、GPS、内嵌缩略图）、XMP、IPTC/Photoshop、
 * ICC 色彩配置、注释段、PNG 文本块、文件尾部隐藏数据等。
 *
 * 本模块只读取，不修改，任何情况下都不抛异常。
 */

const MM = 0x4d4d; // 'MM' 大端 TIFF 头
const II = 0x4949; // 'II' 小端 TIFF 头

const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** TIFF 字段类型 → 字节数（用于定位值/偏移） */
const TIFF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function asciiAt(bytes, off, len) {
  let s = '';
  const end = Math.min(off + len, bytes.length);
  for (let i = off; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function startsWithAscii(bytes, off, str) {
  for (let i = 0; i < str.length; i++) {
    if (bytes[off + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * 扫描一段 TIFF/EXIF 流，返回结构化摘要。
 * @param {Uint8Array} bytes 完整文件缓冲区
 * @param {number} start TIFF 头（'II'/'MM'）所在偏移
 * @returns {{make?:string, model?:string, dateTime?:string, software?:string,
 *            gps?:string, thumbnail?:boolean, exifSubTags?:number} | null}
 */
function parseTiff(bytes, start) {
  try {
    if (start < 0 || start + 8 > bytes.length) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 魔数按大端读再比对（II/MM 两个常量字节对称，大端读即可判别）
    const little = dv.getUint16(start) === II;
    if (!little && dv.getUint16(start) !== MM) return null;

    // 注意：TIFF 内部所有偏移（IFD 指针、条目、数据）都是相对 TIFF 头 start 的，
    // 因此统一在这里 rebase 到绝对位置，后续全部用 TIFF 相对坐标思考。
    const u16 = (o) => dv.getUint16(start + o, little);
    const u32 = (o) => dv.getUint32(start + o, little);
    const inRange = (o, n) => start + o >= 0 && start + o + n <= bytes.length;

    const readValue = (type, count, valueOff) => {
      const size = (TIFF_TYPE_SIZE[type] || 1) * count;
      const dataOff = size <= 4 ? valueOff : u32(valueOff);
      if (dataOff === 0 || !inRange(dataOff, size)) return null;
      if (type === 2) { // ASCII
        return asciiAt(bytes, start + dataOff, count).replace(/\0.*$/, '');
      }
      if (type === 3) return u16(dataOff);
      if (type === 4 || type === 9) return u32(dataOff);
      if (type === 10 || type === 5) { // 有理数
        const num = type === 5 ? u32(dataOff) : dv.getInt32(start + dataOff, little);
        const den = type === 5 ? u32(dataOff + 4) : dv.getInt32(start + dataOff + 4, little);
        return den === 0 ? null : num / den;
      }
      return null;
    };

    /** 解析一个 IFD，把关心的标签收进 tags；raw 额外记录条目位置（GPS 有理数用） */
    const parseIfd = (ifdOff, tags, raw) => {
      if (start + ifdOff + 2 > bytes.length || ifdOff < 8) return { nextIfd: 0, count: 0 };
      const n = u16(ifdOff);
      for (let i = 0; i < n; i++) {
        const e = ifdOff + 2 + i * 12;
        if (e + 12 > bytes.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        if (!TIFF_TYPE_SIZE[type]) continue;
        const size = TIFF_TYPE_SIZE[type] * count;
        const dataOff = size <= 4 ? e + 8 : u32(e + 8);
        if (raw && dataOff > 0 && inRange(dataOff, size)) raw.set(tag, { type, count, dataOff });
        const v = readValue(type, count, e + 8);
        if (v !== null && v !== '') tags.set(tag, v);
      }
      const nextOff = ifdOff + 2 + n * 12;
      return { nextIfd: start + nextOff + 4 <= bytes.length ? u32(nextOff) : 0, count: n };
    };

    const ifd0 = u32(4);
    const tags0 = new Map();
    const r0 = parseIfd(ifd0, tags0);

    let exifTags = new Map();
    if (tags0.has(0x8769)) parseIfd(tags0.get(0x8769), exifTags);

    let gpsStr = null;
    if (tags0.has(0x8825)) {
      const gps = new Map();
      const gpsRaw = new Map();
      parseIfd(tags0.get(0x8825), gps, gpsRaw);
      // GPSLatitude/Longitude 是 3 个有理数（度/分/秒）→ 十进制
      const dms = (tag) => {
        const e = gpsRaw.get(tag);
        if (!e || e.type !== 5 || e.count < 3) return null;
        let v = 0;
        for (let i = 0; i < 3; i++) {
          const b = e.dataOff + i * 8;
          if (start + b + 8 > bytes.length) return null;
          const den = u32(b + 4);
          if (!den) return null;
          const r = i === 0 ? 1 : i === 1 ? 1 / 60 : 1 / 3600;
          v += (u32(b) / den) * r;
        }
        return v;
      };
      const lat = dms(0x0002);
      const lon = dms(0x0004);
      if (lat !== null && lon !== null) {
        const latRef = gps.get(0x0001) === 'S' ? -1 : 1;
        const lonRef = gps.get(0x0003) === 'W' ? -1 : 1;
        gpsStr = `${(lat * latRef).toFixed(5)}°, ${(lon * lonRef).toFixed(5)}°`;
      } else if (gps.size > 0) {
        gpsStr = 'present';
      }
    }

    const str = (map, tag) => (typeof map.get(tag) === 'string' && map.get(tag).trim() ? map.get(tag).trim() : undefined);
    const num = (map, tag) => (typeof map.get(tag) === 'number' ? map.get(tag) : undefined);

    const make = str(tags0, 0x010f) || str(exifTags, 0xa433);
    const model = str(tags0, 0x0110) || str(exifTags, 0xa434);
    const dateTime = str(tags0, 0x0132) || str(exifTags, 0x9003) || str(exifTags, 0x9004);
    const software = str(tags0, 0x0131) || str(exifTags, 0x0131);

    return {
      make, model, dateTime, software,
      gps: gpsStr,
      thumbnail: r0.nextIfd > 0,
      orientation: num(tags0, 0x0112),
      exifTagCount: exifTags.size,
    };
  } catch {
    return null;
  }
}

/** 汇总 TIFF 摘要为给人看的短句 */
function describeTiff(info) {
  if (!info) return undefined;
  const parts = [];
  if (info.make) parts.push(info.make);
  if (info.model) parts.push(info.model);
  if (info.dateTime) parts.push(info.dateTime);
  if (info.software) parts.push(info.software);
  return parts.length ? parts.join(' · ') : undefined;
}

/** JPEG 元数据扫描 */
function scanJpeg(bytes) {
  const items = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 2; // 跳过 SOI (FFD8)
  const appnSeen = [];

  const add = (type, size, detail) => items.push({ type, size, detail });

  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) break;
    const marker = bytes[off + 1];

    // 无长度字段的独立标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xd9) { // EOI：检查尾部隐藏数据
      const trailing = bytes.length - (off + 2);
      if (trailing > 0) add('trailing', trailing);
      break;
    }

    const len = dv.getUint16(off + 2);
    if (len < 2) break;
    const payloadStart = off + 4;
    const payloadEnd = Math.min(off + 2 + len, bytes.length);

    if (marker === 0xda) { // SOS：后面是压缩数据，跳到下一个标记
      let i = off + 2 + len;
      while (i + 1 < bytes.length) {
        if (bytes[i] === 0xff && bytes[i + 1] !== 0x00 && !(bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7)) break;
        i++;
      }
      off = i;
      continue;
    }

    if (marker === 0xe1 && startsWithAscii(bytes, payloadStart, 'Exif\0\0')) { // EXIF
      const size = payloadEnd - off;
      const info = parseTiff(bytes, payloadStart + 6);
      add('exif', size, describeTiff(info));
      if (info) {
        if (info.gps) add('exif-gps', 0, info.gps);
        if (info.thumbnail) add('thumbnail', 0);
      }
    } else if (marker === 0xe1 && startsWithAscii(bytes, payloadStart, 'http://ns.adobe.com/xap/1.0/\0')) { // XMP
      add('xmp', payloadEnd - off);
    } else if (marker === 0xe2 && startsWithAscii(bytes, payloadStart, 'ICC_PROFILE\0')) { // ICC
      add('icc', payloadEnd - off);
    } else if (marker === 0xed && startsWithAscii(bytes, payloadStart, 'Photoshop 3.0\0')) { // IPTC/Photoshop IRB
      add('iptc', payloadEnd - off);
    } else if (marker === 0xfe) { // COM 注释
      const text = asciiAt(bytes, payloadStart, payloadEnd - payloadStart).trim();
      add('comment', payloadEnd - off, text ? text.slice(0, 60) : undefined);
    } else if (marker >= 0xe0 && marker <= 0xef && marker !== 0xe0) { // 其余 APPn
      appnSeen.push(`APP${marker - 0xe0}`);
    }
    // APP0(JFIF)、量化表、霍夫曼表、SOF 等与隐私无关，忽略

    off = off + 2 + len;
  }

  if (appnSeen.length) add('app-segment', 0, appnSeen.join(', '));
  return { container: 'jpeg', items };
}

/** PNG 元数据扫描 */
function scanPng(bytes) {
  const items = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8; // 跳过签名
  const add = (type, size, detail) => items.push({ type, size, detail });

  while (off + 8 <= bytes.length) {
    const chunkLen = dv.getUint32(off);
    const type = asciiAt(bytes, off + 4, 4);
    const dataStart = off + 8;
    if (dataStart + chunkLen + 4 > bytes.length) break;

    if (type === 'IEND') {
      const trailing = bytes.length - (dataStart + 4);
      if (trailing > 0) add('trailing', trailing);
      break;
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const keyword = asciiAt(bytes, dataStart, Math.min(chunkLen, 80)).split('\0')[0];
      add('png-text', chunkLen + 12, keyword || undefined);
    } else if (type === 'eXIf') {
      const tiffStart = startsWithAscii(bytes, dataStart, 'Exif\0\0') ? dataStart + 6 : dataStart;
      const info = parseTiff(bytes, tiffStart);
      add('exif', chunkLen + 12, describeTiff(info));
      if (info) {
        if (info.gps) add('exif-gps', 0, info.gps);
        if (info.thumbnail) add('thumbnail', 0);
      }
    }

    off = dataStart + chunkLen + 4; // 数据 + CRC
  }
  return { container: 'png', items };
}

/** WebP 元数据扫描 */
function scanWebp(bytes) {
  const items = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; // 'RIFF' + size + 'WEBP'
  const add = (type, size, detail) => items.push({ type, size, detail });

  while (off + 8 <= bytes.length) {
    const fourcc = asciiAt(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    const dataStart = off + 8;
    if (dataStart + size > bytes.length) break;

    if (fourcc === 'EXIF') {
      const tiffStart = startsWithAscii(bytes, dataStart, 'Exif\0\0') ? dataStart + 6 : dataStart;
      const info = parseTiff(bytes, tiffStart);
      add('exif', size + 8, describeTiff(info));
      if (info) {
        if (info.gps) add('exif-gps', 0, info.gps);
        if (info.thumbnail) add('thumbnail', 0);
      }
    } else if (fourcc === 'XMP ') {
      add('xmp', size + 8);
    } else if (fourcc === 'ICCP') {
      add('icc', size + 8);
    }

    off = dataStart + size + (size & 1); // RIFF 块按 2 字节对齐
  }
  return { container: 'webp', items };
}

/**
 * 扫描图片文件中的元数据。
 * @param {Uint8Array} bytes 文件内容
 * @param {string} [mime] 文件 MIME（可选，用于兜底识别）
 * @returns {{container:string, items:Array<{type:string,size:number,detail?:string}>,
 *            totalMetaBytes:number, hasGPS:boolean}}
 */
export function scanMetadata(bytes, mime) {
  let report;
  try {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) report = scanJpeg(bytes);
    else if (bytes.length >= 8 && pngSig.every((b, i) => bytes[i] === b)) report = scanPng(bytes);
    else if (bytes.length >= 12 && startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')) report = scanWebp(bytes);
    else report = { container: mime || 'unknown', items: [] };
  } catch {
    report = { container: 'unknown', items: [] };
  }

  // 子项（gps / thumbnail）不重复计入体积
  const totalMetaBytes = report.items.reduce((s, it) => s + (it.size || 0), 0);
  return {
    ...report,
    totalMetaBytes,
    hasGPS: report.items.some((it) => it.type === 'exif-gps'),
  };
}
