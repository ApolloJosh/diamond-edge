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
    let ab=0, h=0, hr=0, rbi=0, bb=0, so=0, pa=0, d=0, t=0, sf=0, hbp=0, sac=0;
    let found = false;
    for (const sg of data.stats || []) {
      if (sg.group && sg.group.displayName === "hitting") {
        for (const sp of (sg.splits || [])) {
          const s = sp.stat || {};
          const spAB = parseInt(s.atBats) || 0;
          const spPA = parseInt(s.plateAppearances) || 0;
          if (spAB === 0 && spPA === 0) continue;
          found = true;
          ab += spAB;
          h  += parseInt(s.hits) || 0;
          hr += parseInt(s.homeRuns) || 0;
          rbi+= parseInt(s.rbi) || 0;
          bb += parseInt(s.baseOnBalls) || 0;
          so += parseInt(s.strikeOuts) || 0;
          pa += spPA;
          d  += parseInt(s.doubles) || 0;
          t  += parseInt(s.triples) || 0;
          sf += parseInt(s.sacFlies) || 0;
          hbp+= parseInt(s.hitByPitch) || 0;
          sac+= parseInt(s.sacBunts) || 0;
        }
      }
    }
    if (!found) return null;
    const tb = h + d + (2 * t) + (3 * hr);
    const singles = h - d - t - hr;
    const avg = ab > 0 ? (h / ab) : 0;
    const obpDen = ab + bb + hbp + sf;
    const obp = obpDen > 0 ? ((h + bb + hbp) / obpDen) : 0;
    const slg = ab > 0 ? (tb / ab) : 0;
    const ops = obp + slg;
    const fmt = (n) => n.toFixed(3).replace(/^0\./, ".");
    return {
      atBats: ab, hits: h, homeRuns: hr, rbi: rbi,
      baseOnBalls: bb, strikeOuts: so, plateAppearances: pa,
      doubles: d, triples: t, sacFlies: sf, hitByPitch: hbp, sacBunts: sac,
      totalBases: tb,
      avg: fmt(avg), obp: fmt(obp), slg: fmt(slg), ops: fmt(ops)
    };
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

async function getBatterRecentBBRate(playerId) {
  try {
    var year = new Date().getFullYear();
    var both = await Promise.all([
      fetchJSON(BASE + "/people/" + playerId + "/stats?stats=gameLog&group=hitting&season=" + year),
      fetchJSON(BASE + "/people/" + playerId + "/stats?stats=gameLog&group=hitting&season=" + (year - 1))
    ]);
    var games = [];
    for (var sg of (both[1].stats || [])) {
      if (sg.group && sg.group.displayName === "hitting") {
        for (var sp of (sg.splits || [])) games.push(sp);
      }
    }
    for (var sg2 of (both[0].stats || [])) {
      if (sg2.group && sg2.group.displayName === "hitting") {
        for (var sp2 of (sg2.splits || [])) games.push(sp2);
      }
    }
    var recent = games.slice(-10);
    if (recent.length === 0) return null;
    var totalPA = 0, totalBB = 0;
    for (var g of recent) {
      var s = g.stat || {};
      totalPA += parseInt(s.plateAppearances) || 0;
      totalBB += parseInt(s.baseOnBalls) || 0;
    }
    return { bbRate: totalPA > 0 ? (totalBB / totalPA) : 0, bb: totalBB, pa: totalPA, games: recent.length };
  } catch (e) { return null; }
}

async function getBatterCareerBBRate(playerId) {
  try {
    var data = await fetchJSON(BASE + "/people/" + playerId + "/stats?stats=career&group=hitting");
    for (var sg of (data.stats || [])) {
      if (sg.group && sg.group.displayName === "hitting") {
        var sp = sg.splits && sg.splits[0];
        if (sp && sp.stat) {
          var pa = parseInt(sp.stat.plateAppearances) || 0;
          var bb = parseInt(sp.stat.baseOnBalls) || 0;
          return { bbRate: pa > 0 ? (bb / pa) : 0, bb: bb, pa: pa };
        }
      }
    }
    return null;
  } catch (e) { return null; }
}

