const BASE = "https://statsapi.mlb.com/api/v1";

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
  score += (parseInt(stats.hits) || 0) * 3;
  score += (parseInt(stats.doubles) || 0) * 5;
  score += (parseInt(stats.triples) || 0) * 8;
  score += (parseInt(stats.homeRuns) || 0) * 10;
  score += (parseInt(stats.runs) || 0) * 2;
  score += (parseInt(stats.rbi) || 0) * 2;
  score += (parseInt(stats.baseOnBalls) || 0) * 2;
  score += (parseInt(stats.hitByPitch) || 0) * 2;
  score += (parseInt(stats.stolenBases) || 0) * 5;
  return score;
}

async function main() {
  const args = process.argv.slice(2);
  const dateStr = args[0] || new Date().toISOString().slice(0, 10);

  const fs = require('fs');
  const path = require('path');

  const snapshotDir = path.join(__dirname, '..', 'snapshots');
  const snapshotPath = path.join(snapshotDir, dateStr + '.json');

  if (!fs.existsSync(snapshotPath)) {
    console.log(`Snapshot not found for ${dateStr}`);
    process.exit(0);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  console.log(`Processing results for ${dateStr}...`);
  console.log(`  ${snapshot.batters.length} batters, ${snapshot.pitchers.length} pitchers`);

  const uniqueGamePks = new Set();
  for (const b of snapshot.batters) uniqueGamePks.add(b.gamePk);
  for (const p of snapshot.pitchers) uniqueGamePks.add(p.gamePk);

  const boxScores = {};
  for (const gamePk of uniqueGamePks) {
    console.log(`  Fetching box score for game ${gamePk}...`);
    boxScores[gamePk] = await getGameBoxScore(gamePk);
  }

  const resultBatters = [];
  for (const batter of snapshot.batters) {
    const boxScore = boxScores[batter.gamePk];
    if (!boxScore || !boxScore.teams) {
      continue;
    }

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

    if (!batterFound) {
      continue;
    }

    const hits = parseInt(batterFound.hits) || 0;
    const ab = parseInt(batterFound.atBats) || 0;
    const actualLine = `${hits}-${ab}`;
    const fantasyScore = computeFantasyScore(batterFound);

    resultBatters.push({
      batterId: batter.batterId,
      batterName: batter.batterName,
      pitcherName: batter.pitcherName,
      batterTeam: batter.batterTeam,
      edgeScore: batter.edgeScore,
      grade: batter.grade,
      bvpAvg: batter.bvpAvg,
      bvpOps: batter.bvpOps,
      gamePk: batter.gamePk,
      gameLabel: batter.gameLabel,
      actualLine: actualLine,
      hits: hits,
      ab: ab,
      fantasyScore: fantasyScore,
      actualStats: batterFound
    });
  }

  const resultPitchers = [];
  for (const pitcher of snapshot.pitchers) {
    const boxScore = boxScores[pitcher.gamePk];
    if (!boxScore || !boxScore.teams) {
      continue;
    }

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

    if (!pitcherFound) {
      continue;
    }

    const actualK = parseInt(pitcherFound.strikeOuts) || 0;
    const actualIP = pitcherFound.inningsPitched || "0.0";
    const actualER = parseInt(pitcherFound.earnedRuns) || 0;
    const actualH = parseInt(pitcherFound.hits) || 0;
    const actualBB = parseInt(pitcherFound.baseOnBalls) || 0;
    const hitProj = actualK >= pitcher.projectedK;

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
      hitProj: hitProj
    });
  }

  // Only count players who actually played (have actualStats) for hit rate calculations
  const qualifiedBatters = resultBatters.filter(b => b.edgeScore >= 55 && b.actualStats);
  const bGradeBatters = qualifiedBatters.length;
  const bGradePitchers = resultPitchers.filter(p => p.whiffScore >= 55 && p.actualStats).length;

  let totalFantasy = 0;
  let hitCount = 0;
  for (const b of qualifiedBatters) {
    totalFantasy += b.fantasyScore;
    if (b.fantasyScore > 0) hitCount++;
  }
  const avgFantasy = qualifiedBatters.length > 0 ? Math.round((totalFantasy / qualifiedBatters.length) * 10) / 10 : 0;
  const hitRate = qualifiedBatters.length > 0 ? Math.round((hitCount / qualifiedBatters.length) * 100) : 0;

  let projHitCount = 0;
  const qualifiedPitchers = resultPitchers.filter(p => p.whiffScore >= 55 && p.actualStats);
  for (const p of qualifiedPitchers) {
    if (p.hitProj) projHitCount++;
  }
  const pitcherHitProjRate = qualifiedPitchers.length > 0 ? Math.round((projHitCount / qualifiedPitchers.length) * 100) : 0;

  const results = {
    date: dateStr,
    processedAt: new Date().toISOString(),
    summary: {
      avgFantasy: avgFantasy,
      totalFantasy: totalFantasy,
      hitRate: hitRate,
      pitcherHitProjRate: pitcherHitProjRate,
      bGradeBatters: bGradeBatters,
      bGradePitchers: bGradePitchers
    },
    batters: resultBatters,
    pitchers: resultPitchers
  };

  const resultsDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const resultsPath = path.join(resultsDir, dateStr + '.json');

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${resultsPath}`);
  console.log(`  ${resultBatters.length} batters (${bGradeBatters} B-grade+), ${resultPitchers.length} pitchers (${bGradePitchers} B-grade+)`);
  console.log(`  Avg Fantasy: ${avgFantasy}, Total: ${totalFantasy}, Hit Rate: ${hitRate}%`);
  console.log(`  Pitcher Hit Proj Rate: ${pitcherHitProjRate}%`);

  // Update results index (list of all dates with results)
  const indexPath = path.join(resultsDir, 'index.json');
  let index = [];
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch(e) {}
  }
  if (!index.includes(dateStr)) {
    index.push(dateStr);
    index.sort();
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Results index updated: ${index.length} dates tracked`);
}

main().catch(e => { console.error(e); process.exit(1); });
