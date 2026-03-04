// ════════════════════════════════════════════════════════════════════════
//  VF SIGNAL PREDICTOR v7.2 — COMPLETE ENGINE
//  Full implementation with BetPawa Zambia / Kiron VFL API connection
// ════════════════════════════════════════════════════════════════════════

'use strict';

// ─── GLOBAL STATE ─────────────────────────────────────────────────────
let PREDICTOR_ENABLED = true;

// Self-learning thresholds
let T = {
  minSignalRate: 50,
  minStrength: 40,
  over35TriggerRate: 65,
  bttsMinRate: 70,
  accaConfFloor: 85,
  underFilterSensitivity: 2,
  minAttackStrength: 1.0,
  maxDefensiveVulnerability: 2.5,
  minMEI: 50,
  minEliteOverProb: 60,
};

// Signal state
const VF = {
  matches: [],
  patterns: [],
  leagueTable: [],
  pruneLog: [],
  meta: {
    liveHits: 0, simCount: 0, lastRun: null,
    running: false, scans: 0, season: null, matchday: null,
    apiSource: null, apiBaseFound: null, prunedCount: 0
  },
  scanTimer: null,
  scanning: false,
};

// Predictor state
const S = {
  predictions: [],
  results: [],
  roundInfo: null,
  countdownInterval: null,
  cardTimerInterval: null,
  refreshTimeout: null,
  db: null,
  historyLoaded: false,
  learnings: { learnCycles: 0, failuresLearned: 0, log: [] }
};

// Constants
const MIN_SIGNAL_OCC = 30;
const TOP_PERFORMER_RATE = 70;
const TOP_PERFORMER_OCC = 50;
const PRUNE_MIN_OCC = 50;
const PRUNE_MAX_RATE = 40;
const MAX_RESULTS_SHOWN = 20;
const MATCHDAYS_AHEAD = 2;

// API Configuration
const API_BASE = 'https://betpawa-proxy-production.up.railway.app';
const API_BRAND = 'betpawa-zambia';

const KIRON_ENDPOINTS = [
  {
    base: 'https://api.kir0n.com',
    paths: {
      standings: '/v1/betpawa-zm/vfl/standings',
      results: '/v1/betpawa-zm/vfl/results',
      fixtures: '/v1/betpawa-zm/vfl/fixtures',
      season: '/v1/betpawa-zm/vfl/season'
    }
  }
];

const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => url // Direct attempt as fallback
];

const LEAGUES = [
  { id: 'vfl', name: 'Virtual Football League', short: 'VFL' },
  { id: 'vfwc', name: 'Virtual World Cup', short: 'VFWC' },
  { id: 'vfec', name: 'Virtual Euro Cup', short: 'VFEC' },
  { id: 'vflc', name: 'Virtual Champions League', short: 'VFLC' },
  { id: 'vfafc', name: 'Virtual Africa Cup', short: 'VFAFC' },
  { id: 'vfpl', name: 'Virtual Premier League', short: 'VFPL' },
  { id: 'vfbl', name: 'Virtual Bundesliga', short: 'VFBL' },
];

const VFL_TEAMS = {
  vfl: ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Tottenham', 'Man Utd', 'Everton', 'Newcastle', 'Aston Villa', 'West Ham', 'Leicester', 'Leeds'],
  vfwc: ['Brazil', 'France', 'Germany', 'Argentina', 'England', 'Spain', 'Portugal', 'Netherlands', 'Italy', 'Belgium', 'Uruguay', 'Croatia'],
};

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function el(id, val) {
  const e = typeof id === 'string' ? document.getElementById(id) : id;
  if (!e) return null;
  if (val === undefined) return e;
  if (typeof val === 'string' && !val.includes('<')) e.textContent = val;
  else e.innerHTML = val;
  return e;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ts() { return new Date().toLocaleTimeString(); }

function miniHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16) + Math.random().toString(36).slice(2, 5);
}

function isTopPerformer(p) {
  return p.over35_rate >= TOP_PERFORMER_RATE && p.occurrences >= TOP_PERFORMER_OCC;
}

// ─── INDEXEDDB ────────────────────────────────────────────────────────
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('BetpawaSignalPredV72', 2);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => { S.db = req.result; res(); };
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('mlData')) db.createObjectStore('mlData', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('learnings')) db.createObjectStore('learnings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('signalData')) db.createObjectStore('signalData', { keyPath: 'key' });
    };
  });
}

function dbGet(store, key) {
  return new Promise(r => {
    if (!S.db) return r(null);
    const tx = S.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => r(req.result);
    req.onerror = () => r(null);
  });
}

function dbPut(store, val) {
  return new Promise(r => {
    if (!S.db) return r(false);
    const tx = S.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => r(true);
    tx.onerror = () => r(false);
  });
}

function dbAdd(store, val) {
  return new Promise(r => {
    if (!S.db) return r(false);
    const tx = S.db.transaction(store, 'readwrite');
    tx.objectStore(store).add(val);
    tx.oncomplete = () => r(true);
    tx.onerror = () => r(false);
  });
}

function dbGetAll(store) {
  return new Promise(r => {
    if (!S.db) return r([]);
    const tx = S.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => r(req.result || []);
    req.onerror = () => r([]);
  });
}

function dbCount(store) {
  return new Promise(r => {
    if (!S.db) return r(0);
    const tx = S.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).count();
    req.onsuccess = () => r(req.result);
    req.onerror = () => r(0);
  });
}

function dbClear(store) {
  return new Promise(r => {
    if (!S.db) return r(false);
    const tx = S.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => r(true);
    tx.onerror = () => r(false);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  API CONNECTION LOGIC
// ═══════════════════════════════════════════════════════════════════════

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[Fetch] Attempt ${attempt + 1}/${maxRetries}: ${url}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`[Fetch] Success: ${url}`);
      return data;
      
    } catch (error) {
      lastError = error;
      console.warn(`[Fetch] Attempt ${attempt + 1} failed:`, error.message);
      
      if (attempt < maxRetries - 1) {
        await delay(1000 * (attempt + 1)); // Exponential backoff
      }
    }
  }
  
  throw lastError;
}

async function fetchBetPawaAPI(endpoint) {
  const url = `${API_BASE}/${API_BRAND}/${endpoint}`;
  
  try {
    console.log(`[BetPawa API] Fetching: ${endpoint}`);
    const data = await fetchWithRetry(url);
    return data;
  } catch (error) {
    console.error(`[BetPawa API] Failed to fetch ${endpoint}:`, error);
    return null;
  }
}

