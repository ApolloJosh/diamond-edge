const BASE = "https://statsapi.mlb.com/api/v1";

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) return {};
  return resp.json();
}

async function getGamesForDate(dateStr) {
  const data = await fetchJSON(BASE + "/schedule?sportId=1&date=" + dateStr + "&hydrate=probablePitcher(note),venue,team");
  const games = [];
  for (const d of (data.dates || [])) {
    for (const g of (d.games || [])) games.push(g);
  }
  return games;
}

async function getRoster(teamId) {
  const data = await fetchJSON(BASE + "/teams/" + teamId + "/roster?rosterType=active");
  return (data.roster || []).filter(p => p.position && p.position.abbreviation !== "P");
}

async function getBvPSplits(batterId, pitcherId) {
  try {
    const data = await fetchJSON(BASE + "/people/" + batterId + "/stats?stats=vsPlayer&opposingPlayerId=" + pitcherId + "&sportId=1&group=hitting");
    for (const sg of data.stats || []) {
      if (sg.group && sg.group.displayName === "hitting") {
        const split = sg.splits && sg.splits[0] && sg.splits[0].stat;
        if (split) return split;
      }
    }
    return null;
  } catch(e) { return null; }
}

async function getSeasonStats(playerId, group) {
  group = group || "hitting";
  try {
    const year = new Date().getFullYear();
    const data = await fetchJSON(BASE + "/people/" + playerId + "/stats?stats=season&season=" + year + "&group=" + group);
    for (const sg of data.stats || []) {
      if (sg.group && sg.group.displayName === group) {
        const split = sg.splits && sg.splits[0] && sg.splits[0].stat;
        if (split) return split;
      }
    }
    return null;
  } catch(e) { return null; }
}

async function getTeamSeasonStats(teamId) {
  try {
    const year = new Date().getFullYear();
    const data = await fetchJSON(BASE + "/teams/" + teamId + "/stats?stats=season&group=hitting&season=" + year);
    for (const sg of data.stats || []) {
      if (sg.group && sg.group.displayName === "hitting") {
        const stat = sg.splits && sg.splits[0] && sg.splits[0].stat;
        if (stat) {
          const strikeOuts = parseInt(stat.strikeOuts) || 0;
          const atBats = parseInt(stat.atBats) || 0;
          const kRate = atBats > 0 ? (strikeOuts / atBats) : 0;
          return { kRate, strikeOuts, atBats };
        }
      }
    }
    return null;
  } catch(e) { return null; }
}

function floorHalf(n) {
  return Math.floor(n * 2) / 2;
}

function computeEdgeScore(bvpStat, seasonStat, pa, venueStat, weather) {
  if (!bvpStat) return { score: 0, parkDelta: 0, weatherDelta: 0 };
  let score = 50;
  const bvpAvg = parseFloat(bvpStat.avg) || 0;
  const bvpOps = parseFloat(bvpStat.ops) || 0;
  const bvpPA = parseInt(pa) || parseInt(bvpStat.plateAppearances) || 0;
  score += (bvpAvg - 0.250) * 100;
  score += (bvpOps - 0.700) * 25;
  const sampleFactor = Math.min(bvpPA / 30, 1.5);
  score = 50 + (score - 50) * sampleFactor;
  const hrs = parseInt(bvpStat.homeRuns) || 0;
  if (hrs >= 3) score += 8;
  else if (hrs >= 1) score += 4;
  const abs = parseInt(bvpStat.atBats) || 1;
  const ks = parseInt(bvpStat.strikeOuts) || 0;
  const kRate = ks / abs;
  if (kRate > 0.35) score -= 8;
  if (seasonStat) {
    const sAvg = parseFloat(seasonStat.avg) || 0;
    const sOps = parseFloat(seasonStat.ops) || 0;
    if (sAvg >= 0.300) score += 6;
    else if (sAvg >= 0.270) score += 3;
    else if (sAvg < 0.200) score -= 5;
    if (sOps >= 0.850) score += 5;
    else if (sOps < 0.600) score -= 4;
  }
  var parkDelta = 0;
  var weatherDelta = 0;
  return { score: Math.max(0, Math.min(99, Math.round(score))), parkDelta, weatherDelta };
}

