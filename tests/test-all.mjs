/**
 * 单元测试：metadata-scan.js + zip-writer.js + strip.js
 * 运行： node tests/test-all.mjs（或 npm test）
 * 物证合成图片在浏览器 E2E 中也会用到（/tmp/imc-fixtures）。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { scanMetadata } from '../assets/js/metadata-scan.js';
import { createZip, crc32 } from '../assets/js/zip-writer.js';
import { stripFileMeta } from '../assets/js/strip.js';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const enc = new TextEncoder();

// ---------------------------------------------------------------- TIFF 构造器
/** 构造小端 TIFF：两个 IFD（IFD0 + 指定的 GPS/Exif/缩略图 IFD），返回完整字节 */
function buildTiff() {
  // IFD0 条目：Make/Model/DateTime/ExifIFD→2/GPSIFD→3/nextIFD→4(缩略图)
  const ifd0 = [
    { tag: 0x010f, type: 2, str: 'Apple\0' },
    { tag: 0x0110, type: 2, str: 'iPhone 12\0' },
    { tag: 0x0132, type: 2, str: '2024:05:01 12:30:00\0' },
    { tag: 0x8769, type: 4, ifd: 1 },  // ExifIFD → ifds[1]
    { tag: 0x8825, type: 4, ifd: 2 },  // GPSIFD  → ifds[2]
  ];
  const exifIfd = [{ tag: 0x0131, type: 2, str: 'GIMP 2.10\0' }];
  const gpsIfd = [
    { tag: 0x0001, type: 2, str: 'N\0' },
    { tag: 0x0002, type: 5, rationals: [[31, 1], [13, 1], [4944, 100]] }, // 31°13′49.44″
    { tag: 0x0003, type: 2, str: 'E\0' },
    { tag: 0x0004, type: 5, rationals: [[121, 1], [28, 1], [4164, 100]] },
  ];
  const thumbIfd = [{ tag: 0x0103, type: 3, val: 6 }];

  const ifds = [ifd0, exifIfd, gpsIfd, thumbIfd];
  // 第一遍：算每个 IFD 的起始偏移（IFD0 永远在 8）
  const offsets = [8];
  for (let i = 1; i < ifds.length; i++) {
    const prev = ifds[i - 1];
    offsets.push(offsets[i - 1] + 2 + prev.length * 12 + 4);
  }
  const dataStart = offsets[ifds.length - 1] + 2 + ifds[ifds.length - 1].length * 12 + 4;

  // 第二遍：写字节。数据区追加式增长，字符串/有理数条目记偏移。
  const buf = new Uint8Array(4096);
  const dv = new DataView(buf.buffer);
  const u16 = (o, v) => dv.setUint16(o, v, true);
  const u32 = (o, v) => dv.setUint32(o, v, true);
  u16(0, 0x4949); u16(2, 42); u32(4, 8);

  let dataPtr = dataStart;
  ifds.forEach((entries, idx) => {
    const base = offsets[idx];
    u16(base, entries.length);
    entries.forEach((e, i) => {
      const p = base + 2 + i * 12;
      u16(p, e.tag); u16(p + 2, e.type);
      if (e.type === 2) {
        const bytes = enc.encode(e.str);
        u32(p + 4, bytes.length);
        if (bytes.length <= 4) buf.set(bytes, p + 8);
        else { u32(p + 8, dataPtr); buf.set(bytes, dataPtr); dataPtr += bytes.length; }
      } else if (e.type === 5) {
        u32(p + 4, e.rationals.length * 2);
        u32(p + 8, dataPtr);
        for (const [n, d] of e.rationals) {
          u32(dataPtr, n); u32(dataPtr + 4, d); dataPtr += 8;
        }
      } else if ('ifd' in e) {
        u32(p + 4, 1); u32(p + 8, offsets[e.ifd]);
      } else {
        u32(p + 4, 1);
        if (e.type === 3) u16(p + 8, e.val);
        else u32(p + 8, e.val);
      }
    });
    // 指向下一个 IFD（最后一个的中继→缩略图 IFD，其余→0）
    u32(base + 2 + entries.length * 12, idx === 0 ? offsets[3] : 0);
  });

  const out = buf.slice(0, dataPtr);
  // 自洽性断言
  const dv2 = new DataView(out.buffer);
  ok(dv2.getUint16(0, true) === 0x4949 && dv2.getUint32(4, true) === 8, 'TIFF 头自洽（II + IFD0@8）');
  return out;
}