async function getPitcherRecentBBRate(pitcherId) {
  try {
    var year = new Date().getFullYear();
    var both = await Promise.all([
      fetchJSON(BASE + "/people/" + pitcherId + "/stats?stats=gameLog&group=pitching&season=" + year),
      fetchJSON(BASE + "/people/" + pitcherId + "/stats?stats=gameLog&group=pitching&season=" + (year - 1))
    ]);
    var games = [];
    for (var sg of (both[1].stats || [])) {
      if (sg.group && sg.group.displayName === "pitching") {
        for (var sp of (sg.splits || [])) games.push(sp);
      }
    }
    for (var sg2 of (both[0].stats || [])) {
      if (sg2.group && sg2.group.displayName === "pitching") {
        for (var sp2 of (sg2.splits || [])) games.push(sp2);
      }
    }
    var recent = games.slice(-5);
    if (recent.length === 0) return null;
    var totalBF = 0, totalBB = 0;
    for (var g of recent) {
      var s = g.stat || {};
      totalBF += parseInt(s.battersFaced) || parseInt(s.battersfaced) || 0;
      totalBB += parseInt(s.baseOnBalls) || 0;
      if (totalBF === 0) {
        var ip = parseFloat(s.inningsPitched) || 0;
        totalBF += Math.round(ip * 4.3);
      }
    }
    return { bbRate: totalBF > 0 ? (totalBB / totalBF) : 0, bb: totalBB, bf: totalBF, starts: recent.length };
  } catch (e) { return null; }
}

async function getPitcherCareerBBRate(pitcherId) {
  try {
    var data = await fetchJSON(BASE + "/people/" + pitcherId + "/stats?stats=career&group=pitching");
    for (var sg of (data.stats || [])) {
      if (sg.group && sg.group.displayName === "pitching") {
        var sp = sg.splits && sg.splits[0];
        if (sp && sp.stat) {
          var bb9 = parseFloat(sp.stat.baseOnBallsPer9Inn) || 0;
          var bbRate = bb9 / 9 / 4.3;
          var totalBB = parseInt(sp.stat.baseOnBalls) || 0;
          return { bbRate: bbRate, bb9: bb9, totalBB: totalBB };
        }
      }
    }
    return null;
  } catch (e) { return null; }
}

function computeWalkScore(bvpStat, batterSeasonStat, batterRecentBB, batterCareerBB, pitcherSeasonStat, pitcherRecentBB, pitcherCareerBB) {
  var score = 50;
  var factors = {};

  // 1. BvP walk history (weight: high)
  var bvpPA = parseInt(bvpStat.plateAppearances) || 0;
  var bvpBB = parseInt(bvpStat.baseOnBalls) || 0;
  var bvpBBRate = bvpPA > 0 ? (bvpBB / bvpPA) : 0;
  if (bvpBBRate >= 0.18) factors.bvpBB = 12;
  else if (bvpBBRate >= 0.14) factors.bvpBB = 8;
  else if (bvpBBRate >= 0.10) factors.bvpBB = 4;
  else if (bvpBBRate < 0.04) factors.bvpBB = -8;
  else if (bvpBBRate < 0.06) factors.bvpBB = -4;
  else factors.bvpBB = 0;
  var sampleFactor = Math.min(bvpPA / 20, 1.2);
  factors.bvpBB = Math.round(factors.bvpBB * sampleFactor);
  score += factors.bvpBB;

  // 2. Batter recent BB% trend (last 10 games)
  factors.batterRecent = 0;
  if (batterRecentBB) {
    var brRate = batterRecentBB.bbRate;
    if (brRate >= 0.14) factors.batterRecent = 10;
    else if (brRate >= 0.11) factors.batterRecent = 6;
    else if (brRate >= 0.09) factors.batterRecent = 3;
    else if (brRate < 0.04) factors.batterRecent = -8;
    else if (brRate < 0.06) factors.batterRecent = -4;
    else factors.batterRecent = 0;
  }
  score += factors.batterRecent;

  // 3. Batter season BB%
  factors.batterSeason = 0;
  if (batterSeasonStat) {
    var sPa = parseInt(batterSeasonStat.plateAppearances) || 0;
    var sBb = parseInt(batterSeasonStat.baseOnBalls) || 0;
    var sBBRate = sPa > 0 ? (sBb / sPa) : 0;
    if (sBBRate >= 0.13) factors.batterSeason = 6;
    else if (sBBRate >= 0.10) factors.batterSeason = 3;
    else if (sBBRate < 0.05) factors.batterSeason = -5;
    else if (sBBRate < 0.07) factors.batterSeason = -2;
    else factors.batterSeason = 0;
  }
  score += factors.batterSeason;

  // 4. Batter career BB%
  factors.batterCareer = 0;
  if (batterCareerBB) {
    var cRate = batterCareerBB.bbRate;
    if (cRate >= 0.12) factors.batterCareer = 4;
    else if (cRate >= 0.10) factors.batterCareer = 2;
    else if (cRate < 0.05) factors.batterCareer = -4;
    else if (cRate < 0.07) factors.batterCareer = -2;
    else factors.batterCareer = 0;
  }
  score += factors.batterCareer;

  // 5. Pitcher recent BB% trend (last 5 starts)
  factors.pitcherRecent = 0;
  if (pitcherRecentBB) {
    var prRate = pitcherRecentBB.bbRate;
    if (prRate >= 0.12) factors.pitcherRecent = 10;
    else if (prRate >= 0.09) factors.pitcherRecent = 6;
    else if (prRate >= 0.07) factors.pitcherRecent = 3;
    else if (prRate < 0.03) factors.pitcherRecent = -8;
    else if (prRate < 0.05) factors.pitcherRecent = -4;
    else factors.pitcherRecent = 0;
  }
  score += factors.pitcherRecent;

  // 6. Pitcher season BB%
  factors.pitcherSeason = 0;
  if (pitcherSeasonStat) {
    var pBB9 = parseFloat(pitcherSeasonStat.baseOnBallsPer9Inn) || 0;
    if (pBB9 >= 4.5) factors.pitcherSeason = 8;
    else if (pBB9 >= 3.5) factors.pitcherSeason = 4;
    else if (pBB9 >= 2.8) factors.pitcherSeason = 1;
    else if (pBB9 < 1.5) factors.pitcherSeason = -6;
    else if (pBB9 < 2.0) factors.pitcherSeason = -3;
    else factors.pitcherSeason = 0;
  }
  score += factors.pitcherSeason;

  // 7. Pitcher career BB tendency
  factors.pitcherCareer = 0;
  if (pitcherCareerBB) {
    var pcBB9 = pitcherCareerBB.bb9 || 0;
    if (pcBB9 >= 4.0) factors.pitcherCareer = 4;
    else if (pcBB9 >= 3.2) factors.pitcherCareer = 2;
    else if (pcBB9 < 1.8) factors.pitcherCareer = -4;
    else if (pcBB9 < 2.2) factors.pitcherCareer = -2;
    else factors.pitcherCareer = 0;
  }
  score += factors.pitcherCareer;

  return { score: Math.max(0, Math.min(99, Math.round(score))), factors: factors, bvpBBRate: bvpBBRate };
}