function computeWhiffScore(pitcher, seasonStat, extras, oppTeamKRate, matchups) {
  if (!pitcher) return { score: 50, factors: {} };
  var score = 50;
  var factors = {};
  var k9 = parseFloat(seasonStat && seasonStat.strikeoutsPer9Inn) || 0;
  if (k9 >= 10.0) factors.pitcherK9 = 12;
  else if (k9 >= 9.0) factors.pitcherK9 = 8;
  else if (k9 >= 8.0) factors.pitcherK9 = 4;
  else if (k9 < 6.0) factors.pitcherK9 = -8;
  else if (k9 < 7.0) factors.pitcherK9 = -4;
  else factors.pitcherK9 = 0;
  score += factors.pitcherK9;

  if (oppTeamKRate >= 0.260) factors.oppTeamK = 10;
  else if (oppTeamKRate >= 0.240) factors.oppTeamK = 6;
  else if (oppTeamKRate >= 0.220) factors.oppTeamK = 3;
  else if (oppTeamKRate < 0.180) factors.oppTeamK = -8;
  else if (oppTeamKRate < 0.200) factors.oppTeamK = -4;
  else factors.oppTeamK = 0;
  score += factors.oppTeamK;

  var totalAB = 0, totalK = 0;
  if (matchups && Array.isArray(matchups)) {
    for (var m of matchups) {
      totalAB += parseInt(m.stat.atBats) || 0;
      totalK += parseInt(m.stat.strikeOuts) || 0;
    }
  }
  var bvpKRate = totalAB > 0 ? (totalK / totalAB) : 0;
  if (bvpKRate >= 0.30) factors.bvpK = 10;
  else if (bvpKRate >= 0.25) factors.bvpK = 6;
  else if (bvpKRate >= 0.20) factors.bvpK = 3;
  else if (bvpKRate < 0.12) factors.bvpK = -8;
  else if (bvpKRate < 0.15) factors.bvpK = -4;
  else factors.bvpK = 0;
  score += factors.bvpK;
  factors.parkK = 0;
  score += factors.parkK;
  factors.splitK = 0;
  score += factors.splitK;
  factors.recentK = 0;
  score += factors.recentK;

  return { score: Math.max(0, Math.min(99, Math.round(score))), factors, bvpKRate };
}

function edgeGrade(score) {
  if (score >= 80) return "A+";
  if (score >= 70) return "A";
  if (score >= 62) return "B+";
  if (score >= 55) return "B";
  if (score >= 45) return "C";
  if (score >= 35) return "D";
  return "F";
}

function whiffGrade(score) {
  if (score >= 80) return "A+";
  if (score >= 70) return "A";
  if (score >= 62) return "B+";
  if (score >= 55) return "B";
  if (score >= 45) return "C";
  if (score >= 35) return "D";
  return "F";
}