/** 合成 JPEG：EXIF + XMP + IPTC + COMMENT + APP4 + 压缩数据 + 尾部隐藏数据 */
function buildJpeg(tiff) {
  const seg = (marker, payload) => [
    0xff, marker,
    (payload.length + 2) >> 8, (payload.length + 2) & 0xff,
    ...payload,
  ];
  const bytes = [
    0xff, 0xd8,
    ...seg(0xe0, enc.encode('JFIF\0\x01\x01\x01\x00\x60\x00\x60\x00\x00')),       // APP0 常规、应忽略
    ...seg(0xe1, [...enc.encode('Exif\0\0'), ...tiff]),                           // EXIF
    ...seg(0xe1, [...enc.encode('http://ns.adobe.com/xap/1.0/\0'), ...enc.encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf/></x:xmpmeta>')]), // XMP
    ...seg(0xed, [...enc.encode('Photoshop 3.0\0'), ...new Array(24).fill(0xab)]), // IPTC 段
    ...seg(0xe4, new Array(18).fill(0x7c)),                                        // APP4 其他应用段
    ...seg(0xfe, enc.encode('Uploaded by SecretApp 1.0')),                         // COM 注释
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,                     // SOS 头
    ...new Array(64).fill(0x7f),                                                  // “压缩数据”
    0xff, 0xd9,                                                                   // EOI
    ...enc.encode('LEAK: hidden payload after EOI'),                              // 尾部隐藏数据
  ];
  return new Uint8Array(bytes);
}

/** 合成 PNG：tEXt + eXIf + 尾部数据 */
function buildPng(tiff) {
  const chunk = (type, data) => {
    const len = (data.length >>> 24) & 0xff | 0; // 占位防误用
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length, false);
    head.set(enc.encode(type), 4);
    const crcBuf = new Uint8Array(head.length + data.length);
    crcBuf.set(head); crcBuf.set(data, 8);
    let c = crc32(crcBuf);
    const crc = new Uint8Array([(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff]);
    return [...crcBuf, ...crc];
  };
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,                                // PNG 签名
    ...chunk('IHDR', new Uint8Array([0, 0, 0, 16, 0, 0, 0, 10, 8, 6, 0, 0, 0])),
    ...chunk('tEXt', enc.encode('Comment\0Created by test-fixture')),
    ...chunk('eXIf', tiff),
    ...chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x00, 0x00, 0x0b, 0x31, 0x02, 0x8f])),
    ...chunk('IEND', new Uint8Array()),
    ...enc.encode('TRAILING-AFTER-IEND'),
  ];
  return new Uint8Array(bytes);
}

/** 合成 WebP：EXIF + XMP + ICCP */
function buildWebp(tiff) {
  const chunk = (fourcc, data) => {
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, data.length, true);
    return [...enc.encode(fourcc), ...size, ...data, ...(data.length % 2 ? [0] : [])];
  };
  const payload = [
    ...enc.encode('WEBP'),
    ...chunk('EXIF', [...enc.encode('Exif\0\0'), ...tiff]),
    ...chunk('XMP ', enc.encode('<x:xmpmeta/>')),
    ...chunk('ICCP', new Array(32).fill(0x5a)),
    ...chunk('VP8 ', new Array(20).fill(0x33)),
  ];
  const riffSize = new Uint8Array(4);
  new DataView(riffSize.buffer).setUint32(0, payload.length, true);
  return new Uint8Array([...enc.encode('RIFF'), ...riffSize, ...payload]);
}

// ---------------------------------------------------------------- 执行

// 先落盘物证（后面的调试脚本要用）
mkdirSync('/tmp/imc-fixtures', { recursive: true });

