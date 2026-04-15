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

// --- PITCHES-THROWN HELPERS ---

// Pull the last 5 starts across this and last season. Return avg pitches/start
// (only starts where the pitcher actually started, i.e. gamesStarted > 0, ip > 0).
async function getPitcherRecent5PitchAvg(pitcherId) {
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
    // Filter to starts only: gamesStarted >= 1 in that log row
    var starts = games.filter(function(g){
      var s = g.stat || {};
      return (parseInt(s.gamesStarted) || 0) >= 1 && (parseFloat(s.inningsPitched) || 0) > 0;
    });
    var recent = starts.slice(-5);
    if (recent.length === 0) return null;
    var totalPitches = 0, cnt = 0;
    for (var g of recent) {
      var s = g.stat || {};
      var p = parseInt(s.numberOfPitches) || parseInt(s.pitchesThrown) || 0;
      if (p > 0) { totalPitches += p; cnt++; }
    }
    if (cnt === 0) return null;
    return { avg: totalPitches / cnt, starts: cnt };
  } catch (e) { return null; }
}

// Pull the past 2 seasons (current + prior). Return avg pitches/start weighted by starts.
async function getPitcher2YrPitchAvg(pitcherId) {
  try {
    var year = new Date().getFullYear();
    var both = await Promise.all([
      fetchJSON(BASE + "/people/" + pitcherId + "/stats?stats=season&season=" + year + "&group=pitching"),
      fetchJSON(BASE + "/people/" + pitcherId + "/stats?stats=season&season=" + (year - 1) + "&group=pitching")
    ]);
    var totalPitches = 0, totalStarts = 0;
    for (var data of both) {
      for (var sg of (data.stats || [])) {
        if (sg.group && sg.group.displayName === "pitching") {
          var sp = sg.splits && sg.splits[0];
          if (sp && sp.stat) {
            var p = parseInt(sp.stat.numberOfPitches) || parseInt(sp.stat.pitchesThrown) || 0;
            var gs = parseInt(sp.stat.gamesStarted) || 0;
            if (gs > 0 && p > 0) {
              totalPitches += p;
              totalStarts += gs;
            }
          }
        }
      }
    }
    if (totalStarts === 0) return null;
    return { avg: totalPitches / totalStarts, starts: totalStarts };
  } catch (e) { return null; }
}

// BvP adjustment based on opposing lineup's history vs this pitcher.
// More PA means we expect MORE pitches; high K-rate BvP means more pitches per PA; low contact means more pitches.
// Returns an additive adjustment (typically -8 .. +8) applied to the base line.
function computeLineupBvPPitchAdj(matchups) {
  if (!matchups || matchups.length === 0) return 0;
  var totalPA = 0, totalAB = 0, totalK = 0, totalBB = 0, totalH = 0;
  for (var m of matchups) {
    var s = m.stat || {};
    totalPA += parseInt(s.plateAppearances) || 0;
    totalAB += parseInt(s.atBats) || 0;
    totalK  += parseInt(s.strikeOuts) || 0;
    totalBB += parseInt(s.baseOnBalls) || 0;
    totalH  += parseInt(s.hits) || 0;
  }
  if (totalPA < 10) return 0;
  var kRate = totalAB > 0 ? (totalK / totalAB) : 0;
  var bbRate = totalPA > 0 ? (totalBB / totalPA) : 0;
  var obp = totalPA > 0 ? ((totalH + totalBB) / totalPA) : 0;
  var adj = 0;
  // High lineup K-rate vs this pitcher -> more pitches per PA
  if (kRate >= 0.28) adj += 4;
  else if (kRate >= 0.23) adj += 2;
  else if (kRate < 0.15) adj -= 2;
  // High walk/obp vs this pitcher -> more base runners, more pitches
  if (bbRate >= 0.12) adj += 3;
  else if (bbRate < 0.05) adj -= 2;
  if (obp >= 0.360) adj += 3;
  else if (obp < 0.280) adj -= 2;
  // Dampen by sample size
  var sampleFactor = Math.min(totalPA / 60, 1);
  return Math.round(adj * sampleFactor);
}