async function main() {
  const args = process.argv.slice(2);
  const isAfternoon = args.includes('--afternoon');
  const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dateStr = dateArg || new Date().toISOString().slice(0, 10);

  console.log(`Scanning games for ${dateStr}${isAfternoon ? ' (afternoon — skipping started games)' : ''}...`);

  const games = await getGamesForDate(dateStr);
  if (games.length === 0) {
    console.log('No games found.');
    process.exit(0);
  }

  const fs = require('fs');
  const path = require('path');
  const snapshotDir = path.join(__dirname, '..', 'snapshots');
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, dateStr + '.json');

  let existingSnapshot = null;
  if (isAfternoon && fs.existsSync(snapshotPath)) {
    existingSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    console.log(`Loaded existing snapshot with ${existingSnapshot.batters.length} batters, ${existingSnapshot.pitchers.length} pitchers`);
  }

  const now = new Date();
  let gamesToScan = games;

  if (isAfternoon) {
    const cutoff = new Date(now.getTime() - 30 * 60000);
    gamesToScan = games.filter(g => new Date(g.gameDate) > cutoff);
    console.log(`${gamesToScan.length} of ${games.length} games haven't started yet`);
    if (gamesToScan.length === 0 && existingSnapshot) {
      console.log('All games already scanned. No changes needed.');
      process.exit(0);
    }
  }

  const allBatters = [];
  const allPitchers = [];

  for (let gi = 0; gi < gamesToScan.length; gi++) {
    const game = gamesToScan[gi];
    const homeId = game.teams.home.team.id;
    const awayId = game.teams.away.team.id;
    const homePitcher = game.teams.home.probablePitcher;
    const awayPitcher = game.teams.away.probablePitcher;
    if (!homePitcher && !awayPitcher) continue;

    const awayAbbr = game.teams.away.team.abbreviation || "AWAY";
    const homeAbbr = game.teams.home.team.abbreviation || "HOME";
    const gameLabel = awayAbbr + " @ " + homeAbbr;
    console.log(`  Scanning ${gameLabel} (${gi + 1}/${gamesToScan.length})...`);

    let rosters;
    try {
      rosters = await Promise.all([getRoster(homeId), getRoster(awayId)]);
    } catch(e) { continue; }
    const homeRoster = rosters[0];
    const awayRoster = rosters[1];

    const teamKRates = {};
    await Promise.all([
      getTeamSeasonStats(homeId).then(s => { if(s) teamKRates[homeId] = s; }),
      getTeamSeasonStats(awayId).then(s => { if(s) teamKRates[awayId] = s; })
    ]);

    const homeMatchupsForWhiff = [];
    const awayMatchupsForWhiff = [];

    if (homePitcher) {
      for (const batter of awayRoster) {
        try {
          const [bvp, season] = await Promise.all([
            getBvPSplits(batter.person.id, homePitcher.id),
            getSeasonStats(batter.person.id, "hitting")
          ]);
          if (bvp && (parseInt(bvp.plateAppearances) || 0) >= 5) {
            const es = computeEdgeScore(bvp, season, bvp.plateAppearances, null, null);
            allBatters.push({
              batterId: batter.person.id, batterName: batter.person.fullName,
              pitcherId: homePitcher.id, pitcherName: homePitcher.fullName,
              batterTeam: awayAbbr, pitcherTeam: homeAbbr,
              edgeScore: es.score, grade: edgeGrade(es.score),
              bvpAvg: bvp.avg || null, bvpOps: bvp.ops || null,
              bvpPA: bvp.plateAppearances || 0, bvpHR: bvp.homeRuns || 0,
              gamePk: game.gamePk, gameLabel
            });
            homeMatchupsForWhiff.push({ stat: bvp, batter: batter.person });
          }
        } catch(e) {}
      }
    }

    if (awayPitcher) {
      for (const batter of homeRoster) {
        try {
          const [bvp, season] = await Promise.all([
            getBvPSplits(batter.person.id, awayPitcher.id),
            getSeasonStats(batter.person.id, "hitting")
          ]);
          if (bvp && (parseInt(bvp.plateAppearances) || 0) >= 5) {
            const es = computeEdgeScore(bvp, season, bvp.plateAppearances, null, null);
            allBatters.push({
              batterId: batter.person.id, batterName: batter.person.fullName,
              pitcherId: awayPitcher.id, pitcherName: awayPitcher.fullName,
              batterTeam: homeAbbr, pitcherTeam: awayAbbr,
              edgeScore: es.score, grade: edgeGrade(es.score),
              bvpAvg: bvp.avg || null, bvpOps: bvp.ops || null,
              bvpPA: bvp.plateAppearances || 0, bvpHR: bvp.homeRuns || 0,
              gamePk: game.gamePk, gameLabel
            });
            awayMatchupsForWhiff.push({ stat: bvp, batter: batter.person });
          }
        } catch(e) {}
      }
    }

    if (homePitcher && homeMatchupsForWhiff.length > 0) {
      const hpSeason = await getSeasonStats(homePitcher.id, "pitching");
      const oppKRate = teamKRates[awayId] ? teamKRates[awayId].kRate : 0.200;
      const hpWhiff = computeWhiffScore(homePitcher, hpSeason, null, oppKRate, homeMatchupsForWhiff);
      const k9 = hpSeason ? parseFloat(hpSeason.strikeoutsPer9Inn) || 0 : 0;
      const expIP = hpSeason && hpSeason.inningsPitched && hpSeason.gamesStarted
        ? (parseFloat(hpSeason.inningsPitched) / Math.max(parseInt(hpSeason.gamesStarted), 1)) : 5.5;
      const projK = floorHalf((k9 * expIP / 9) * 0.88);
      allPitchers.push({
        pitcherId: homePitcher.id, pitcherName: homePitcher.fullName,
        team: homeAbbr, oppTeam: awayAbbr,
        whiffScore: hpWhiff.score, grade: whiffGrade(hpWhiff.score),
        k9: Math.round(k9 * 10) / 10, projectedIP: Math.round(expIP * 10) / 10,
        projectedK: projK,
        gamePk: game.gamePk, gameLabel
      });
    }
    if (awayPitcher && awayMatchupsForWhiff.length > 0) {
      const apSeason = await getSeasonStats(awayPitcher.id, "pitching");
      const oppKRate2 = teamKRates[homeId] ? teamKRates[homeId].kRate : 0.200;
      const apWhiff = computeWhiffScore(awayPitcher, apSeason, null, oppKRate2, awayMatchupsForWhiff);
      const k9 = apSeason ? parseFloat(apSeason.strikeoutsPer9Inn) || 0 : 0;
      const expIP = apSeason && apSeason.inningsPitched && apSeason.gamesStarted
        ? (parseFloat(apSeason.inningsPitched) / Math.max(parseInt(apSeason.gamesStarted), 1)) : 5.5;
      const projK = floorHalf((k9 * expIP / 9) * 0.88);
      allPitchers.push({
        pitcherId: awayPitcher.id, pitcherName: awayPitcher.fullName,
        team: awayAbbr, oppTeam: homeAbbr,
        whiffScore: apWhiff.score, grade: whiffGrade(apWhiff.score),
        k9: Math.round(k9 * 10) / 10, projectedIP: Math.round(expIP * 10) / 10,
        projectedK: projK,
        gamePk: game.gamePk, gameLabel
      });
    }
  }

  allBatters.sort((a, b) => b.edgeScore - a.edgeScore);
  allPitchers.sort((a, b) => b.whiffScore - a.whiffScore);

  const top15 = allBatters.slice(0, 15);

  let finalBatters = top15;
  let finalPitchers = allPitchers;

  if (isAfternoon && existingSnapshot) {
    const newGamePks = new Set(gamesToScan.map(g => g.gamePk));
    const existingBatters = existingSnapshot.batters.filter(b => !newGamePks.has(b.gamePk));
    const existingPitchers = existingSnapshot.pitchers.filter(p => !newGamePks.has(p.gamePk));

    const combined = [...existingBatters, ...top15];
    combined.sort((a, b) => b.edgeScore - a.edgeScore);
    finalBatters = combined.slice(0, 15);

    finalPitchers = [...existingPitchers, ...allPitchers];
    finalPitchers.sort((a, b) => b.whiffScore - a.whiffScore);

    console.log(`Merged: ${existingBatters.length} existing + ${top15.length} new batters`);
    console.log(`Merged: ${existingPitchers.length} existing + ${allPitchers.length} new pitchers`);
  }

  const snapshot = {
    date: dateStr,
    savedAt: new Date().toISOString(),
    scanType: isAfternoon ? "afternoon" : "morning",
    gamesScanned: gamesToScan.length,
    totalGames: games.length,
    batters: finalBatters,
    pitchers: finalPitchers
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot saved: ${snapshotPath}`);
  console.log(`  ${finalBatters.length} batters (top 15), ${finalPitchers.length} pitchers`);
}

main().catch(e => { console.error(e); process.exit(1); });
