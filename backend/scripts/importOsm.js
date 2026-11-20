// Usage (from /backend):  npm run import:osm
//   optional:  npm run import:osm -- --bbox=12.88,79.06,13.03,79.22
// Needs MONGO_URI in .env. Safe to re-run: ratings are kept.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const RoadSegment = require('../models/RoadSegment');
const { fetchArea, buildSegments } = require('../services/osmImport');

const DEFAULT_BBOX = [12.89, 79.08, 13.01, 79.20]; // Vellore + Katpadi + VIT  (south, west, north, east)

(async () => {
  const arg = process.argv.find((a) => a.startsWith('--bbox='));
  const bbox = arg ? arg.slice(7).split(',').map(Number) : DEFAULT_BBOX;
  if (bbox.length !== 4 || bbox.some(Number.isNaN)) throw new Error('bbox must be south,west,north,east');

  await mongoose.connect(process.env.MONGO_URI);
  const { ways, feats } = await fetchArea(bbox);
  const segs = buildSegments(ways, feats);
  console.log(`[OSM] built ${segs.length} road segments`);

  const ops = segs.map((s) => ({
    updateOne: {
      filter: { key: s.key },
      update: { $set: { ...s, osmFetchedAt: new Date() }, $setOnInsert: { ratingSum: 0, ratingCount: 0 } },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 1000) {
    await RoadSegment.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    process.stdout.write(`\r[OSM] saved ${Math.min(i + 1000, ops.length)}/${ops.length}`);
  }
  console.log('\n[OSM] done');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