console.log('\n[0] 产出测试图片文件（供浏览器 E2E / 调试使用）');
{
  const tiff0 = buildTiff();
  writeFileSync('/tmp/imc-fixtures/meta-full.jpg', buildJpeg(tiff0));
  writeFileSync('/tmp/imc-fixtures/meta-full.png', buildPng(tiff0));
  writeFileSync('/tmp/imc-fixtures/meta-full.webp', buildWebp(tiff0));
  console.log('  → /tmp/imc-fixtures/{meta-full.jpg, meta-full.png, meta-full.webp}');
}

console.log('\n[1] TIFF/JPEG 扫描');
{
  const tiff = buildTiff();
  const jpeg = buildJpeg(tiff);
  const r = scanMetadata(jpeg, 'image/jpeg');
  const types = r.items.map((i) => i.type);
  ok(r.container === 'jpeg', '识别为 JPEG');
  ok(types.includes('exif'), '发现 EXIF 段');
  const exif = r.items.find((i) => i.type === 'exif');
  ok(exif && /Apple/.test(exif.detail || '') && /iPhone 12/.test(exif.detail || ''), '解析出相机品牌/型号', exif?.detail);
  ok(exif && /2024:05:01/.test(exif.detail || ''), '解析出拍摄时间', exif?.detail);
  ok(r.hasGPS && types.includes('exif-gps'), '发现 GPS 定位');
  const gps = r.items.find((i) => i.type === 'exif-gps');
  ok(gps && gps.detail === '31.23040°, 121.47823°', 'GPS 坐标 DMS 换算正确', gps?.detail);
  ok(types.includes('thumbnail'), '发现内嵌缩略图（IFD1）');
  ok(types.includes('xmp'), '发现 XMP');
  ok(types.includes('iptc'), '发现 IPTC/Photoshop');
  ok(types.includes('comment'), '发现 COM 注释');
  ok(types.includes('app-segment'), '发现其他 APP 段');
  ok(types.includes('trailing'), '发现 EOI 后隐藏数据');
  ok(r.totalMetaBytes > 200, `元数据总体积 > 200B（实际 ${r.totalMetaBytes}）`);
  ok(!types.includes('jfif'), 'JFIF APP0 不误报为元数据');
}

console.log('\n[2] PNG 扫描');
{
  const png = buildPng(buildTiff());
  const r = scanMetadata(png, 'image/png');
  const types = r.items.map((i) => i.type);
  ok(r.container === 'png', '识别为 PNG');
  ok(types.includes('png-text'), '发现 PNG 文本块');
  ok(r.items.find((i) => i.type === 'png-text')?.detail === 'Comment', '文本块 keyword 正确');
  ok(types.includes('exif'), '解析 PNG eXIf 块中的 EXIF');
  ok(types.includes('trailing'), '发现 IEND 后隐藏数据');
}

console.log('\n[3] WebP 扫描');
{
  const webp = buildWebp(buildTiff());
  const r = scanMetadata(webp, 'image/webp');
  const types = r.items.map((i) => i.type);
  ok(r.container === 'webp', '识别为 WebP');
  ok(types.includes('exif') && types.includes('xmp') && types.includes('icc'), '发现 EXIF/XMP/ICC 块');
  ok(r.items.find((i) => i.type === 'exif')?.detail?.includes('iPhone'), 'WebP EXIF 相机信息正确');
}

console.log('\n[4] 干净图片与畸形输入（不抛异常）');
{
  const cleanJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  const r = scanMetadata(cleanJpeg);
  ok(r.items.length === 0, '干净 JPEG 零元数据', JSON.stringify(r.items));
  const truncated = scanMetadata(buildJpeg(buildTiff()).slice(0, 30));
  ok(Array.isArray(truncated.items), '截断文件不抛异常且返回结构化结果');
  const garbage = scanMetadata(new Uint8Array(1000).map((_, i) => (i * 37) % 256));
  ok(garbage.container === 'unknown' && garbage.items.length === 0, '随机字节识别为 unknown');
}