// Weighted predicted line: 25% 2yr avg, 50% recent-5 avg, 25% lineup BvP adjustment.
// The BvP piece is added as an adjustment on top of the stats-based blend, scaled to 25% influence.
function computePitchLine(twoYr, recent5, bvpAdj) {
  var parts = [];
  if (twoYr && twoYr.avg > 0) parts.push({ w: 0.25, v: twoYr.avg });
  if (recent5 && recent5.avg > 0) parts.push({ w: 0.50, v: recent5.avg });
  if (parts.length === 0) return null;
  var totalW = 0, sum = 0;
  for (var p of parts) { totalW += p.w; sum += p.w * p.v; }
  var base = sum / totalW;
  // BvP adjustment gets the remaining 25% weight as a direct shift
  var line = base + (bvpAdj || 0);
  return Math.round(line * 2) / 2; // round to nearest 0.5
}

// Confidence score for the over/under call.
// Strong recent trends + large BvP sample push the confidence higher.
function computePitchScore(line, twoYr, recent5, matchupsCount, bvpAdj) {
  var score = 50;
  // Signal strength: agreement between recent5 and 2yr
  if (twoYr && recent5) {
    var diff = Math.abs(recent5.avg - twoYr.avg);
    if (diff < 3) score += 10;       // very stable
    else if (diff < 6) score += 5;
    else if (diff > 12) score -= 6;  // volatile
  }
  // Recent sample depth
  if (recent5 && recent5.starts >= 5) score += 6;
  else if (recent5 && recent5.starts >= 3) score += 3;
  // BvP sample depth adds confidence either direction
  if (matchupsCount >= 6) score += 6;
  else if (matchupsCount >= 4) score += 3;
  // Strong BvP adjustment means the matchup signal is clear
  var absAdj = Math.abs(bvpAdj || 0);
  if (absAdj >= 5) score += 4;
  else if (absAdj >= 3) score += 2;
  // Pitchers with very high recent averages (>100) tend to be workhorses — predictable
  if (recent5 && recent5.avg >= 100) score += 3;
  if (recent5 && recent5.avg < 75) score -= 3;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function pitchGrade(score) {
  if (score >= 80) return "A+";
  if (score >= 70) return "A";
  if (score >= 62) return "B+";
  if (score >= 55) return "B";
  if (score >= 45) return "C";
  if (score >= 35) return "D";
  return "F";
}

// Decide OVER or UNDER: compare weighted prediction (recent5 biased) against the rounded line.
// If recent5 > 2yr avg, lean OVER; if recent5 < 2yr avg, lean UNDER; BvP adj breaks ties.
function computeOverUnder(line, twoYr, recent5, bvpAdj) {
  // Raw (unrounded) expected value using same weights without BvP, then BvP pushes it
  var base = 0, w = 0;
  if (twoYr && twoYr.avg > 0) { base += 0.25 * twoYr.avg; w += 0.25; }
  if (recent5 && recent5.avg > 0) { base += 0.50 * recent5.avg; w += 0.50; }
  if (w === 0) return null;
  var expected = (base / w) + (bvpAdj || 0);
  if (expected > line + 0.25) return "OVER";
  if (expected < line - 0.25) return "UNDER";
  // Tie — use BvP direction
  if ((bvpAdj || 0) > 0) return "OVER";
  if ((bvpAdj || 0) < 0) return "UNDER";
  // Still tied — default to recent trend
  if (recent5 && twoYr && recent5.avg > twoYr.avg) return "OVER";
  return "UNDER";
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
  const allPitches = []; // pitches-thrown over/under predictions

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

    // --- PITCHES-THROWN SCORING ---
    console.log(`    Scanning pitches thrown for ${gameLabel}...`);
    if (homePitcher) {
      try {
        const [hp2yr, hpRecent5] = await Promise.all([
          getPitcher2YrPitchAvg(homePitcher.id),
          getPitcherRecent5PitchAvg(homePitcher.id)
        ]);
        const bvpAdj = computeLineupBvPPitchAdj(homeMatchupsForWhiff);
        const line = computePitchLine(hp2yr, hpRecent5, bvpAdj);
        if (line !== null) {
          const overUnder = computeOverUnder(line, hp2yr, hpRecent5, bvpAdj);
          const score = computePitchScore(line, hp2yr, hpRecent5, homeMatchupsForWhiff.length, bvpAdj);
          allPitches.push({
            pitcherId: homePitcher.id, pitcherName: homePitcher.fullName,
            team: homeAbbr, oppTeam: awayAbbr,
            line: line, overUnder: overUnder,
            pitchScore: score, grade: pitchGrade(score),
            recent5Avg: hpRecent5 ? Math.round(hpRecent5.avg * 10) / 10 : null,
            recent5Starts: hpRecent5 ? hpRecent5.starts : 0,
            twoYrAvg: hp2yr ? Math.round(hp2yr.avg * 10) / 10 : null,
            twoYrStarts: hp2yr ? hp2yr.starts : 0,
            bvpAdj: bvpAdj,
            lineupPA: homeMatchupsForWhiff.reduce((a, m) => a + (parseInt(m.stat.plateAppearances) || 0), 0),
            gamePk: game.gamePk, gameLabel
          });
        }
      } catch(e) {}
    }
    if (awayPitcher) {
      try {
        const [ap2yr, apRecent5] = await Promise.all([
          getPitcher2YrPitchAvg(awayPitcher.id),
          getPitcherRecent5PitchAvg(awayPitcher.id)
        ]);
        const bvpAdj2 = computeLineupBvPPitchAdj(awayMatchupsForWhiff);
        const line2 = computePitchLine(ap2yr, apRecent5, bvpAdj2);
        if (line2 !== null) {
          const overUnder2 = computeOverUnder(line2, ap2yr, apRecent5, bvpAdj2);
          const score2 = computePitchScore(line2, ap2yr, apRecent5, awayMatchupsForWhiff.length, bvpAdj2);
          allPitches.push({
            pitcherId: awayPitcher.id, pitcherName: awayPitcher.fullName,
            team: awayAbbr, oppTeam: homeAbbr,
            line: line2, overUnder: overUnder2,
            pitchScore: score2, grade: pitchGrade(score2),
            recent5Avg: apRecent5 ? Math.round(apRecent5.avg * 10) / 10 : null,
            recent5Starts: apRecent5 ? apRecent5.starts : 0,
            twoYrAvg: ap2yr ? Math.round(ap2yr.avg * 10) / 10 : null,
            twoYrStarts: ap2yr ? ap2yr.starts : 0,
            bvpAdj: bvpAdj2,
            lineupPA: awayMatchupsForWhiff.reduce((a, m) => a + (parseInt(m.stat.plateAppearances) || 0), 0),
            gamePk: game.gamePk, gameLabel
          });
        }
      } catch(e) {}
    }
  }

  allBatters.sort((a, b) => b.edgeScore - a.edgeScore);
  allPitchers.sort((a, b) => b.whiffScore - a.whiffScore);
  allPitches.sort((a, b) => b.pitchScore - a.pitchScore);

  const top15 = allBatters.slice(0, 15);
  // Top 5 pitches-thrown picks per day (requires at least B-grade confidence)
  const top5Pitches = allPitches.filter(p => p.pitchScore >= 55).slice(0, 5);

  let finalBatters = top15;
  let finalPitchers = allPitchers;
  let finalPitches = top5Pitches;

  if (isAfternoon && existingSnapshot) {
    const newGamePks = new Set(gamesToScan.map(g => g.gamePk));
    const existingBatters = existingSnapshot.batters.filter(b => !newGamePks.has(b.gamePk));
    const existingPitchers = existingSnapshot.pitchers.filter(p => !newGamePks.has(p.gamePk));
    const existingPitches = (existingSnapshot.pitches || []).filter(p => !newGamePks.has(p.gamePk));

    const combined = [...existingBatters, ...top15];
    combined.sort((a, b) => b.edgeScore - a.edgeScore);
    finalBatters = combined.slice(0, 15);

    finalPitchers = [...existingPitchers, ...allPitchers];
    finalPitchers.sort((a, b) => b.whiffScore - a.whiffScore);

    const combinedPitches = [...existingPitches, ...allPitches.filter(p => p.pitchScore >= 55)];
    combinedPitches.sort((a, b) => b.pitchScore - a.pitchScore);
    finalPitches = combinedPitches.slice(0, 5);

    console.log(`Merged: ${existingBatters.length} existing + ${top15.length} new batters`);
    console.log(`Merged: ${existingPitchers.length} existing + ${allPitchers.length} new pitchers`);
    console.log(`Merged pitches: ${existingPitches.length} existing + ${allPitches.filter(p => p.pitchScore >= 55).length} new -> top 5`);
  }

  const snapshot = {
    date: dateStr,
    savedAt: new Date().toISOString(),
    scanType: isAfternoon ? "afternoon" : "morning",
    gamesScanned: gamesToScan.length,
    totalGames: games.length,
    batters: finalBatters,
    pitchers: finalPitchers,
    pitches: finalPitches
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot saved: ${snapshotPath}`);
  console.log(`  ${finalBatters.length} batters (top 15), ${finalPitchers.length} pitchers, ${finalPitches.length} pitches picks`);
}

main().catch(e => { console.error(e); process.exit(1); });
