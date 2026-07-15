import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const assets = [
  {
    file: 'public/logo-dnpharma.png',
    sha256: 'c5d9986df442c45a8af1ef78550d026626435940a4fa4e8d3404c4066838134e',
    width: 640,
    height: 369,
  },
  {
    file: 'public/zalo-oa-qr.png',
    sha256: '6cb1d84d853263c54d996742612b220d2aee21ad547959f2af55d0778b7986af',
    width: 420,
    height: 418,
  },
];

for (const asset of assets) {
  const buf = readFileSync(new URL(`../${asset.file}`, import.meta.url));
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`${asset.file}: không phải PNG hợp lệ`);
  const width = buf.readUInt32BE(16); const height = buf.readUInt32BE(20);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  if (width !== asset.width || height !== asset.height || sha256 !== asset.sha256) {
    throw new Error(`${asset.file}: asset thương hiệu đã thay đổi; cần CEO duyệt lại trước khi build`);
  }
  console.log(`✓ official asset ${asset.file} ${width}x${height} sha256=${sha256}`);
}