console.log('\n[5] ZIP 写入器');
{
  ok(crc32(enc.encode('123456789')) === 0xcbf43926, 'CRC32 标准测试向量');
  ok(crc32(new Uint8Array()) === 0, 'CRC32 空输入为 0');

  const zip = await createZip([
    { name: 'photo.jpg', data: enc.encode('jpeg-bytes-ⓐ') },
    { name: '照片-2.png', data: new Uint8Array([0, 1, 2, 255, 128]) },
    { name: 'empty.bin', data: new Uint8Array() },
  ]);
  const buf = new Uint8Array(await zip.arrayBuffer());
  ok(zip.type === 'application/zip', 'ZIP MIME 正确');
  ok(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04, 'ZIP 本地文件头魔数');

  // 落到磁盘：系统 unzip 看结构，python zipfile 校验 UTF-8 名与内容
  writeFileSync('/tmp/imc-fixtures/out.zip', buf);
  const list = execSync('/usr/bin/unzip -l /tmp/imc-fixtures/out.zip').toString();
  for (const n of ['photo.jpg', 'empty.bin']) ok(list.includes(n), `unzip 能列出 ${n}`);
  execSync('/usr/bin/unzip -oq /tmp/imc-fixtures/out.zip -d /tmp/imc-fixtures/unzipped photo.jpg empty.bin');
  const py = execSync(`python3 -c "
import zipfile
z = zipfile.ZipFile('/tmp/imc-fixtures/out.zip')
names = z.namelist()
assert '照片-2.png' in names, names
data = z.read('照片-2.png').hex()
print(names, data)
"`).toString().trim();
  ok(py.includes('照片-2.png') && py.includes('000102ff80'), 'python zipfile 可读取 UTF-8 名且内容逐字节一致', py);
}

console.log('\n[6] 完成');

console.log('\n[7] 编码后强制剥离 strip.js');
{
  const jpeg = new Uint8Array(readFileSync('/tmp/imc-fixtures/meta-full.jpg'));
  const stripped = stripFileMeta(jpeg, 'image/jpeg');
  ok(stripped[0] === 0xff && stripped[1] === 0xd8, 'JPEG 剥离后仍以 SOI 开头');
  ok(stripped[stripped.length - 2] === 0xff && stripped[stripped.length - 1] === 0xd9, 'JPEG 剥离后以 EOI 结尾');
  ok(stripped.length < jpeg.length, `JPEG 剥离后更小（${jpeg.length} → ${stripped.length}）`);
  ok(scanMetadata(stripped).items.length === 0, 'JPEG 剥离后零元数据', JSON.stringify(scanMetadata(stripped).items));
  ok(stripFileMeta(stripped, 'image/jpeg').length === stripped.length, 'JPEG 剥离幂等');
}
{
  const png = new Uint8Array(readFileSync('/tmp/imc-fixtures/meta-full.png'));
  const stripped = stripFileMeta(png, 'image/png');
  ok(stripped.length < png.length, `PNG 剥离后更小（${png.length} → ${stripped.length}）`);
  ok(scanMetadata(stripped).items.length === 0, 'PNG 剥离后零元数据', JSON.stringify(scanMetadata(stripped).items));
  const dv = new DataView(stripped.buffer);
  ok(String.fromCharCode(...stripped.slice(12, 16)) === 'IHDR', 'PNG IHDR 块保留');
  ok(stripFileMeta(stripped, 'image/png').length === stripped.length, 'PNG 剥离幂等');
}
{
  const webp = new Uint8Array(readFileSync('/tmp/imc-fixtures/meta-full.webp'));
  const stripped = stripFileMeta(webp, 'image/webp');
  ok(stripped.length < webp.length, `WebP 剥离后更小（${webp.length} → ${stripped.length}）`);
  ok(scanMetadata(stripped).items.length === 0, 'WebP 剥离后零元数据', JSON.stringify(scanMetadata(stripped).items));
  const dv = new DataView(stripped.buffer);
  ok(dv.getUint32(4, true) === stripped.length - 8, 'WebP RIFF 尺寸已重算');
  ok(String.fromCharCode(...stripped.slice(12, 16)).trim() === 'VP8', 'WebP 图像块保留');
  ok(stripFileMeta(stripped, 'image/webp').length === stripped.length, 'WebP 剥离幂等');
}
{
  const garbage = new Uint8Array(512).map((_, i) => i % 256);
  ok(stripFileMeta(garbage, 'image/jpeg').length === garbage.length, '畸形输入原样返回');
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
