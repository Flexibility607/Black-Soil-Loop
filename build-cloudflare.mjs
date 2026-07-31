import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = join(projectRoot, 'dist');
const frontendDir = join(projectRoot, 'frontdesign-v1');
const mockDir = join(projectRoot, 'frontend-mocks-v0.1');
const frontendFiles = ['index.html', 'styles.css', 'api.js', 'scripts.js'];

const mockFiles = (await readdir(mockDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();

if (mockFiles.length === 0) {
  throw new Error('No Mock JSON files were found.');
}

await Promise.all(
  mockFiles.map(async (name) => {
    const content = await readFile(join(mockDir, name), 'utf8');
    const payload = JSON.parse(content);
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) {
      throw new Error(`${name} is not a valid Mock response envelope.`);
    }
  }),
);

if (dirname(outputDir) !== projectRoot || basename(outputDir) !== 'dist') {
  throw new Error('Refusing to clean an unexpected output directory.');
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(join(outputDir, 'frontend-mocks-v0.1'), { recursive: true });

await Promise.all(
  frontendFiles.map((name) => copyFile(join(frontendDir, name), join(outputDir, name))),
);

await Promise.all(
  mockFiles.map((name) => copyFile(join(mockDir, name), join(outputDir, 'frontend-mocks-v0.1', name))),
);

console.log(`Cloudflare assets ready: ${frontendFiles.length} frontend files, ${mockFiles.length} Mock files.`);
