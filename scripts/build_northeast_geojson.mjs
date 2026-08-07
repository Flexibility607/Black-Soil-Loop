import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shapefile from 'shapefile';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceBase = join(projectRoot, '.natural-earth-50m', 'ne_50m_admin_1_states_provinces');
const outputPath = join(projectRoot, 'frontdesign-v1', 'assets', 'maps', 'northeast-china-admin1.geojson');
const wanted = new Map([
  ['Heilongjiang', '黑龙江省'],
  ['Jilin', '吉林省'],
  ['Liaoning', '辽宁省'],
]);

function clean(value) {
  return typeof value === 'string' ? value.replaceAll('\0', '').trim() : value;
}

const source = await shapefile.open(`${sourceBase}.shp`, `${sourceBase}.dbf`, { encoding: 'utf-8' });
const features = [];

for (;;) {
  const result = await source.read();
  if (result.done) break;
  const properties = result.value.properties || {};
  const englishName = clean(properties.name_en || properties.name || properties.NAME_1);
  const admin = clean(properties.admin || properties.adm0_name || properties.ADMIN);
  if ((admin !== 'China' && properties.adm0_a3 !== 'CHN') || !wanted.has(englishName)) continue;
  features.push({
    type: 'Feature',
    properties: {
      name: wanted.get(englishName),
      name_en: englishName,
      iso_3166_2: clean(properties.iso_3166_2) || null,
      source: 'Natural Earth Admin-1 1:50m',
    },
    geometry: result.value.geometry,
  });
}

if (features.length !== 3) {
  throw new Error(`Expected three northeast provinces, found ${features.length}.`);
}

const payload = {
  type: 'FeatureCollection',
  name: 'northeast_china_admin1',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
  source: {
    title: 'Natural Earth Admin 1 - States, Provinces',
    scale: '1:50m',
    url: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-1-states-provinces/',
    license: 'Public domain',
  },
  features,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');

const saved = JSON.parse(await readFile(outputPath, 'utf8'));
console.log(`Wrote ${saved.features.length} provinces to ${outputPath}.`);