function walkGrade(score) {
  if (score >= 80) return "A+";
  if (score >= 70) return "A";
  if (score >= 62) return "B+";
  if (score >= 55) return "B";
  if (score >= 45) return "C";
  if (score >= 35) return "D";
  return "F";
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
    const notStarted = games.filter(g => new Date(g.gameDate) > cutoff);
    console.log(`${notStarted.length} of ${games.length} games haven't started yet`);

    // Also catch games the morning scan missed (no probable pitcher at morning scan time)
    let missedGames = [];
    if (existingSnapshot) {
      const scannedGamePks = new Set([
        ...existingSnapshot.batters.map(b => b.gamePk),
        ...existingSnapshot.pitchers.map(p => p.gamePk)
      ]);
      missedGames = games.filter(g => {
        // Game wasn't in morning snapshot AND it has a probable pitcher now
        const wasMissed = !scannedGamePks.has(g.gamePk);
        const hasPitcher = g.teams.home.probablePitcher || g.teams.away.probablePitcher;
        // Don't re-scan games we're already scanning as "not started"
        const alreadyQueued = notStarted.some(ns => ns.gamePk === g.gamePk);
        return wasMissed && hasPitcher && !alreadyQueued;
      });
      if (missedGames.length > 0) {
        console.log(`${missedGames.length} games were missed by morning scan — picking them up now`);
      }
    }

    gamesToScan = [...notStarted, ...missedGames];

    if (gamesToScan.length === 0 && existingSnapshot) {
      console.log('All games already scanned. No changes needed.');
      process.exit(0);
    }
  }

  const allBatters = [];
  const allPitchers = [];
  const allWalks = [];

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

    // --- WALK SCORING ---
    console.log(`    Scanning walks for ${gameLabel}...`);
    if (homePitcher && homeMatchupsForWhiff.length > 0) {
      const hpSeasonForWalk = await getSeasonStats(homePitcher.id, "pitching");
      const hpRecentBB = await getPitcherRecentBBRate(homePitcher.id);
      const hpCareerBB = await getPitcherCareerBBRate(homePitcher.id);

      for (const wBatter of homeMatchupsForWhiff) {
        if (!wBatter.stat) continue;
        const wBatterSeason = await getSeasonStats(wBatter.batter.id, "hitting");
        const wBatterRecent = await getBatterRecentBBRate(wBatter.batter.id);
        const wBatterCareer = await getBatterCareerBBRate(wBatter.batter.id);
        const ws = computeWalkScore(wBatter.stat, wBatterSeason, wBatterRecent, wBatterCareer, hpSeasonForWalk, hpRecentBB, hpCareerBB);
        if (ws.score >= 50) {
          allWalks.push({
            batterId: wBatter.batter.id, batterName: wBatter.batter.fullName,
            pitcherId: homePitcher.id, pitcherName: homePitcher.fullName,
            batterTeam: awayAbbr, pitcherTeam: homeAbbr,
            walkScore: ws.score, grade: walkGrade(ws.score),
            bvpBB: parseInt(wBatter.stat.baseOnBalls) || 0,
            bvpPA: parseInt(wBatter.stat.plateAppearances) || 0,
            bvpBBRate: ws.bvpBBRate,
            gamePk: game.gamePk, gameLabel
          });
        }
      }
    }
    if (awayPitcher && awayMatchupsForWhiff.length > 0) {
      const apSeasonForWalk = await getSeasonStats(awayPitcher.id, "pitching");
      const apRecentBB = await getPitcherRecentBBRate(awayPitcher.id);
      const apCareerBB = await getPitcherCareerBBRate(awayPitcher.id);

      for (const wBatter2 of awayMatchupsForWhiff) {
        if (!wBatter2.stat) continue;
        const wBatterSeason2 = await getSeasonStats(wBatter2.batter.id, "hitting");
        const wBatterRecent2 = await getBatterRecentBBRate(wBatter2.batter.id);
        const wBatterCareer2 = await getBatterCareerBBRate(wBatter2.batter.id);
        const ws2 = computeWalkScore(wBatter2.stat, wBatterSeason2, wBatterRecent2, wBatterCareer2, apSeasonForWalk, apRecentBB, apCareerBB);
        if (ws2.score >= 50) {
          allWalks.push({
            batterId: wBatter2.batter.id, batterName: wBatter2.batter.fullName,
            pitcherId: awayPitcher.id, pitcherName: awayPitcher.fullName,
            batterTeam: homeAbbr, pitcherTeam: awayAbbr,
            walkScore: ws2.score, grade: walkGrade(ws2.score),
            bvpBB: parseInt(wBatter2.stat.baseOnBalls) || 0,
            bvpPA: parseInt(wBatter2.stat.plateAppearances) || 0,
            bvpBBRate: ws2.bvpBBRate,
            gamePk: game.gamePk, gameLabel
          });
        }
      }
    }
  }

  allBatters.sort((a, b) => b.edgeScore - a.edgeScore);
  allPitchers.sort((a, b) => b.whiffScore - a.whiffScore);
  allWalks.sort((a, b) => b.walkScore - a.walkScore);

  const top15 = allBatters.slice(0, 15);
  // Filter walks to B-grade+ (55+) for snapshot
  const qualifiedWalks = allWalks.filter(w => w.walkScore >= 55);

  let finalBatters = top15;
  let finalPitchers = allPitchers;
  let finalWalks = qualifiedWalks;

  if (isAfternoon && existingSnapshot) {
    const newGamePks = new Set(gamesToScan.map(g => g.gamePk));
    const existingBatters = existingSnapshot.batters.filter(b => !newGamePks.has(b.gamePk));
    const existingPitchers = existingSnapshot.pitchers.filter(p => !newGamePks.has(p.gamePk));
    const existingWalks = (existingSnapshot.walks || []).filter(w => !newGamePks.has(w.gamePk));

    const combined = [...existingBatters, ...top15];
    combined.sort((a, b) => b.edgeScore - a.edgeScore);
    finalBatters = combined.slice(0, 15);

    finalPitchers = [...existingPitchers, ...allPitchers];
    finalPitchers.sort((a, b) => b.whiffScore - a.whiffScore);

    finalWalks = [...existingWalks, ...qualifiedWalks];
    finalWalks.sort((a, b) => b.walkScore - a.walkScore);

    console.log(`Merged: ${existingBatters.length} existing + ${top15.length} new batters`);
    console.log(`Merged: ${existingPitchers.length} existing + ${allPitchers.length} new pitchers`);
    console.log(`Merged: ${existingWalks.length} existing + ${qualifiedWalks.length} new walks`);
  }

  const snapshot = {
    date: dateStr,
    savedAt: new Date().toISOString(),
    scanType: isAfternoon ? "afternoon" : "morning",
    gamesScanned: gamesToScan.length,
    totalGames: games.length,
    batters: finalBatters,
    pitchers: finalPitchers,
    walks: finalWalks
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot saved: ${snapshotPath}`);
  console.log(`  ${finalBatters.length} batters (top 15), ${finalPitchers.length} pitchers, ${finalWalks.length} walks`);
}

main().catch(e => { console.error(e); process.exit(1); });
