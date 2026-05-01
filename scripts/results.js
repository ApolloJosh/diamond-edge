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
  console.log(`  ${snapshot.batters.length} batters, ${snapshot.pitchers.length} pitchers, ${(snapshot.pitches || []).length} pitches picks`);

  // Collect unique game PKs from all categories
  const uniqueGamePks = new Set();
  for (const b of snapshot.batters) uniqueGamePks.add(b.gamePk);
  for (const p of snapshot.pitchers) uniqueGamePks.add(p.gamePk);
  for (const p of (snapshot.pitches || [])) uniqueGamePks.add(p.gamePk);

  const boxScores = {};
  for (const gamePk of uniqueGamePks) {
    console.log(`  Fetching box score for game ${gamePk}...`);
    boxScores[gamePk] = await getGameBoxScore(gamePk);
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
    // Treat 0-AB batters as DNP — they appeared in the boxscore (roster/lineup card)
    // but never actually batted (defensive sub, pinch-runner, game ended before their PA)
    const actuallyPlayed = batterFound && ab > 0;
    const fantasyScore = actuallyPlayed ? computeFantasyScore(batterFound) : 0;

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
      actualLine: actuallyPlayed ? `${hits}-${ab}` : "DNP",
      hits: hits,
      ab: ab,
      fantasyScore: fantasyScore,
      actualStats: actuallyPlayed ? batterFound : null
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

  // --- PITCHES THROWN ---
  const resultPitches = [];
  for (const pick of (snapshot.pitches || [])) {
    const boxScore = boxScores[pick.gamePk];
    if (!boxScore || !boxScore.teams) continue;

    let pitcherFound = null;
    for (const teamKey in boxScore.teams) {
      const team = boxScore.teams[teamKey];
      const playerKey = "ID" + pick.pitcherId;
      if (team.players && team.players[playerKey]) {
        const playerData = team.players[playerKey];
        if (playerData.stats && playerData.stats.pitching) {
          pitcherFound = playerData.stats.pitching;
        }
        break;
      }
    }

    const actualPitches = pitcherFound ? (parseInt(pitcherFound.numberOfPitches) || parseInt(pitcherFound.pitchesThrown) || 0) : 0;
    const played = pitcherFound !== null && actualPitches > 0;
    // O/U hit: did the over/under call vs PP line land?
    let hit = false;
    if (played && pick.ppLine != null) {
      if (pick.overUnder === "OVER") hit = actualPitches > pick.ppLine;
      else if (pick.overUnder === "UNDER") hit = actualPitches < pick.ppLine;
    } else if (played) {
      // Fallback: compare vs our own line if no PP line
      if (pick.overUnder === "OVER") hit = actualPitches > pick.line;
      else if (pick.overUnder === "UNDER") hit = actualPitches < pick.line;
    }
    // Proj hit: actual pitches within 2.5 of our projection
    const projHit = played ? (Math.abs(actualPitches - pick.line) <= 2.5) : false;

    resultPitches.push({
      pitcherId: pick.pitcherId,
      pitcherName: pick.pitcherName,
      team: pick.team,
      oppTeam: pick.oppTeam,
      line: pick.line,
      ppLine: pick.ppLine || null,
      goblinLine: pick.goblinLine || null,
      overUnder: pick.overUnder,
      pitchScore: pick.pitchScore,
      grade: pick.grade,
      recent5Avg: pick.recent5Avg || null,
      twoYrAvg: pick.twoYrAvg || null,
      bvpAdj: pick.bvpAdj || 0,
      gamePk: pick.gamePk,
      gameLabel: pick.gameLabel,
      actualPitches: actualPitches,
      actualStats: played ? true : null,
      hit: hit,
      projHit: projHit
    });
  }

  // --- SUMMARY (DNP excluded from all denominators) ---
  // "Hit" = 5+ fantasy points (meaningful contribution)
  const qualifiedBatters = resultBatters.filter(b => b.edgeScore >= 55 && b.actualStats);
  const bGradeBatters = qualifiedBatters.length;

  let totalFantasy = 0, hitCount = 0;
  for (const b of qualifiedBatters) {
    totalFantasy += b.fantasyScore;
    if (b.fantasyScore >= 5) hitCount++;
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

  const qualifiedPitches = resultPitches.filter(p => p.actualStats);
  const bGradePitches = qualifiedPitches.length;
  let pitchesHitCount = 0, pitchesProjHitCount = 0;
  for (const p of qualifiedPitches) {
    if (p.hit) pitchesHitCount++;
    if (p.projHit) pitchesProjHitCount++;
  }
  const pitchesHitRate = bGradePitches > 0 ? Math.round((pitchesHitCount / bGradePitches) * 100) : 0;
  const pitchesProjHitRate = bGradePitches > 0 ? Math.round((pitchesProjHitCount / bGradePitches) * 100) : 0;

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
      pitchesHitRate,
      pitchesProjHitRate,
      bGradePitches
    },
    batters: resultBatters,
    pitchers: resultPitchers,
    pitches: resultPitches
  };

  const resultsDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const resultsPath = path.join(resultsDir, dateStr + '.json');

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${resultsPath}`);
  console.log(`  ${resultBatters.length} batters (${bGradeBatters} B-grade+ played), ${resultPitchers.length} pitchers (${bGradePitchers} B-grade+ played)`);
  console.log(`  Avg Fantasy: ${avgFantasy}, Hit Rate: ${hitRate}%`);
  console.log(`  Pitcher Hit Proj Rate: ${pitcherHitProjRate}%`);
  console.log(`  Pitches picks: ${resultPitches.length} total (${bGradePitches} pitched, ${pitchesHitRate}% O/U hit, ${pitchesProjHitRate}% proj hit)`);

  // Update results index
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
