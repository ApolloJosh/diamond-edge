// patch-results.js — One-time script to reprocess all existing results files
// Re-fetches box scores and recalculates summaries with:
//   - DNP players excluded from hit rate denominators
//   - Walk data added (if snapshots contain walks)
//   - Consistent summary math across all dates
//
// Usage: node scripts/patch-results.js
//   Processes every date listed in results/index.json

const BASE = "https://statsapi.mlb.com/api/v1";
const fs = require('fs');
const path = require('path');

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) return {};
  return resp.json();
}

async function getGameBoxScore(gamePk) {
  return await fetchJSON(BASE + "/game/" + gamePk + "/boxscore");
}

function computeFantasyScore(stats) {
  let score = 0;
  const hits = parseInt(stats.hits) || 0;
  const doubles = parseInt(stats.doubles) || 0;
  const triples = parseInt(stats.triples) || 0;
  const homeRuns = parseInt(stats.homeRuns) || 0;
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  score += singles * 3;
  score += doubles * 5;
  score += triples * 8;
  score += homeRuns * 10;
  score += (parseInt(stats.runs) || 0) * 2;
  score += (parseInt(stats.rbi) || 0) * 2;
  score += (parseInt(stats.baseOnBalls) || 0) * 2;
  score += (parseInt(stats.hitByPitch) || 0) * 2;
  score += (parseInt(stats.stolenBases) || 0) * 5;
  return score;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function patchDate(dateStr) {
  const snapshotDir = path.join(__dirname, '..', 'snapshots');
  const resultsDir = path.join(__dirname, '..', 'results');
  const snapshotPath = path.join(snapshotDir, dateStr + '.json');

  if (!fs.existsSync(snapshotPath)) {
    console.log(`  [${dateStr}] No snapshot found — skipping`);
    return false;
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  console.log(`  [${dateStr}] Snapshot: ${snapshot.batters.length} batters, ${snapshot.pitchers.length} pitchers, ${(snapshot.walks || []).length} walks`);

  // Collect unique game PKs
  const uniqueGamePks = new Set();
  for (const b of snapshot.batters) uniqueGamePks.add(b.gamePk);
  for (const p of snapshot.pitchers) uniqueGamePks.add(p.gamePk);
  for (const w of (snapshot.walks || [])) uniqueGamePks.add(w.gamePk);

  // Fetch box scores
  const boxScores = {};
  for (const gamePk of uniqueGamePks) {
    boxScores[gamePk] = await getGameBoxScore(gamePk);
    await delay(200); // be nice to MLB API
  }

  // --- BATTERS ---
  const resultBatters = [];
  for (const batter of snapshot.batters) {
    const boxScore = boxScores[batter.gamePk];
    if (!boxScore || !boxScore.teams) continue;

    let batterFound = null;
    for (const teamKey in boxScore.teams) {
      const team = boxScore.teams[teamKey];
      const playerKey = "ID" + batter.batterId;
      if (team.players && team.players[playerKey]) {
        const playerData = team.players[playerKey];
        if (playerData.stats && playerData.stats.batting) {
          batterFound = playerData.stats.batting;
        }
        break;
      }
    }

    const hits = batterFound ? (parseInt(batterFound.hits) || 0) : 0;
    const ab = batterFound ? (parseInt(batterFound.atBats) || 0) : 0;
    const fantasyScore = batterFound ? computeFantasyScore(batterFound) : 0;

    resultBatters.push({
      batterId: batter.batterId,
      batterName: batter.batterName,
      pitcherName: batter.pitcherName,
      pitcherId: batter.pitcherId,
      batterTeam: batter.batterTeam,
      pitcherTeam: batter.pitcherTeam || "",
      edgeScore: batter.edgeScore,
      grade: batter.grade,
      bvpAvg: batter.bvpAvg,
      bvpOps: batter.bvpOps,
      gamePk: batter.gamePk,
      gameLabel: batter.gameLabel,
      actualLine: batterFound ? `${hits}-${ab}` : "DNP",
      hits: hits,
      ab: ab,
      fantasyScore: fantasyScore,
      actualStats: batterFound
    });
  }

  // --- PITCHERS ---
  const resultPitchers = [];
  for (const pitcher of snapshot.pitchers) {
    const boxScore = boxScores[pitcher.gamePk];
    if (!boxScore || !boxScore.teams) continue;

    let pitcherFound = null;
    for (const teamKey in boxScore.teams) {
      const team = boxScore.teams[teamKey];
      const playerKey = "ID" + pitcher.pitcherId;
      if (team.players && team.players[playerKey]) {
        const playerData = team.players[playerKey];
        if (playerData.stats && playerData.stats.pitching) {
          pitcherFound = playerData.stats.pitching;
        }
        break;
      }
    }

    const actualK = pitcherFound ? (parseInt(pitcherFound.strikeOuts) || 0) : 0;
    const actualIP = pitcherFound ? (pitcherFound.inningsPitched || "0.0") : "0.0";
    const actualER = pitcherFound ? (parseInt(pitcherFound.earnedRuns) || 0) : 0;
    const actualH = pitcherFound ? (parseInt(pitcherFound.hits) || 0) : 0;
    const actualBB = pitcherFound ? (parseInt(pitcherFound.baseOnBalls) || 0) : 0;
    const hitProj = pitcherFound ? (actualK >= pitcher.projectedK) : false;

    resultPitchers.push({
      pitcherId: pitcher.pitcherId,
      pitcherName: pitcher.pitcherName,
      team: pitcher.team,
      oppTeam: pitcher.oppTeam,
      whiffScore: pitcher.whiffScore,
      grade: pitcher.grade,
      k9: pitcher.k9,
      projectedK: pitcher.projectedK,
      gamePk: pitcher.gamePk,
      gameLabel: pitcher.gameLabel,
      actualK: actualK,
      actualIP: actualIP,
      actualER: actualER,
      actualH: actualH,
      actualBB: actualBB,
      hitProj: hitProj,
      actualStats: pitcherFound ? true : null
    });
  }

  // --- WALKS ---
  const resultWalks = [];
  for (const walk of (snapshot.walks || [])) {
    const boxScore = boxScores[walk.gamePk];
    if (!boxScore || !boxScore.teams) continue;

    let walkFound = null;
    for (const teamKey in boxScore.teams) {
      const team = boxScore.teams[teamKey];
      const playerKey = "ID" + walk.batterId;
      if (team.players && team.players[playerKey]) {
        const playerData = team.players[playerKey];
        if (playerData.stats && playerData.stats.batting) {
          walkFound = playerData.stats.batting;
        }
        break;
      }
    }

    const actualBB = walkFound ? (parseInt(walkFound.baseOnBalls) || 0) : 0;

    resultWalks.push({
      batterId: walk.batterId,
      batterName: walk.batterName,
      pitcherId: walk.pitcherId || 0,
      pitcherName: walk.pitcherName || "",
      batterTeam: walk.batterTeam,
      pitcherTeam: walk.pitcherTeam || "",
      walkScore: walk.walkScore,
      bvpBB: walk.bvpBB || 0,
      bvpPA: walk.bvpPA || 0,
      bvpBBRate: walk.bvpBBRate || 0,
      gamePk: walk.gamePk,
      gameLabel: walk.gameLabel,
      actualBB: actualBB,
      actualStats: walkFound ? true : null,
      gotWalk: walkFound ? (actualBB >= 1) : false
    });
  }

  // --- SUMMARY (DNP players excluded) ---
  const qualifiedBatters = resultBatters.filter(b => b.edgeScore >= 55 && b.actualStats);
  const bGradeBatters = qualifiedBatters.length;

  let totalFantasy = 0, hitCount = 0;
  for (const b of qualifiedBatters) {
    totalFantasy += b.fantasyScore;
    if (b.hits > 0) hitCount++;
  }
  const avgFantasy = bGradeBatters > 0 ? Math.round((totalFantasy / bGradeBatters) * 10) / 10 : 0;
  const hitRate = bGradeBatters > 0 ? Math.round((hitCount / bGradeBatters) * 100) : 0;

  const qualifiedPitchers = resultPitchers.filter(p => p.whiffScore >= 55 && p.actualStats);
  const bGradePitchers = qualifiedPitchers.length;
  let projHitCount = 0;
  for (const p of qualifiedPitchers) {
    if (p.hitProj) projHitCount++;
  }
  const pitcherHitProjRate = bGradePitchers > 0 ? Math.round((projHitCount / bGradePitchers) * 100) : 0;

  const qualifiedWalks = resultWalks.filter(w => w.walkScore >= 55 && w.actualStats);
  const bGradeWalks = qualifiedWalks.length;
  let walkHitCount = 0;
  for (const w of qualifiedWalks) {
    if (w.gotWalk) walkHitCount++;
  }
  const walkHitRate = bGradeWalks > 0 ? Math.round((walkHitCount / bGradeWalks) * 100) : 0;

  // --- SAVE ---
  const results = {
    date: dateStr,
    processedAt: new Date().toISOString(),
    summary: {
      avgFantasy,
      totalFantasy,
      hitRate,
      pitcherHitProjRate,
      bGradeBatters,
      bGradePitchers,
      walkHitRate,
      bGradeWalks
    },
    batters: resultBatters,
    pitchers: resultPitchers,
    walks: resultWalks
  };

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, dateStr + '.json'), JSON.stringify(results, null, 2));

  console.log(`  [${dateStr}] ✓ Batters: ${bGradeBatters} B-grade (${hitRate}% hit) | Pitchers: ${bGradePitchers} B-grade (${pitcherHitProjRate}% hit proj) | Walks: ${bGradeWalks} B-grade (${walkHitRate}% walked)`);
  return true;
}

