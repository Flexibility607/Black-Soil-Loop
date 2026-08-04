import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(projectRoot, 'frontdesign-v1', 'assets', 'backgrounds', 'northeast-winter-corn-v1.png');
const output = join(projectRoot, 'frontdesign-v1', 'assets', 'backgrounds', 'northeast-winter-corn-v1.webp');

await mkdir(dirname(output), { recursive: true });
await sharp(source)
  .resize(1920, 1080, { fit: 'cover', position: 'center' })
  .webp({ quality: 82, effort: 6, smartSubsample: true })
  .toFile(output);

console.log(`Optimized dashboard background: ${output}`);
