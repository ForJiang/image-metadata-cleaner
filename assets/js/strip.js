/**
 * 编码后强制剥离（hard strip）
 *
 * Canvas 重编码理论上不带入任何元数据，但个别浏览器（如 Safari）的编码器
 * 会自行嵌入 ICC 色彩配置等段。这里对编码结果再做一次“物理拆除”：
 * 只保留与图像数据直接相关的段/块，其余全部丢弃，从字节层面保证零残留。
 *
 * 纯函数、零依赖、任何异常都原样返回（宁可少剥也不错剪）。
 */

function jpegMarkerNoLength(m) {
  return m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7); // SOI/TEM/RSTn
}

/** JPEG：丢弃所有 APPn（E0–EF）与 COM（FE）段，以及 EOI 之后的任何字节 */
export function stripJpegMeta(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
    const parts = [new Uint8Array([0xff, 0xd8])];
    let off = 2;
    while (off + 4 <= bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      if (jpegMarkerNoLength(marker)) { off += 2; continue; }
      const len = dv.getUint16(off + 2);
      if (len < 2 || off + 2 + len > bytes.length) break;

      if (marker === 0xd9) break; // EOI：到此为止，之后的尾随数据一并丢弃
      if (marker === 0xda) {
        // SOS：段头 + 熵编码数据，一直到下一个标记
        let i = off + 2 + len;
        while (i + 1 < bytes.length) {
          if (bytes[i] === 0xff && bytes[i + 1] !== 0x00 && !(bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7)) break;
          i++;
        }
        parts.push(bytes.subarray(off, i));
        off = i;
        continue;
      }
      const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
      if (!isMeta) parts.push(bytes.subarray(off, off + 2 + len));
      off += 2 + len;
    }
    if (!parts.some((p) => p.length >= 2 && p[0] === 0xff && p[1] === 0xd9)) parts.push(new Uint8Array([0xff, 0xd9]));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.length ? out : bytes;
  } catch {
    return bytes;
  }
}

/** PNG：丢弃 tEXt / zTXt / iTXt / eXIf 文本与 EXIF 块，以及 IEND 之后的字节 */
export function stripPngMeta(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8) return bytes;
    const parts = [bytes.subarray(0, 8)];
    let off = 8;
    while (off + 8 <= bytes.length) {
      const chunkLen = dv.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      const end = off + 8 + chunkLen + 4;
      if (end > bytes.length) break;
      if (type === 'IEND') { parts.push(bytes.subarray(off, end)); break; }
      const isMeta = type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'eXIf';
      if (!isMeta) parts.push(bytes.subarray(off, end));
      off = end;
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.length >= 8 ? out : bytes;
  } catch {
    return bytes;
  }
}

/** WebP：丢弃 EXIF / XMP / ICCP 块并重算 RIFF 尺寸 */
export function stripWebpMeta(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) return bytes;
    const parts = [bytes.subarray(0, 12)]; // RIFF 头 + 'WEBP'
    let off = 12;
    while (off + 8 <= bytes.length) {
      const fourcc = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
      const size = dv.getUint32(off + 4, true);
      const end = off + 8 + size + (size & 1);
      if (end > bytes.length) break;
      const isMeta = fourcc === 'EXIF' || fourcc === 'XMP ' || fourcc === 'ICCP';
      if (!isMeta) parts.push(bytes.subarray(off, end));
      off = end;
    }
    if (parts.length === 1) return bytes;
    let total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    new DataView(out.buffer).setUint32(4, out.length - 8, true); // RIFF 尺寸 = 文件长 - 8
    return out.length >= 12 ? out : bytes;
  } catch {
    return bytes;
  }
}

/** 按 MIME 选择卸载后剥离函数 */
export function stripFileMeta(bytes, mime) {
  if (mime === 'image/jpeg') return stripJpegMeta(bytes);
  if (mime === 'image/png') return stripPngMeta(bytes);
  if (mime === 'image/webp') return stripWebpMeta(bytes);
  return bytes;
}