async function main() {
  const resultsDir = path.join(__dirname, '..', 'results');
  const indexPath = path.join(resultsDir, 'index.json');

  // Get all dates — from index.json + any snapshot files not in index
  let dates = [];
  if (fs.existsSync(indexPath)) {
    try { dates = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch(e) {}
  }

  // Also check for snapshot files that might not be in the index yet
  const snapshotDir = path.join(__dirname, '..', 'snapshots');
  if (fs.existsSync(snapshotDir)) {
    const snapshotFiles = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json'));
    for (const f of snapshotFiles) {
      const d = f.replace('.json', '');
      if (!dates.includes(d)) dates.push(d);
    }
  }

  dates.sort();

  if (dates.length === 0) {
    console.log("No dates to patch — no snapshots or results found.");
    return;
  }

  console.log(`\n=== PATCHING ${dates.length} DATES ===\n`);

  let patched = 0;
  for (const dateStr of dates) {
    const success = await patchDate(dateStr);
    if (success) patched++;
    await delay(500); // pause between dates
  }

  // Update index with all patched dates
  if (patched > 0) {
    const allResults = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && f !== 'index.json');
    const updatedIndex = allResults.map(f => f.replace('.json', '')).sort();
    fs.writeFileSync(indexPath, JSON.stringify(updatedIndex, null, 2));
    console.log(`\n=== DONE: Patched ${patched}/${dates.length} dates, index updated (${updatedIndex.length} dates) ===\n`);
  } else {
    console.log("\n=== No dates were patched (no snapshots found) ===\n");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