async function fetchKironAPI(path, useProxy = true) {
  const endpoint = KIRON_ENDPOINTS[0];
  const fullUrl = endpoint.base + endpoint.paths[path];
  
  if (useProxy) {
    // Try with CORS proxies
    for (const proxyFn of PROXIES) {
      try {
        const proxiedUrl = proxyFn(fullUrl);
        console.log(`[Kiron API] Trying proxy: ${proxiedUrl}`);
        const data = await fetchWithRetry(proxiedUrl, {}, 2);
        return data;
      } catch (error) {
        console.warn(`[Kiron API] Proxy failed:`, error.message);
      }
    }
  }
  
  // Direct attempt
  try {
    console.log(`[Kiron API] Direct attempt: ${fullUrl}`);
    const data = await fetchWithRetry(fullUrl, {}, 1);
    return data;
  } catch (error) {
    console.error(`[Kiron API] All attempts failed for ${path}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SIGNAL PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════

async function saveSignalsToDB() {
  try {
    await dbPut('signalData', { key: 'matches', value: VF.matches.slice(-2000), savedAt: Date.now() });
    await dbPut('signalData', { key: 'patterns', value: VF.patterns, savedAt: Date.now() });
    await dbPut('signalData', { key: 'leagueTable', value: VF.leagueTable, savedAt: Date.now() });
    await dbPut('signalData', { key: 'meta', value: VF.meta, savedAt: Date.now() });
    
    const count = VF.matches.length;
    el('persistBadge', `💾 Saved: ${count.toLocaleString()}`);
    el('adjSigSaved', count.toLocaleString());
    
    console.log(`[DB] Saved ${count} matches, ${VF.patterns.length} patterns`);
  } catch (e) {
    console.warn('[DB] Save failed:', e);
  }
}

async function loadSignalsFromDB() {
  try {
    const m = await dbGet('signalData', 'matches');
    const p = await dbGet('signalData', 'patterns');
    const lt = await dbGet('signalData', 'leagueTable');
    const me = await dbGet('signalData', 'meta');
    
    if (m && m.value) VF.matches = m.value;
    if (p && p.value) VF.patterns = p.value;
    if (lt && lt.value) VF.leagueTable = lt.value;
    if (me && me.value) Object.assign(VF.meta, me.value);
    
    console.log(`[DB] Restored: ${VF.matches.length} matches, ${VF.patterns.length} patterns`);
    return VF.matches.length > 0;
  } catch (e) {
    console.warn('[DB] Load failed:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════

function sigStr(rate, n) {
  return Math.round((rate / 100) * 70 + Math.min(n / 60, 1) * 30);
}

function bkStats(list) {
  const o35 = list.filter(m => m.over35).length;
  const rate = list.length ? Math.round(o35 / list.length * 1000) / 10 : 0;
  const avg = list.length ? Math.round(list.reduce((s, m) => s + (m.total_goals || 0), 0) / list.length * 100) / 100 : 0;
  return { n: list.length, o35, rate, avg };
}

function mkP(type, league, desc, st, details) {
  return {
    type,
    league,
    description: desc,
    occurrences: st.n,
    over35_rate: st.rate,
    avg_goals: st.avg,
    signal_strength: sigStr(st.rate, st.n),
    details
  };
}

function detectPatterns(matches) {
  if (!matches.length) return [];
  
  const patterns = [];
  const byLeague = {};
  
  // Group by league
  matches.forEach(m => {
    if (!byLeague[m.league]) byLeague[m.league] = [];
    byLeague[m.league].push(m);
  });
  
  // 1. ODDS RANGE PATTERNS
  const oddsRanges = [
    { min: 1.0, max: 1.5, desc: 'Heavy Favorites (1.0-1.5)' },
    { min: 1.5, max: 2.0, desc: 'Strong Favorites (1.5-2.0)' },
    { min: 2.0, max: 3.0, desc: 'Moderate Favorites (2.0-3.0)' },
    { min: 3.0, max: 5.0, desc: 'Balanced Odds (3.0-5.0)' },
    { min: 5.0, max: 99, desc: 'Underdogs (5.0+)' }
  ];
  
  oddsRanges.forEach(range => {
    const filtered = matches.filter(m =>
      m.home_odds >= range.min && m.home_odds < range.max
    );
    if (filtered.length >= 15) {
      const st = bkStats(filtered);
      patterns.push(mkP('Odds Range', 'All', range.desc, st, { range }));
    }
  });
  
  // 2. TEAM SIGNALS
  Object.keys(VFL_TEAMS).forEach(leagueId => {
    VFL_TEAMS[leagueId].forEach(team => {
      const teamMatches = matches.filter(m =>
        m.home_team === team || m.away_team === team
      );
      if (teamMatches.length >= 20) {
        const st = bkStats(teamMatches);
        patterns.push(mkP('Team Signal', leagueId, `${team} matches`, st, { team }));
      }
    });
  });
  
  // 3. LEAGUE PATTERNS
  Object.keys(byLeague).forEach(league => {
    const lm = byLeague[league];
    if (lm.length >= 30) {
      const st = bkStats(lm);
      patterns.push(mkP('League Pattern', league, `${league} overall trend`, st, { league }));
    }
  });
  
  // 4. HEAD-TO-HEAD
  const h2hMap = {};
  matches.forEach(m => {
    const key = [m.home_team, m.away_team].sort().join('|');
    if (!h2hMap[key]) h2hMap[key] = [];
    h2hMap[key].push(m);
  });
  
  Object.entries(h2hMap).forEach(([key, h2hMatches]) => {
    if (h2hMatches.length >= 5) {
      const [t1, t2] = key.split('|');
      const st = bkStats(h2hMatches);
      patterns.push(mkP('Head-to-Head', h2hMatches[0].league, `${t1} vs ${t2}`, st, { teams: [t1, t2] }));
    }
  });
  
  // 5. DRAW ODDS RANGES
  const drawRanges = [
    { min: 0, max: 2.5, desc: 'Very Low Draw Odds (<2.5)' },
    { min: 2.5, max: 3.5, desc: 'Low Draw Odds (2.5-3.5)' },
    { min: 3.5, max: 5.0, desc: 'Normal Draw Odds (3.5-5.0)' },
    { min: 5.0, max: 99, desc: 'High Draw Odds (5.0+)' }
  ];
  
  drawRanges.forEach(range => {
    const filtered = matches.filter(m =>
      m.draw_odds >= range.min && m.draw_odds < range.max
    );
    if (filtered.length >= 20) {
      const st = bkStats(filtered);
      patterns.push(mkP('Draw Odds', 'All', range.desc, st, { range }));
    }
  });
  
  // 6. SCORELINE PATTERNS
  const scorelines = {};
  matches.forEach(m => {
    const sc = `${m.home_score}-${m.away_score}`;
    if (!scorelines[sc]) scorelines[sc] = [];
    scorelines[sc].push(m);
  });
  
  Object.entries(scorelines).forEach(([sc, scMatches]) => {
    if (scMatches.length >= 15) {
      const st = bkStats(scMatches);
      patterns.push(mkP('Scoreline', 'All', `Common result: ${sc}`, st, { scoreline: sc }));
    }
  });
  
  console.log(`[Patterns] Detected ${patterns.length} patterns from ${matches.length} matches`);
  return patterns;
}

function qualifiedSignals() {
  return VF.patterns.filter(p =>
    p.occurrences >= MIN_SIGNAL_OCC &&
    p.over35_rate >= T.minSignalRate &&
    p.signal_strength >= T.minStrength
  );
}

function topPerformerSignals() {
  return qualifiedSignals().filter(isTopPerformer);
}

// ═══════════════════════════════════════════════════════════════════════
//  ADVANCED STATISTICAL CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════

function calculateTeamMetrics(homeTeam, awayTeam, matches) {
  const homeMatches = matches.filter(m =>
    m.home_team === homeTeam || m.away_team === homeTeam
  ).slice(-10);
  
  const awayMatches = matches.filter(m =>
    m.home_team === awayTeam || m.away_team === awayTeam
  ).slice(-10);
  
  function calcMetrics(team, teamMatches) {
    if (teamMatches.length === 0) return null;
    
    let goalsScored = 0, goalsConceded = 0, cleanSheets = 0, twoPlusConceded = 0;
    let totalGoalsInMatches = 0, over35Count = 0;
    
    teamMatches.forEach(m => {
      const isHome = m.home_team === team;
      const scored = isHome ? m.home_score : m.away_score;
      const conceded = isHome ? m.away_score : m.home_score;
      
      goalsScored += scored;
      goalsConceded += conceded;
      if (conceded === 0) cleanSheets++;
      if (conceded >= 2) twoPlusConceded++;
      totalGoalsInMatches += m.total_goals;
      if (m.over35) over35Count++;
    });
    
    const n = teamMatches.length;
    return {
      AS: (goalsScored / n).toFixed(2),
      GC: (goalsConceded / n).toFixed(2),
      SR: ((goalsScored / n) * 100 / 3).toFixed(1),
      CS: cleanSheets,
      '2GC': twoPlusConceded,
      AvgTG: (totalGoalsInMatches / n).toFixed(2),
      OverRate: ((over35Count / n) * 100).toFixed(1),
      AIS: ((goalsScored / n) * (over35Count / n) * 100).toFixed(1),
      DCI: (((cleanSheets / n) * 50 + (1 - goalsConceded / (n * 3)) * 50)).toFixed(1)
    };
  }
  
  const homeMetrics = calcMetrics(homeTeam, homeMatches);
  const awayMetrics = calcMetrics(awayTeam, awayMatches);
  
  return { home: homeMetrics, away: awayMetrics };
}

function calculateH2HMetrics(homeTeam, awayTeam, matches) {
  const h2h = matches.filter(m =>
    (m.home_team === homeTeam && m.away_team === awayTeam) ||
    (m.home_team === awayTeam && m.away_team === homeTeam)
  ).slice(-5);
  
  if (h2h.length < 2) return null;
  
  let homeWins = 0, awayWins = 0, totalGoals = 0;
  h2h.forEach(m => {
    if (m.home_team === homeTeam) {
      if (m.home_score > m.away_score) homeWins++;
      else if (m.away_score > m.home_score) awayWins++;
    } else {
      if (m.away_score > m.home_score) homeWins++;
      else if (m.home_score > m.away_score) awayWins++;
    }
    totalGoals += m.total_goals;
  });
  
  return {
    HDW_A: homeWins / h2h.length,
    HDW_B: awayWins / h2h.length,
    AvgGoals: totalGoals / h2h.length,
    Meetings: h2h.length
  };
}

function calculateAdvancedMatchMetrics(homeTeam, awayTeam, matches, eventOdds) {
  const teamMetrics = calculateTeamMetrics(homeTeam, awayTeam, matches);
  const h2hMetrics = calculateH2HMetrics(homeTeam, awayTeam, matches);
  
  if (!teamMetrics.home || !teamMetrics.away) return null;
  
  const hm = teamMetrics.home;
  const am = teamMetrics.away;
  
  const homeOdds = eventOdds?.home_win || 2.0;
  const awayOdds = eventOdds?.away_win || 2.0;
  const FAD_A = homeOdds < awayOdds ? (1 / homeOdds) * 100 : 0;
  const FAD_B = awayOdds < homeOdds ? (1 / awayOdds) * 100 : 0;
  
  const avgDefense = (parseFloat(hm.GC) + parseFloat(am.GC)) / 2;
  const avgAttack = (parseFloat(hm.AS) + parseFloat(am.AS)) / 2;
  const LMP = avgDefense < 1.5 && avgAttack < 1.8 ? 1 : 0;
  
  const drawOdds = eventOdds?.draw || 3.5;
  const UnderTrap = (drawOdds < 3.0 && avgDefense < 1.6 && Math.abs(homeOdds - awayOdds) < 0.5) ? 1 : 0;
  
  const attackPower = (parseFloat(hm.AS) + parseFloat(am.AS)) / 2;
  const over35History = (parseFloat(hm.OverRate) + parseFloat(am.OverRate)) / 2;
  const MEI = Math.round(
    (attackPower / 3) * 30 +
    (over35History / 100) * 40 +
    (h2hMetrics ? (h2hMetrics.AvgGoals / 5) * 30 : 15)
  );
  
  const eliteAttack = parseFloat(hm.AS) >= 2.0 && parseFloat(am.AS) >= 2.0;
  const eliteHistory = parseFloat(hm.OverRate) >= 60 && parseFloat(am.OverRate) >= 60;
  const EliteOver = (eliteAttack || eliteHistory) ? 1 : 0;
  const EliteOverProb = Math.round(
    (parseFloat(hm.AIS) + parseFloat(am.AIS)) / 2 * 0.6 +
    (over35History) * 0.4
  );
  
  return {
    AS_A: parseFloat(hm.AS), GC_A: parseFloat(hm.GC), SR_A: parseFloat(hm.SR),
    CS_A: hm.CS, '2GC_A': hm['2GC'], AvgTG_A: parseFloat(hm.AvgTG),
    OverRate_A: parseFloat(hm.OverRate), AIS_A: parseFloat(hm.AIS), DCI_A: parseFloat(hm.DCI),
    AS_B: parseFloat(am.AS), GC_B: parseFloat(am.GC), SR_B: parseFloat(am.SR),
    CS_B: am.CS, '2GC_B': am['2GC'], AvgTG_B: parseFloat(am.AvgTG),
    OverRate_B: parseFloat(am.OverRate), AIS_B: parseFloat(am.AIS), DCI_B: parseFloat(am.DCI),
    HDW_A: h2hMetrics ? h2hMetrics.HDW_A : 0.5,
    HDW_B: h2hMetrics ? h2hMetrics.HDW_B : 0.5,
    FAD_A, FAD_B, LMP, UnderTrap, MEI, EliteOver, EliteOverProb
  };
}

function applyAdvancedFilterGate(advMetrics) {
  if (!advMetrics) {
    return {
      pass: false, score: 0, verdict: 'REJECTED',
      reason: 'Insufficient match history for statistical analysis',
      details: []
    };
  }
  
  const checks = [];
  let passCount = 0;
  let score = 0;
  
  const combinedAttack = (advMetrics.AS_A + advMetrics.AS_B) / 2;
  const attackPass = combinedAttack >= T.minAttackStrength;
  checks.push({
    name: 'Combined Attack Strength',
    value: combinedAttack.toFixed(2),
    threshold: `≥${T.minAttackStrength}`,
    pass: attackPass
  });
  if (attackPass) { passCount++; score += 15; }
  
  const combinedDefense = (advMetrics.GC_A + advMetrics.GC_B) / 2;
  const defensePass = combinedDefense >= 1.2 && combinedDefense <= T.maxDefensiveVulnerability;
  checks.push({
    name: 'Defensive Vulnerability',
    value: combinedDefense.toFixed(2),
    threshold: `1.2-${T.maxDefensiveVulnerability}`,
    pass: defensePass
  });
  if (defensePass) { passCount++; score += 15; }
  
  const avgOverRate = (advMetrics.OverRate_A + advMetrics.OverRate_B) / 2;
  const overRatePass = avgOverRate >= 50;
  checks.push({
    name: 'Avg Over 3.5 Rate',
    value: avgOverRate.toFixed(1) + '%',
    threshold: '≥50%',
    pass: overRatePass
  });
  if (overRatePass) { passCount++; score += 20; }
  
  const meiPass = advMetrics.MEI >= T.minMEI;
  checks.push({
    name: 'Match Excitement Index',
    value: advMetrics.MEI.toString(),
    threshold: `≥${T.minMEI}`,
    pass: meiPass
  });
  if (meiPass) { passCount++; score += 20; }
  
  const underTrapPass = advMetrics.UnderTrap === 0;
  checks.push({
    name: 'Under Trap Risk',
    value: advMetrics.UnderTrap === 1 ? 'DETECTED' : 'Clear',
    threshold: 'Must be clear',
    pass: underTrapPass
  });
  if (underTrapPass) { passCount++; score += 10; }
  
  const lmpPass = advMetrics.LMP === 0;
  checks.push({
    name: 'Low-Scoring Risk',
    value: advMetrics.LMP === 1 ? 'HIGH' : 'Low',
    threshold: 'Must be low',
    pass: lmpPass
  });
  if (lmpPass) { passCount++; score += 10; }
  
  const elitePass = advMetrics.EliteOverProb >= T.minEliteOverProb;
  checks.push({
    name: 'Elite Over Probability',
    value: advMetrics.EliteOverProb.toFixed(0) + '%',
    threshold: `≥${T.minEliteOverProb}%`,
    pass: elitePass
  });
  if (elitePass) { passCount++; score += 10; }
  
  let verdict, pass;
  if (passCount >= 6 && score >= 80) {
    verdict = 'ELITE';
    pass = true;
  } else if (passCount >= 5 && score >= 65) {
    verdict = 'APPROVED';
    pass = true;
  } else if (passCount >= 4 && score >= 50) {
    verdict = 'CAUTION';
    pass = true;
  } else {
    verdict = 'REJECTED';
    pass = false;
  }
  
  return {
    pass, score, verdict,
    passedChecks: passCount,
    totalChecks: checks.length,
    details: checks,
    metrics: advMetrics
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  12-POINT UNDER-FILTER SYSTEM
// ═══════════════════════════════════════════════════════════════════════

function applyUnderFilters(pred, eventOdds) {
  const filters = [];
  let triggered = 0;
  
  const u35Odds = eventOdds?.under_35 || 1.6;
  const o35Odds = eventOdds?.over_35 || 2.3;
  const homeOdds = eventOdds?.home_win || 2.0;
  const awayOdds = eventOdds?.away_win || 2.0;
  const drawOdds = eventOdds?.draw || 3.5;
  
  // F1: Market Odds Check
  if (u35Odds < 1.45 || o35Odds > 2.8) {
    filters.push({ id: 'F1', name: 'Market Odds Check', reason: `Under 3.5 @ ${u35Odds} / Over 3.5 @ ${o35Odds}` });
    triggered++;
  }
  
  // F2: Dominant Favorite
  if (homeOdds < 1.25) {
    filters.push({ id: 'F2', name: 'Dominant Favorite', reason: `Home odds ${homeOdds} (heavy favorite)` });
    triggered++;
  }
  
  // F3: Marginal Signal Rate
  if (pred.avgSignalRate < 58) {
    filters.push({ id: 'F3', name: 'Marginal Signal Rate', reason: `Avg signal rate ${pred.avgSignalRate}% below 58%` });
    triggered++;
  }
  
  // F4: Support-Only Signals
  if (pred.primarySignals.length === 0) {
    filters.push({ id: 'F4', name: 'Support-Only Signals', reason: 'No primary signals (Team/H2H/League)' });
    triggered++;
  }
  
  // F5: H2H Low Goals History
  const h2hSignal = pred.signals.find(s => s.type === 'Head-to-Head');
  if (h2hSignal && h2hSignal.avg_goals < 2.8) {
    filters.push({ id: 'F5', name: 'H2H Low Goals', reason: `H2H avg ${h2hSignal.avg_goals} goals` });
    triggered++;
  }
  
  // F6: League Low Average
  const leagueSignal = pred.signals.find(s => s.type === 'League Pattern');
  if (leagueSignal && leagueSignal.avg_goals < 2.5) {
    filters.push({ id: 'F6', name: 'League Low Average', reason: `League avg ${leagueSignal.avg_goals} goals` });
    triggered++;
  }
  
  // F7: Close Draw Odds
  if (drawOdds < 2.8) {
    filters.push({ id: 'F7', name: 'Close Draw Odds', reason: `Draw odds ${drawOdds} suggest tight match` });
    triggered++;
  }
  
  // F8: Even Money Trap
  if (homeOdds >= 1.7 && homeOdds <= 2.4 && awayOdds >= 1.7 && awayOdds <= 2.4) {
    filters.push({ id: 'F8', name: 'Even Money Trap', reason: 'Both teams evenly matched' });
    triggered++;
  }
  
  // F9: Scoreline Conflict
  const scoreSignal = pred.signals.find(s => s.type === 'Scoreline');
  if (scoreSignal) {
    const [h, a] = (scoreSignal.details?.scoreline || '0-0').split('-').map(Number);
    if (h + a < 4) {
      filters.push({ id: 'F9', name: 'Scoreline Conflict', reason: `Common scoreline ${scoreSignal.details.scoreline} is under 3.5` });
      triggered++;
    }
  }
  
  // F10: Signal Conflict Count
  const weakSignals = pred.signals.filter(s => s.over35_rate < 60).length;
  if (weakSignals > pred.signals.length / 2) {
    filters.push({ id: 'F10', name: 'Signal Conflict', reason: `${weakSignals}/${pred.signals.length} signals below 60%` });
    triggered++;
  }
  
  // F11: Confidence/Rate Mismatch
  if (pred.confidence >= 80 && pred.avgSignalRate < 62) {
    filters.push({ id: 'F11', name: 'Confidence/Rate Mismatch', reason: `High confidence (${pred.confidence}%) but low avg rate (${pred.avgSignalRate}%)` });
    triggered++;
  }
  
  // F12: Defensive Teams Check
  const homeTeamSig = pred.signals.find(s => s.type === 'Team Signal' && s.details?.team === pred.homeCode);
  const awayTeamSig = pred.signals.find(s => s.type === 'Team Signal' && s.details?.team === pred.awayCode);
  if (homeTeamSig && awayTeamSig && homeTeamSig.over35_rate < 55 && awayTeamSig.over35_rate < 55) {
    filters.push({ id: 'F12', name: 'Defensive Teams', reason: 'Both teams defensive (<55% over rate)' });
    triggered++;
  }
  
  const blocked = triggered >= T.underFilterSensitivity + 1; // 3+ triggers = blocked
  const caution = triggered === T.underFilterSensitivity; // 2 triggers = caution
  
  return { blocked, caution, triggered, filters, total: 12 };
}

// ═══════════════════════════════════════════════════════════════════════
//  PREDICTION GENERATION
// ═══════════════════════════════════════════════════════════════════════

function findMatchingSignals(homeCode, awayCode, leagueApiName) {
  const qualified = qualifiedSignals();
  const matches = [];
  
  qualified.forEach(sig => {
    let relevanceScore = 0;
    let match = false;
    
    switch (sig.type) {
      case 'Team Signal':
        if (sig.details.team === homeCode || sig.details.team === awayCode) {
          match = true;
          relevanceScore = 3;
        }
        break;
      
      case 'Head-to-Head':
        if (sig.details.teams.includes(homeCode) && sig.details.teams.includes(awayCode)) {
          match = true;
          relevanceScore = 4;
        }
        break;
      
      case 'League Pattern':
        if (sig.league === leagueApiName || sig.league === 'All') {
          match = true;
          relevanceScore = sig.league === leagueApiName ? 2 : 1;
        }
        break;
      
      case 'Odds Range':
      case 'Draw Odds':
      case 'Underdog':
      case 'Scoreline':
        match = true;
        relevanceScore = 1;
        break;
    }
    
    if (match) {
      matches.push({ ...sig, relevanceScore });
    }
  });
  
  return matches.sort((a, b) => b.relevanceScore - a.relevanceScore || b.over35_rate - a.over35_rate);
}

function calcSignalConfidence(signals, primaryCount) {
  if (!signals.length) return 0;
  
  const avgRate = signals.reduce((s, p) => s + p.over35_rate, 0) / signals.length;
  const topPerformersCount = signals.filter(isTopPerformer).length;
  const strengthScore = signals.reduce((s, p) => s + p.signal_strength, 0) / signals.length;
  
  let confidence = avgRate * 0.5 +
                   (primaryCount / Math.max(signals.length, 1)) * 20 +
                   (strengthScore / 100) * 20 +
                   (topPerformersCount / Math.max(signals.length, 1)) * 10;
  
  return Math.min(Math.round(confidence), 99);
}

function generatePrediction(homeCode, awayCode, leagueApiName, roundNum, totalRounds, roundId, season, round, eventOdds) {
  const signals = findMatchingSignals(homeCode, awayCode, leagueApiName);
  const primarySignals = signals.filter(s => s.relevanceScore >= 2);
  const passes = primarySignals.length >= 1 || (signals.length >= 3 && signals.filter(s => s.over35_rate >= 60).length >= 2);
  
  if (!passes) {
    return {
      homeCode, awayCode, leagueApiName, passes: false,
      reason: 'No qualified signals found',
      signals: signals.slice(0, 3),
      confidence: 0, bet: '—', timestamp: Date.now(),
      roundId, outcome: null, filterResult: null,
      advancedFilterResult: null, eventOdds
    };
  }
  
  const useSignals = primarySignals.length > 0
    ? [...primarySignals, ...signals.filter(s => s.relevanceScore < 2).slice(0, 3)]
    : signals.slice(0, 5);
  
  const avgRate = useSignals.reduce((s, p) => s + p.over35_rate, 0) / useSignals.length;
  const confidence = calcSignalConfidence(useSignals, primarySignals.length);
  const bet = avgRate >= T.over35TriggerRate
    ? (confidence >= 88 ? 'OVER 3.5 + BTTS' : 'OVER 3.5')
    : 'OVER 2.5';
  
  const filterResult = applyUnderFilters(
    { homeCode, awayCode, leagueApiName, signals: useSignals, primarySignals, avgSignalRate: Math.round(avgRate * 10) / 10, confidence, bet },
    eventOdds
  );
  
  const advMetrics = calculateAdvancedMatchMetrics(homeCode, awayCode, VF.matches, eventOdds);
  const advancedFilterResult = applyAdvancedFilterGate(advMetrics);
  
  const finalFiltered = filterResult.blocked || !advancedFilterResult.pass;
  const finalCaution = !finalFiltered && (filterResult.caution || advancedFilterResult.verdict === 'CAUTION');
  
  return {
    homeCode, awayCode, leagueApiName, passes: true,
    signals: useSignals, primarySignals,
    avgSignalRate: Math.round(avgRate * 10) / 10,
    topSignal: useSignals[0] || null,
    confidence, bet, roundId, season,
    roundStart: round?.tradingTime?.start,
    timestamp: Date.now(), outcome: null,
    actualScore: null, filterResult, advancedFilterResult,
    eventOdds, filteredOut: finalFiltered, cautionFlag: finalCaution
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN SIGNAL SCANNER
// ═══════════════════════════════════════════════════════════════════════

async function scanSignalData() {
  if (VF.scanning) {
    console.log('[Scanner] Already running');
    return;
  }
  
  VF.scanning = true;
  el('scStatus', 'Scanning Kiron VFL API...');
  el('scDot').className = 'sc-dot';
  
  try {
    // Fetch historical results from Kiron API
    console.log('[Scanner] Fetching Kiron VFL results...');
    const resultsData = await fetchKironAPI('results');
    
    if (!resultsData || !resultsData.results) {
      throw new Error('No results data received');
    }
    
    // Process results
    const newMatches = [];
    resultsData.results.forEach(result => {
      const match = {
        id: result.id || miniHash(`${result.home}-${result.away}-${result.date}`),
        league: result.league || 'vfl',
        home_team: result.home || result.homeTeam,
        away_team: result.away || result.awayTeam,
        home_score: result.homeScore || 0,
        away_score: result.awayScore || 0,
        total_goals: (result.homeScore || 0) + (result.awayScore || 0),
        over35: ((result.homeScore || 0) + (result.awayScore || 0)) > 3.5,
        date: result.date || Date.now(),
        home_odds: result.homeOdds || 2.0,
        away_odds: result.awayOdds || 2.0,
        draw_odds: result.drawOdds || 3.5
      };
      newMatches.push(match);
    });
    
    // Merge with existing matches
    const existingIds = new Set(VF.matches.map(m => m.id));
    const uniqueNew = newMatches.filter(m => !existingIds.has(m.id));
    
    if (uniqueNew.length > 0) {
      VF.matches.push(...uniqueNew);
      console.log(`[Scanner] Added ${uniqueNew.length} new matches`);
    }
    
    // Keep only recent matches (last 2000)
    if (VF.matches.length > 2000) {
      VF.matches = VF.matches.slice(-2000);
    }
    
    // Detect patterns
    VF.patterns = detectPatterns(VF.matches);
    
    // Update UI
    const qs = qualifiedSignals();
    const top = topPerformerSignals();
    
    el('dqMatches', VF.matches.length.toLocaleString());
    el('dqPatterns', VF.patterns.length.toLocaleString());
    el('dqQualified', qs.length.toLocaleString());
    el('scActive', qs.length);
    el('scTop', top.length);
    el('scPill', `${qs.length} signals`);
    el('scPill').className = qs.length > 0 ? 'sc-pill active' : 'sc-pill waiting';
    el('dqDot').className = 'dq-dot live';
    el('dqStatus', 'Live');
    el('scStatus', `Kiron API: ${qs.length} qualified signals`);
    el('scDot').className = 'sc-dot';
    
    // Save to DB
    await saveSignalsToDB();
    
    console.log(`[Scanner] Complete: ${VF.matches.length} matches, ${qs.length} qualified signals`);
    
  } catch (error) {
    console.error('[Scanner] Error:', error);
    el('scStatus', `Error: ${error.message}`);
    el('scDot').className = 'sc-dot idle';
    el('dqDot').className = 'dq-dot static';
    el('dqStatus', 'Error');
  } finally {
    VF.scanning = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PREDICTOR - FETCH BETPAWA UPCOMING MATCHES
// ═══════════════════════════════════════════════════════════════════════

async function fetchUpcomingMatches() {
  try {
    console.log('[Predictor] Fetching BetPawa virtual football events...');
    el('liveStatus', 'Fetching matches...');
    el('liveDot').className = 'live-dot loading';
    
    // Fetch virtual football events from BetPawa
    const eventsData = await fetchBetPawaAPI('events/virtual-football');
    
    if (!eventsData || !eventsData.events) {
      throw new Error('No events data received');
    }
    
    console.log(`[Predictor] Received ${eventsData.events.length} events`);
    
    // Filter for upcoming matches
    const upcoming = eventsData.events.filter(evt => {
      const startTime = new Date(evt.startTime);
      const now = new Date();
      const hoursAhead = (startTime - now) / (1000 * 60 * 60);
      return hoursAhead > 0 && hoursAhead < 24; // Next 24 hours
    });
    
    console.log(`[Predictor] ${upcoming.length} upcoming matches in next 24h`);
    
    // Generate predictions
    const predictions = [];
    for (const evt of upcoming) {
      const homeTeam = evt.homeTeam || evt.home;
      const awayTeam = evt.awayTeam || evt.away;
      const league = evt.league || 'vfl';
      
      const eventOdds = {
        home_win: evt.homeOdds || 2.0,
        away_win: evt.awayOdds || 2.0,
        draw: evt.drawOdds || 3.5,
        over_35: evt.over35Odds || 2.3,
        under_35: evt.under35Odds || 1.6
      };
      
      const pred = generatePrediction(
        homeTeam, awayTeam, league,
        1, 1, evt.id,
        evt.season || 'Current',
        { tradingTime: { start: evt.startTime } },
        eventOdds
      );
      
      predictions.push(pred);
    }
    
    S.predictions = predictions;
    
    // Update UI
    renderLiveTab(predictions, upcoming[0]?.startTime);
    
    el('liveStatus', `${predictions.length} matches analyzed`);
    el('liveDot').className = 'live-dot';
    
  } catch (error) {
    console.error('[Predictor] Error:', error);
    el('liveStatus', `Error: ${error.message}`);
    el('liveDot').className = 'live-dot offline';
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  UI RENDERING
// ═══════════════════════════════════════════════════════════════════════

function renderAdvancedFilterPanel(advResult) {
  if (!advResult) return '';
  
  const verdictClass = advResult.verdict === 'ELITE' ? 'adv-elite' :
                      advResult.verdict === 'APPROVED' ? 'adv-good' :
                      advResult.verdict === 'CAUTION' ? 'adv-caution' : 'adv-reject';
  
  const verdictIcon = advResult.verdict === 'ELITE' ? '⭐' :
                     advResult.verdict === 'APPROVED' ? '✅' :
                     advResult.verdict === 'CAUTION' ? '⚠️' : '🚫';
  
  const verdictText = advResult.verdict === 'ELITE'
    ? `⭐ ELITE MATCH: Score ${advResult.score}/100 · ${advResult.passedChecks}/${advResult.totalChecks} checks passed · MEI: ${advResult.metrics.MEI} · Elite Over Probability: ${advResult.metrics.EliteOverProb}%`
    : advResult.verdict === 'APPROVED'
    ? `✅ APPROVED: Score ${advResult.score}/100 · ${advResult.passedChecks}/${advResult.totalChecks} advanced checks passed · Good statistical foundation`
    : advResult.verdict === 'CAUTION'
    ? `⚠️ CAUTION: Score ${advResult.score}/100 · ${advResult.passedChecks}/${advResult.totalChecks} checks passed · Proceed with reduced stake`
    : `🚫 REJECTED: Score ${advResult.score}/100 · Failed advanced statistical validation · Only ${advResult.passedChecks}/${advResult.totalChecks} checks passed`;
  
  return `
  <div class="advanced-filter-panel">
    <div class="advanced-filter-title">
      <span>📊 Advanced Stats Gate (Final Validation)</span>
      <span style="font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;border:1px solid;${advResult.pass ? 'color:var(--green);border-color:rgba(0,200,81,.4);background:rgba(0,200,81,.1)' : 'color:var(--red);border-color:rgba(255,53,71,.4);background:rgba(255,53,71,.1)'}">${verdictIcon} ${advResult.verdict}</span>
    </div>
    ${advResult.details.map(d => `
      <div class="adv-metric">
        <span class="adv-metric-name">${esc(d.name)}</span>
        <span class="${d.pass ? 'adv-pass' : 'adv-fail'}">${d.pass ? '✅' : '❌'} ${esc(d.value)} ${!d.pass ? `(need ${esc(d.threshold)})` : ''}</span>
      </div>
    `).join('')}
    <div class="adv-verdict ${verdictClass}">
      ${verdictText}
    </div>
    ${advResult.metrics ? `
      <div style="margin-top:8px;font-size:8px;color:var(--text2);padding:6px;background:rgba(0,0,0,.2);border-radius:4px;line-height:1.6">
        <strong style="color:var(--advanced)">Detailed Metrics:</strong><br>
        🏠 Home: Attack ${advResult.metrics.AS_A} · Defense ${advResult.metrics.GC_A} · Over Rate ${advResult.metrics.OverRate_A}% · AIS ${advResult.metrics.AIS_A}<br>
        ✈️ Away: Attack ${advResult.metrics.AS_B} · Defense ${advResult.metrics.GC_B} · Over Rate ${advResult.metrics.OverRate_B}% · AIS ${advResult.metrics.AIS_B}<br>
        🎯 Match: MEI ${advResult.metrics.MEI}/100 · Elite Over ${advResult.metrics.EliteOverProb}% · Under Trap: ${advResult.metrics.UnderTrap ? 'YES ⚠️' : 'No ✅'}
      </div>
    ` : ''}
  </div>`;
}

function renderFilterPanel(fr, blocked, caution) {
  if (!fr) return '';
  
  const verdictClass = blocked ? 'fv-blocked' : caution ? 'fv-caution' : 'fv-safe';
  const verdictText = blocked
    ? `🛡️ BLOCKED: ${fr.triggered}/${fr.total} filters triggered. Match likely to go UNDER despite signals.`
    : caution
    ? `⚠️ CAUTION: ${fr.triggered}/${fr.total} filters triggered. Proceed with reduced confidence.`
    : `✅ APPROVED: Only ${fr.triggered}/${fr.total} filters triggered. Under-filter system passed.`;
  
  return `
  <div class="filter-panel">
    <div class="filter-panel-title">
      <span>🛡️ 12-Point Under-Filter System</span>
      <span style="font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;border:1px solid;${blocked ? 'color:var(--red);border-color:rgba(255,53,71,.4);background:rgba(255,53,71,.1)' : caution ? 'color:var(--orange);border-color:rgba(255,152,0,.4);background:rgba(255,152,0,.1)' : 'color:var(--green);border-color:rgba(0,200,81,.4);background:rgba(0,200,81,.1)'}">${fr.triggered}/${fr.total}</span>
    </div>
    ${fr.filters.length > 0 ? fr.filters.map(f => `
      <div class="filter-item">
        <span class="filter-item-name">${esc(f.id)}: ${esc(f.name)}</span>
        <span class="filter-fail">❌ ${esc(f.reason)}</span>
      </div>
    `).join('') : '<div style="font-size:9px;color:var(--green);padding:4px 0">✅ All filters passed</div>'}
    <div class="filter-verdict ${verdictClass}">
      ${verdictText}
    </div>
  </div>`;
}

function renderSignalPanel(pred) {
  if (!pred.signals || pred.signals.length === 0) return '';
  
  const topCount = pred.signals.filter(isTopPerformer).length;
  
  return `
  <div class="signal-panel">
    <div class="signal-panel-title">
      <span>📡 Matched Signals (${pred.signals.length})</span>
      ${topCount > 0 ? `<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(255,215,0,.15);color:var(--gold)">🏆 ${topCount} Top</span>` : ''}
    </div>
    ${pred.signals.slice(0, 5).map(sig => {
      const isTop = isTopPerformer(sig);
      const strengthClass = sig.over35_rate >= 70 ? 'high' : sig.over35_rate >= 60 ? 'mid' : 'low';
      return `
      <div class="signal-item ${strengthClass} ${isTop ? 'top-performer' : ''}">
        <div class="signal-type-tag">${esc(sig.type)}${isTop ? ' 🏆' : ''}</div>
        <div class="signal-desc">${esc(sig.description)}</div>
        <div class="signal-meta">
          <span class="signal-pill sp-rate ${sig.over35_rate < 60 ? 'low' : sig.over35_rate < 70 ? 'mid' : ''}">${sig.over35_rate}% over</span>
          <span class="signal-pill sp-occ">${sig.occurrences} matches</span>
          <span class="signal-pill sp-str">Str: ${sig.signal_strength}</span>
        </div>
        <div class="signal-bar-wrap">
          <div class="signal-bar-bg">
            <div class="signal-bar-fill" style="width:${sig.over35_rate}%;background:${sig.over35_rate >= 70 ? 'var(--green)' : sig.over35_rate >= 60 ? 'var(--orange)' : 'var(--red)'}"></div>
          </div>
        </div>
      </div>
      `;
    }).join('')}
  </div>`;
}

function renderConfidencePanel(pred) {
  const level = pred.confidence >= 90 ? 'ULTRA HIGH' :
                pred.confidence >= 80 ? 'HIGH' :
                pred.confidence >= 70 ? 'GOOD' : 'MODERATE';
  
  const levelClass = pred.confidence >= 80 ? 'cv-safe' :
                     pred.confidence >= 70 ? 'cv-caution' : 'cv-danger';
  
  return `
  <div class="conf-panel">
    <div class="conf-panel-title">📊 Confidence Breakdown</div>
    <div class="conf-row"><span class="cl">Confidence Level:</span><span class="cv">${level} (${pred.confidence}%)</span></div>
    <div class="conf-row"><span class="cl">Primary Signals:</span><span class="cv">${pred.primarySignals.length}</span></div>
    <div class="conf-row"><span class="cl">Avg Signal Rate:</span><span class="cv">${pred.avgSignalRate}%</span></div>
    <div class="conf-row"><span class="cl">Top Performers:</span><span class="cv">${pred.signals.filter(isTopPerformer).length}</span></div>
    <div class="conf-verdict ${levelClass}">
      ${pred.confidence >= 90 ? '⭐ ULTRA CONFIDENCE — Multiple top performers + high rates' :
        pred.confidence >= 80 ? '✅ HIGH CONFIDENCE — Strong signal foundation' :
        pred.confidence >= 70 ? '✅ GOOD CONFIDENCE — Reliable signals present' :
        '⚠️ MODERATE — Lower confidence, consider carefully'}
    </div>
  </div>`;
}

function renderPredCard(pred, roundStart) {
  const passed = pred.passes;
  const filtered = pred.filteredOut;
  const caution = pred.cautionFlag;
  const isUltra = pred.confidence >= 90 && !filtered;
  const fr = pred.filterResult;
  const advResult = pred.advancedFilterResult;
  
  const borderColor = !passed ? 'var(--red)' :
                      filtered ? 'var(--filter)' :
                      caution ? 'var(--orange)' :
                      isUltra ? 'var(--gold)' : 'var(--green)';
  
  const matchedStrong = (pred.primarySignals || []).length;
  const matchedAll = (pred.signals || []).length;
  const topCount = (pred.signals || []).filter(isTopPerformer).length;
  
  return `
  <div class="pred-card ${isUltra && passed && !filtered ? 'ultra' : ''} ${filtered ? 'filtered-under' : ''}" style="border-top:3px solid ${borderColor}">
    <div class="pred-header">
      <div>
        <div class="pred-match-name">⚽ ${esc(pred.homeCode)} vs ${esc(pred.awayCode)}</div>
        <div class="pred-league-tag">🏆 ${esc(pred.leagueApiName || 'Virtual League')}</div>
        <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          ${passed ? `<span style="font-family:'Space Mono',monospace;font-size:7.5px;padding:2px 6px;border-radius:3px;border:1px solid;background:rgba(0,200,81,.12);border-color:rgba(0,200,81,.4);color:var(--green)">✅ ${matchedStrong} primary + ${matchedAll - matchedStrong} support${topCount > 0 ? ` · 🏆 ${topCount} top` : ''}</span>` : `<span style="font-family:'Space Mono',monospace;font-size:7.5px;padding:2px 6px;border-radius:3px;border:1px solid;background:rgba(255,53,71,.12);border-color:rgba(255,53,71,.4);color:var(--red)">❌ No signals</span>`}
          ${filtered ? `<span style="font-family:'Space Mono',monospace;font-size:7.5px;padding:2px 6px;border-radius:3px;border:1px solid;background:rgba(224,64,251,.12);border-color:rgba(224,64,251,.4);color:var(--filter)">🛡️ FILTER BLOCKED</span>` : ''}
          ${caution && !filtered ? `<span style="font-family:'Space Mono',monospace;font-size:7.5px;padding:2px 6px;border-radius:3px;border:1px solid;background:rgba(255,152,0,.12);border-color:rgba(255,152,0,.4);color:var(--orange)">⚠️ CAUTION</span>` : ''}
        </div>
      </div>
      <div style="text-align:right">
        ${passed ? `<div class="pred-conf-badge ${isUltra && !filtered ? 'conf-ultra' : 'conf-high'}">${pred.confidence}%</div>` : `<div style="font-size:11px;color:var(--red);font-weight:700;padding:4px">FILTERED</div>`}
      </div>
    </div>
    
    ${passed ? renderSignalPanel(pred) : ''}
    ${passed && fr ? renderFilterPanel(fr, filtered, caution) : ''}
    ${passed && advResult ? renderAdvancedFilterPanel(advResult) : ''}
    ${passed && !filtered ? `<div class="pred-main-bet"><div class="pred-bet-label">🎯 Recommended Bet${caution ? ' (CAUTION)' : ''}</div><div class="pred-bet-value" style="color:${caution ? 'var(--orange)' : 'var(--gold)'}">${esc(pred.bet)}</div></div>` : ''}
    ${passed && !filtered ? renderConfidencePanel(pred) : ''}
    
    <div class="card-countdown"><span>⏱</span><span class="cc-timer cc-time">Calculating...</span><span>to kick off</span></div>
  </div>`;
}

function renderLiveTab(preds, roundStart) {
  const approvedPreds = preds.filter(p => p.passes && !p.filteredOut).sort((a, b) => b.confidence - a.confidence);
  const filteredPreds = preds.filter(p => p.passes && p.filteredOut);
  const qs = qualifiedSignals();
  
  const badge = el('liveBadge');
  if (badge) {
    badge.textContent = approvedPreds.length;
    badge.className = approvedPreds.length > 0 ? 'badge-count show' : 'badge-count';
  }
  
  el('engineStatus', `📊 v7.2 Active · ${approvedPreds.length} Approved · ${filteredPreds.length} Filtered · ${qs.length} Signals · MD+${MATCHDAYS_AHEAD}`);
  
  const container = document.getElementById('liveContainer');
  if (!container) return;
  
  if (preds.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No Matches This Round</div></div>`;
    return;
  }
  
  let html = `<div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;font-size:9px;flex-wrap:wrap;gap:4px">
    <span style="color:var(--text2)">Scanned: <strong>${preds.length}</strong></span>
    <span style="color:var(--green)">✅ Approved: <strong>${approvedPreds.length}</strong></span>
    <span style="color:var(--filter)">🛡️ Filtered: <strong>${filteredPreds.length}</strong></span>
    <span style="color:var(--advanced);font-weight:900">📊 Advanced Gate ON</span>
  </div>`;
  
  preds.forEach(pred => {
    html += renderPredCard(pred, roundStart);
  });
  
  container.innerHTML = html;
}

function renderSignalTable() {
  const tbody = document.getElementById('sigTableBody');
  if (!tbody) return;
  
  const qs = qualifiedSignals();
  const fType = document.getElementById('f-type')?.value || '';
  const fPerf = document.getElementById('f-perf')?.value || '';
  const fMinRate = parseFloat(document.getElementById('f-minrate')?.value) || 0;
  const fSearch = (document.getElementById('f-search')?.value || '').toLowerCase();
  
  let filtered = qs;
  
  if (fType) filtered = filtered.filter(s => s.type === fType);
  if (fPerf === 'top') filtered = filtered.filter(isTopPerformer);
  else if (fPerf === 'high') filtered = filtered.filter(s => s.over35_rate >= 65);
  else if (fPerf === 'mid') filtered = filtered.filter(s => s.over35_rate >= 55 && s.over35_rate < 65);
  
  if (fMinRate > 0) filtered = filtered.filter(s => s.over35_rate >= fMinRate);
  if (fSearch) filtered = filtered.filter(s => s.description.toLowerCase().includes(fSearch) || s.type.toLowerCase().includes(fSearch));
  
  el('sigTableCount', filtered.length);
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text2)">No signals match filters</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtered.map((sig, i) => {
    const isTop = isTopPerformer(sig);
    const rateClass = sig.over35_rate >= 70 ? 'rate-high' : sig.over35_rate >= 60 ? 'rate-mid' : 'rate-low';
    const strClass = sig.signal_strength >= 70 ? 'ssb-high' : sig.signal_strength >= 55 ? 'ssb-mid' : 'ssb-low';
    const perfBadge = isTop ? '<span class="ssb-top">🏆 TOP</span>' : sig.over35_rate >= 65 ? '<span class="ssb-high">HIGH</span>' : '<span class="ssb-mid">MID</span>';
    
    return `
    <tr class="${isTop ? 'top-performer-row' : ''}">
      <td>${i + 1}</td>
      <td><span class="sigt-type">${esc(sig.type)}</span></td>
      <td><span class="sigt-desc">${esc(sig.description)}</span></td>
      <td>${sig.occurrences}</td>
      <td>
        <span class="sigt-rate ${rateClass}">${sig.over35_rate}%</span>
        <div class="mini-bar"><div class="mini-fill" style="width:${sig.over35_rate}%;background:${sig.over35_rate >= 70 ? 'var(--green)' : sig.over35_rate >= 60 ? 'var(--orange)' : 'var(--red)'}"></div></div>
      </td>
      <td>${sig.avg_goals}</td>
      <td><span class="sig-str-badge ${strClass}">${sig.signal_strength}</span></td>
      <td>${perfBadge}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
//  UI CONTROLS
// ═══════════════════════════════════════════════════════════════════════

function showTab(tabName) {
  // Remove active from all tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  
  // Add active to selected
  document.getElementById('tab-btn-' + tabName)?.classList.add('active');
  document.getElementById('tab-' + tabName)?.classList.add('active');
  document.getElementById('nav-' + tabName)?.classList.add('active');
  
  // Render specific tabs
  if (tabName === 'signals') renderSignalTable();
}

function handleConnectionToggle(enabled) {
  PREDICTOR_ENABLED = enabled;
  
  const banner = document.getElementById('disconnectedBanner');
  const labelLeft = document.getElementById('switchLabelLeft');
  const labelRight = document.getElementById('switchLabelRight');
  
  if (enabled) {
    banner?.classList.remove('offline');
    labelLeft?.classList.remove('on');
    labelLeft?.classList.add('off');
    labelRight?.classList.remove('off');
    labelRight?.classList.add('on');
    
    // Start scanning
    scanSignalData();
    fetchUpcomingMatches();
  } else {
    banner?.classList.add('offline');
    labelLeft?.classList.remove('off');
    labelLeft?.classList.add('on');
    labelRight?.classList.remove('on');
    labelRight?.classList.add('off');
  }
}

function manualRefresh() {
  if (!PREDICTOR_ENABLED) {
    alert('Predictor is disconnected. Toggle the switch to reconnect.');
    return;
  }
  
  scanSignalData();
  fetchUpcomingMatches();
}

function hardReset() {
  if (!confirm('⚠️ This will clear ALL signal data, patterns, and predictions. Continue?')) return;
  
  VF.matches = [];
  VF.patterns = [];
  VF.leagueTable = [];
  S.predictions = [];
  S.results = [];
  
  if (S.db) {
    dbClear('signalData');
    dbClear('mlData');
    dbClear('learnings');
  }
  
  location.reload();
}

function downloadMLData() {
  const data = {
    matches: VF.matches,
    patterns: VF.patterns,
    predictions: S.predictions,
    results: S.results,
    thresholds: T,
    meta: VF.meta,
    exportedAt: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vf-predictor-ml-data-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function confirmClearML() {
  if (!confirm('Clear all ML data? This cannot be undone.')) return;
  
  if (S.db) {
    dbClear('mlData');
    dbClear('learnings');
  }
  
  S.learnings = { learnCycles: 0, failuresLearned: 0, log: [] };
  alert('ML data cleared');
}

// ═══════════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

window.addEventListener('load', async () => {
  await delay(600);
  
  try {
    console.log('[Init] Starting VF Predictor v7.2...');
    
    // Initialize database
    await initDB();
    console.log('[Init] IndexedDB ready');
    
    // Load saved signals
    const hasData = await loadSignalsFromDB();
    if (hasData) {
      console.log('[Init] Loaded signals from IndexedDB');
      renderSignalTable();
      
      // Update stats
      const qs = qualifiedSignals();
      const top = topPerformerSignals();
      el('dqMatches', VF.matches.length.toLocaleString());
      el('dqPatterns', VF.patterns.length.toLocaleString());
      el('dqQualified', qs.length.toLocaleString());
      el('scActive', qs.length);
      el('scTop', top.length);
      
      el('ss-total', VF.matches.length.toLocaleString());
      el('ss-patterns', VF.patterns.length.toLocaleString());
      el('ss-qualified', qs.length);
      el('ss-topperformers', top.length);
    }
    
    // Start initial scan
    console.log('[Init] Starting signal scan...');
    await scanSignalData();
    
    // Fetch predictions
    console.log('[Init] Fetching upcoming matches...');
    await fetchUpcomingMatches();
    
    // Set up auto-refresh (every 5 minutes)
    setInterval(() => {
      if (PREDICTOR_ENABLED) {
        scanSignalData();
        fetchUpcomingMatches();
      }
    }, 5 * 60 * 1000);
    
    el('engineStatus', `✅ Enhanced Engine v7.2 Active · Advanced Stats Gate Ready`);
    el('sessionPill', '🟢 LIVE');
    el('liveStatus', 'Connected');
    el('liveDot').className = 'live-dot';
    
    console.log('[Init] Complete');
    
  } catch (error) {
    console.error('[Init] Error:', error);
    el('engineStatus', `❌ Error: ${error.message}`);
    el('sessionPill', '🔴 ERROR');
    el('sessionPill').style.background = 'rgba(255,53,71,.12)';
    el('sessionPill').style.borderColor = 'rgba(255,53,71,.4)';
    el('sessionPill').style.color = 'var(--red)';
  }
});
