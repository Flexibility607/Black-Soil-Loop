import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = join(projectRoot, 'dist');
const frontendDir = join(projectRoot, 'frontdesign-v1');
const mockDir = join(projectRoot, 'frontend-mocks-v0.1');
const includeDemoFixtures = process.argv.includes('--demo');

const mockFiles = includeDemoFixtures ? (await readdir(mockDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort() : [];

if (includeDemoFixtures && mockFiles.length === 0) {
  throw new Error('No Mock JSON files were found.');
}

if (includeDemoFixtures) await Promise.all(
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
await mkdir(outputDir, { recursive: true });
await cp(frontendDir, outputDir, {
  recursive: true,
  filter: (source) => !source.includes(`${join(frontendDir, 'tests')}`) && !source.endsWith('README.md'),
});

if (includeDemoFixtures) {
  await mkdir(join(outputDir, 'frontend-mocks-v0.1'), { recursive: true });
  await Promise.all(mockFiles.map((name) => copyFile(join(mockDir, name), join(outputDir, 'frontend-mocks-v0.1', name))));
}
await writeFile(
  join(outputDir, 'runtime-config.js'),
  `window.BLACKSOIL_CONFIG = Object.freeze({ apiBase: 'https://api.flexibility607.cn/api/v1', demo: ${includeDemoFixtures} });\n`,
  'utf8',
);

await mkdir(join(outputDir, 'vendor', 'echarts'), { recursive: true });
await copyFile(join(projectRoot, 'node_modules', 'echarts', 'dist', 'echarts.min.js'), join(outputDir, 'vendor', 'echarts', 'echarts.min.js'));

const fonts = [
  { packageName: '@fontsource-variable/noto-sans-sc', css: 'index.css', outputName: 'noto-sans-sc' },
  { packageName: '@fontsource/zcool-qingke-huangyou', css: '400.css', outputName: 'zcool-qingke-huangyou' },
  { packageName: '@fontsource-variable/jetbrains-mono', css: 'index.css', outputName: 'jetbrains-mono' },
];
for (const font of fonts) {
  const source = join(projectRoot, 'node_modules', ...font.packageName.split('/'));
  const target = join(outputDir, 'vendor', 'fonts', font.outputName);
  await mkdir(target, { recursive: true });
  await copyFile(join(source, font.css), join(target, font.css));
  await cp(join(source, 'files'), join(target, 'files'), { recursive: true });
}

console.log(`Cloudflare assets ready: production API, local ECharts, ${fonts.length} local fonts, demo fixtures: ${includeDemoFixtures ? mockFiles.length : 0}.`);
