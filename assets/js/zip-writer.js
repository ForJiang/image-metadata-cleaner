/**
 * 极简 ZIP 打包器（store 模式，无压缩）
 *
 * 图片/音频等已压缩数据再走 deflate 收益极小，store 模式体积几乎不变，
 * 实现却足够简单可靠：CRC32 + 本地文件头 + 中央目录 + EOCD。
 * 纯函数、零依赖，可在 Node 中测试。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  constructor() { this.parts = []; this.length = 0; }
  u16(v) { this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])); this.length += 2; }
  u32(v) { this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])); this.length += 4; }
  raw(bytes) { this.parts.push(bytes); this.length += bytes.length; }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const p of this.parts) { out.set(p, off); off += p.length; }
    return out;
  }
}

/** MS-DOS 日期时间 */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * 把若干文件打成 ZIP Blob。
 * @param {Array<{name:string, data:Uint8Array}>} entries 文件名用 UTF-8
 * @returns {Promise<Blob>} application/zip
 */
export async function createZip(entries) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime();
  const out = new ByteWriter();
  const central = new ByteWriter();
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const utf8Flag = 0x0800; // 文件名是 UTF-8

    // 本地文件头
    out.u32(0x04034b50);
    out.u16(20);          // 需要的版本
    out.u16(utf8Flag);    // 通用标志
    out.u16(0);           // 存储，无压缩
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(data.length); // 压缩后大小
    out.u32(data.length); // 原始大小
    out.u16(nameBytes.length);
    out.u16(0);           // 额外字段长度
    out.raw(nameBytes);
    out.raw(data);

    // 中央目录记录
    central.u32(0x02014b50);
    central.u16(20);          // 制作版本
    central.u16(20);          // 需要的版本
    central.u16(utf8Flag);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(nameBytes.length);
    central.u16(0);           // 额外字段
    central.u16(0);           // 注释
    central.u16(0);           // 磁盘号
    central.u16(0);           // 内部属性
    central.u32(0);           // 外部属性
    central.u32(offset);      // 本地头偏移
    central.raw(nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralBytes = central.toUint8Array();
  out.raw(centralBytes);

  // EOCD
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralBytes.length);
  out.u32(offset);
  out.u16(0);

  return new Blob([out.toUint8Array()], { type: 'application/zip' });
}
