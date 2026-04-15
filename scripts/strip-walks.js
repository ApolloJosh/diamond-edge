// strip-walks.js — One-time migration to remove the now-defunct walks prediction
// from every historical result JSON (and matching snapshot, if present).
//
// Removes from each /results/YYYY-MM-DD.json:
//   - top-level `walks` array
//   - summary.walkHitRate, summary.bGradeWalks
//
// Removes from each /snapshots/YYYY-MM-DD.json:
//   - top-level `walks` array
//
// Usage: node scripts/strip-walks.js

const fs = require('fs');
const path = require('path');

const resultsDir = path.join(__dirname, '..', 'results');
const snapshotDir = path.join(__dirname, '..', 'snapshots');
const indexPath = path.join(resultsDir, 'index.json');

let index = [];
if (fs.existsSync(indexPath)) {
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) {}
}

if (!Array.isArray(index) || index.length === 0) {
  console.log('No results/index.json found or empty. Nothing to migrate.');
  process.exit(0);
}

let resultsPatched = 0, snapshotsPatched = 0;
for (const dateStr of index) {
  // Patch result file
  const resultsPath = path.join(resultsDir, dateStr + '.json');
  if (fs.existsSync(resultsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      let changed = false;
      if ('walks' in data) { delete data.walks; changed = true; }
      if (data.summary && 'walkHitRate' in data.summary) { delete data.summary.walkHitRate; changed = true; }
      if (data.summary && 'bGradeWalks' in data.summary) { delete data.summary.bGradeWalks; changed = true; }
      if (changed) {
        fs.writeFileSync(resultsPath, JSON.stringify(data, null, 2));
        resultsPatched++;
        console.log(`  Patched results/${dateStr}.json`);
      }
    } catch (e) {
      console.warn(`  Skipped results/${dateStr}.json (parse error): ${e.message}`);
    }
  }

  // Patch snapshot file
  const snapshotPath = path.join(snapshotDir, dateStr + '.json');
  if (fs.existsSync(snapshotPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      if ('walks' in snap) {
        delete snap.walks;
        fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
        snapshotsPatched++;
        console.log(`  Patched snapshots/${dateStr}.json`);
      }
    } catch (e) {
      console.warn(`  Skipped snapshots/${dateStr}.json (parse error): ${e.message}`);
    }
  }
}

console.log(`\nDone. Results patched: ${resultsPatched}. Snapshots patched: ${snapshotsPatched}.`);
