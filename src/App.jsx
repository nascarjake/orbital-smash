import React, { useState, useEffect, useRef } from 'react';
import { Award, Bomb, Eye, Home, Magnet, Music, Palette, Play, RotateCcw, Send, Shield, Snowflake, Sparkles, Trophy, Volume2, VolumeX, Zap } from 'lucide-react';

// --- GAME CONSTANTS ---
const NUM_NODES = 7;           // Number of segments in the chain
const SEGMENT_LENGTH = 25;     // Length of each chain segment
const CORE_RADIUS = 12;
const MACE_RADIUS = 20;
const MAX_MACE_SPEED = 40;
const BASE_ENEMY_SPAWN_RATE = 100; // Frames between spawns (Increased from 60 for easier start)
const MOBILE_BREAKPOINT = 768;
const FRAME_DURATION = 1000 / 60;
const HIGH_SCORE_KEY = 'orbital_smash_high_score';
const ACHIEVEMENTS_KEY = 'orbital_smash_achievements';
const UNLOCKS_KEY = 'orbital_smash_unlocks';
const LOADOUT_KEY = 'orbital_smash_loadout';
const LOCAL_SCORES_KEY = 'orbital_smash_local_scores';
const MUTE_KEY = 'orbital_smash_muted';
const GRAPHICS_KEY = 'orbital_smash_graphics';

const DREAMLO_PUBLIC = "69f664cb8f40bb1068bd441a";
const DREAMLO_PRIVATE = "qJcEBUUmAE6ApG2ZQjVRiw4nBSAtJFnUGNixUKRstFdA";

const isLocalRuntime = () => {
  const { hostname, protocol } = window.location;
  return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const buildDreamloUrl = (path) => `http://dreamlo.com/lb/${path}`;
const buildProxyUrls = (url) => [
  `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  `https://everyorigin.jwvbremen.nl/get?url=${encodeURIComponent(url)}`,
  `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

const parseDreamloResponse = async (response, proxyUrl, expectJson = true) => {
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Proxy request failed (${response.status}) via ${proxyUrl}`);
  }

  if (!expectJson) {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    const wrapped = JSON.parse(body);
    if (typeof wrapped?.contents === 'string') {
      return JSON.parse(wrapped.contents);
    }
    throw new Error(`Unexpected proxy payload from ${proxyUrl}`);
  }
};

const requestDreamlo = async (path, { expectJson = true } = {}) => {
  const targetUrl = `${buildDreamloUrl(path)}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
  let lastError = null;

  for (const proxyUrl of buildProxyUrls(targetUrl)) {
    try {
      const response = await fetch(proxyUrl, { cache: 'no-store' });
      return await parseDreamloResponse(response, proxyUrl, expectJson);
    } catch (error) {
      lastError = error;
      console.warn(`Dreamlo proxy failed: ${proxyUrl}`, error);
    }
  }

  throw lastError ?? new Error('Unable to reach Dreamlo through any proxy');
};

const normalizeLeaderboardEntries = (data) => {
  let entries = data?.dreamlo?.leaderboard?.entry;
  if (!entries) return [];

  if (!Array.isArray(entries)) {
    entries = [entries];
  }

  return entries
    .map((entry) => ({
      ...entry,
      score: Number(entry.score) || 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
};

const ACHIEVEMENTS = [
  { id: 'first_smash', title: 'First Contact', desc: 'Smash your first enemy.', test: (s) => s.kills >= 1 },
  { id: 'combo_10', title: 'Orbit Artist', desc: 'Reach a 10x combo.', test: (s) => s.maxCombo >= 10 },
  { id: 'score_1000', title: 'Four Digits', desc: 'Score 1,000 points.', test: (s) => s.score >= 1000 },
  { id: 'overdrive', title: 'White Hot', desc: 'Trigger Overdrive.', test: (s) => s.overdrives >= 1 },
  { id: 'collector', title: 'Vacuum Core', desc: 'Collect 20 pickups.', test: (s) => s.pickupsCollected >= 20 },
  { id: 'wave_3', title: 'Still Spinning', desc: 'Reach wave 3.', test: (s) => s.wave >= 3 },
  { id: 'power_play', title: 'Power Trip', desc: 'Collect 5 special powerups.', test: (s) => s.powerupsCollected >= 5 },
  { id: 'bomb_squad', title: 'Chain Reaction', desc: 'Detonate 3 bombs.', test: (s) => s.bombs >= 3 },
  { id: 'deep_freeze', title: 'Deep Freeze', desc: 'Collect 3 freeze cores.', test: (s) => s.freezes >= 3 },
  { id: 'local_legend', title: 'Local Legend', desc: 'Set a local high score.', test: (s) => s.didSetHighScore },
];

const ENEMY_KEY = [
  { name: 'Basic', detail: 'Standard diamond. Good combo fuel.', color: '#ff00ff', shape: 'diamond' },
  { name: 'Fast', detail: 'Yellow striker. Quick and fragile.', color: '#facc15', shape: 'triangle' },
  { name: 'Tank', detail: 'Green block. Takes three solid hits.', color: '#22c55e', shape: 'square' },
  { name: 'Splitter', detail: 'Purple core. Pops into two fast shards.', color: '#a855f7', shape: 'circle' },
];

const POWERUP_KEY = [
  { name: 'Energy', detail: 'Charges Overdrive.', color: '#22d3ee', icon: Zap },
  { name: 'Health', detail: 'Restores one shield.', color: '#22c55e', icon: Shield },
  { name: 'Giant', detail: 'Doubles mace size for 10s.', color: '#fb923c', icon: Trophy },
  { name: 'Freeze', detail: 'Slows the swarm for 5s.', color: '#93c5fd', icon: Snowflake },
  { name: 'Magnet', detail: 'Pulls drops from farther away.', color: '#22d3ee', icon: Magnet },
  { name: 'Bomb', detail: 'Blasts nearby enemies.', color: '#fb7185', icon: Bomb },
  { name: 'Shield', detail: 'Blocks one core hit.', color: '#38bdf8', icon: Shield },
];

const TUTORIAL_STEPS = [
  {
    title: 'Move The Core',
    body: 'Your cursor or finger pulls the glowing core. The chain follows with weight, so lead your swing instead of chasing enemies directly.',
    cue: 'Drag the core',
  },
  {
    title: 'Build Momentum',
    body: 'The mace deals real damage when it is moving fast. Wide arcs and reversals make harder hits than tiny movements.',
    cue: 'Swing wide',
  },
  {
    title: 'Smash And Chain',
    body: 'Fast hits destroy enemies, grow your combo, and raise score gains. If the mace is slow, it mostly pushes enemies back.',
    cue: 'Fast hits score',
  },
  {
    title: 'Collect Energy',
    body: 'Cyan orbs fill the Overdrive meter. Other drops can heal, shield, freeze, magnetize, or detonate the swarm.',
    cue: 'Grab drops',
  },
  {
    title: 'Trigger Overdrive',
    body: 'At 100% energy, press or hold click/touch. Overdrive spends the full meter, makes the mace huge, and lets it shred enemies for about five seconds.',
    cue: '100% = unleash',
  },
];

const UNLOCKABLES = [
  {
    id: 'skin_sunforge',
    type: 'skin',
    title: 'Sunforge Core',
    desc: 'Turns the core and mace gold-hot.',
    requirement: 'Score 750',
    test: (s) => s.highScore >= 750,
  },
  {
    id: 'skin_void',
    type: 'skin',
    title: 'Void Core',
    desc: 'A violet core with a colder trail.',
    requirement: 'Unlock 4 badges',
    test: (s) => s.badges >= 4,
  },
  {
    id: 'bg_aurora',
    type: 'background',
    title: 'Aurora Grid',
    desc: 'Adds a richer cyan/fuchsia arena wash.',
    requirement: 'Reach wave 3',
    test: (s) => s.hasAchievement('wave_3'),
  },
  {
    id: 'sound_glass',
    type: 'sound',
    title: 'Glass Synth',
    desc: 'Brighter, cleaner arcade tones.',
    requirement: 'Trigger Overdrive',
    test: (s) => s.hasAchievement('overdrive'),
  },
  {
    id: 'power_chain',
    type: 'powerup',
    title: 'Chain Lightning',
    desc: 'Rare drop that jumps through the nearest enemies.',
    requirement: 'Score 1,000',
    test: (s) => s.hasAchievement('score_1000'),
  },
  {
    id: 'power_singularity',
    type: 'powerup',
    title: 'Singularity',
    desc: 'Rare drop that drags the swarm into a crush zone.',
    requirement: '10x combo',
    test: (s) => s.hasAchievement('combo_10'),
  },
  {
    id: 'power_second_wind',
    type: 'powerup',
    title: 'Second Wind',
    desc: 'Once per run, lethal damage restores the core instead.',
    requirement: 'Set a local high score',
    test: (s) => s.hasAchievement('local_legend'),
  },
];

const DEFAULT_LOADOUT = {
  skin_sunforge: false,
  skin_void: false,
  bg_aurora: false,
  sound_glass: false,
  power_chain: false,
  power_singularity: false,
  power_second_wind: false,
};

const readStoredJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeLocalScores = (scores) => (
  Array.isArray(scores)
    ? scores
        .map((entry) => ({ ...entry, score: Number(entry.score) || 0 }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
    : []
);

const QUALITY_PRESETS = {
  desktop: [
    { renderScale: 1, particleMultiplier: 1, particleCap: 220, trailLength: 12, overdriveTrailLength: 20, shadowScale: 1, drawGrid: true, motionBlurAlpha: 0.3 },
    { renderScale: 0.85, particleMultiplier: 0.75, particleCap: 150, trailLength: 9, overdriveTrailLength: 15, shadowScale: 0.65, drawGrid: true, motionBlurAlpha: 0.24 },
    { renderScale: 0.7, particleMultiplier: 0.45, particleCap: 90, trailLength: 6, overdriveTrailLength: 10, shadowScale: 0.25, drawGrid: false, motionBlurAlpha: 0.16 },
  ],
  mobile: [
    { renderScale: 0.7, particleMultiplier: 0.42, particleCap: 70, trailLength: 6, overdriveTrailLength: 10, shadowScale: 0.45, drawGrid: false, motionBlurAlpha: 0.18 },
    { renderScale: 0.58, particleMultiplier: 0.28, particleCap: 45, trailLength: 4, overdriveTrailLength: 7, shadowScale: 0.2, drawGrid: false, motionBlurAlpha: 0.12 },
    { renderScale: 0.48, particleMultiplier: 0.18, particleCap: 28, trailLength: 2, overdriveTrailLength: 4, shadowScale: 0, drawGrid: false, motionBlurAlpha: 0.08 },
  ],
};

const GRAPHICS_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High', quality: 0 },
  { id: 'medium', label: 'Medium', quality: 1 },
  { id: 'low', label: 'Low', quality: 2 },
];

const qualityLabel = (quality) => ['High', 'Medium', 'Low'][quality] ?? 'High';

const applyQualityPreset = (perf, quality = perf.quality ?? 0) => {
  const presets = perf.isMobile ? QUALITY_PRESETS.mobile : QUALITY_PRESETS.desktop;
  const nextQuality = Math.max(0, Math.min(quality, presets.length - 1));
  Object.assign(perf, presets[nextQuality], { quality: nextQuality });
};

// --- AUDIO SYSTEM (Synthesized Retro SFX) ---
class AudioSys {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.musicTimer = null;
    this.enabled = false;
    this.muted = false;
    this.soundPack = 'classic';
  }

  init() {
    if (this.enabled) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.3; // Global volume
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.enabled = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.3, this.ctx.currentTime, 0.03);
    }
  }

  setSoundPack(soundPack) {
    this.soundPack = soundPack;
  }

  playTone(freq, type, duration, vol = 1, slideDown = false) {
    if (!this.enabled || !this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = this.soundPack === 'glass' && type !== 'sawtooth' ? 'sine' : type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slideDown) {
      osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + duration);
    }
    
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playNoise(duration, vol) {
    if (!this.enabled || !this.ctx || this.muted) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    
    // Lowpass filter to make it sound like a meaty thud
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    noise.start();
  }

  playMusicNote(freq, duration, delay = 0, vol = 0.08) {
    if (!this.enabled || !this.ctx || this.muted || !this.musicGain) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + duration + 0.04);
  }

  startMusic() {
    if (!this.enabled || this.musicTimer) return;
    const notes = [110, 146.83, 164.81, 220, 196, 164.81, 146.83, 123.47];
    let step = 0;
    const playBar = () => {
      if (!this.enabled || this.muted) return;
      const root = notes[step % notes.length];
      this.playMusicNote(root, 0.42, 0, 0.07);
      this.playMusicNote(root * 2, 0.18, 0.18, 0.04);
      this.playMusicNote(root * 1.5, 0.16, 0.36, 0.035);
      step++;
    };
    playBar();
    this.musicTimer = window.setInterval(playBar, 520);
  }

  stopMusic() {
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  hit() { this.playTone(200, 'square', 0.1, 0.4); }
  smash() { 
    this.playTone(150, 'sawtooth', 0.3, 0.5, true); 
    this.playNoise(0.3, 0.6);
  }
  collect() { this.playTone(800, 'sine', 0.1, 0.2); }
  powerup() {
    this.playTone(400, 'sine', 0.1, 0.3);
    setTimeout(() => this.playTone(600, 'sine', 0.2, 0.3), 100);
  }
  achievement() {
    this.playTone(523.25, 'sine', 0.12, 0.25);
    setTimeout(() => this.playTone(659.25, 'sine', 0.12, 0.25), 90);
    setTimeout(() => this.playTone(783.99, 'sine', 0.22, 0.3), 180);
  }
  bomb() {
    this.playTone(90, 'sawtooth', 0.45, 0.6, true);
    this.playNoise(0.45, 0.7);
  }
  chain() {
    [740, 980, 1240, 1480].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'square', 0.08, 0.18), i * 55);
    });
  }
  singularity() {
    this.playTone(180, 'sine', 0.6, 0.35, true);
    this.playNoise(0.55, 0.35);
  }
  damage() { 
    this.playTone(80, 'sawtooth', 0.4, 0.8, true); 
    this.playNoise(0.4, 0.8);
  }
  overdrive() {
    this.playTone(400, 'square', 1.0, 0.4);
    this.playTone(600, 'sawtooth', 1.0, 0.3);
    setTimeout(() => this.playTone(800, 'square', 2.0, 0.4), 100);
  }
}

const audio = new AudioSys();

// --- MAIN REACT COMPONENT ---
export default function App() {
  const [gameState, setGameState] = useState('menu'); // menu, playing, gameover
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(3);
  const [energy, setEnergy] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [localScores, setLocalScores] = useState(() => normalizeLocalScores(readStoredJson(LOCAL_SCORES_KEY, [])));
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('orbital_smash_name') || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem(MUTE_KEY) === 'true');
  const [localHighScore, setLocalHighScore] = useState(() => Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0);
  const [achievements, setAchievements] = useState(() => readStoredJson(ACHIEVEMENTS_KEY, {}));
  const [unlocks, setUnlocks] = useState(() => readStoredJson(UNLOCKS_KEY, {}));
  const [loadout, setLoadout] = useState(() => ({ ...DEFAULT_LOADOUT, ...readStoredJson(LOADOUT_KEY, {}) }));
  const [celebrations, setCelebrations] = useState([]);
  const [activeEffects, setActiveEffects] = useState([]);
  const [showBadges, setShowBadges] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showUnlocks, setShowUnlocks] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [graphicsMode, setGraphicsMode] = useState(() => localStorage.getItem(GRAPHICS_KEY) || 'auto');
  const [graphicsQuality, setGraphicsQuality] = useState(0);
  const isLocalMode = isLocalRuntime();
  
  const canvasRef = useRef(null);
  const menuDemoCanvasRef = useRef(null);
  const tutorialCanvasRef = useRef(null);
  const reqRef = useRef(null);
  const stateRef = useRef(null);

  const triggerCelebration = (title, detail, tone = 'cyan') => {
    const id = `${Date.now()}-${Math.random()}`;
    setCelebrations((items) => [...items.slice(-2), { id, title, detail, tone }]);
    window.setTimeout(() => {
      setCelebrations((items) => items.filter((item) => item.id !== id));
    }, 3400);
  };

  const recordLocalScore = (finalScore) => {
    if (finalScore <= 0) return;

    setLocalScores((current) => {
      const next = normalizeLocalScores([
        ...current,
        {
          name: playerName.trim() || 'LOCAL',
          score: finalScore,
          date: Date.now(),
        },
      ]);
      localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const unlockAchievement = (id) => {
    const achievement = ACHIEVEMENTS.find((item) => item.id === id);
    if (!achievement) return;

    setAchievements((current) => {
      if (current[id]) return current;
      const next = { ...current, [id]: Date.now() };
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(next));
      triggerCelebration('Achievement unlocked', achievement.title, 'gold');
      audio.achievement();
      return next;
    });
  };

  const checkUnlocks = (override = {}) => {
    const progress = {
      highScore: localHighScore,
      badges: Object.keys(achievements).length,
      hasAchievement: (id) => Boolean(achievements[id]),
      ...override,
    };

    setUnlocks((current) => {
      let changed = false;
      const next = { ...current };

      UNLOCKABLES.forEach((item) => {
        if (!next[item.id] && item.test(progress)) {
          next[item.id] = Date.now();
          changed = true;
          triggerCelebration('Unlock acquired', item.title, 'gold');
          audio.achievement();
        }
      });

      if (changed) {
        localStorage.setItem(UNLOCKS_KEY, JSON.stringify(next));
      }

      return changed ? next : current;
    });
  };

  const checkAchievements = (stats = {}) => {
    const s = stateRef.current;
    const current = {
      score: s?.score ?? score,
      kills: s?.kills ?? 0,
      maxCombo: s?.maxCombo ?? 0,
      pickupsCollected: s?.pickupsCollected ?? 0,
      powerupsCollected: s?.powerupsCollected ?? 0,
      overdrives: s?.overdrives ?? 0,
      wave: s?.wave ?? 1,
      bombs: s?.bombs ?? 0,
      freezes: s?.freezes ?? 0,
      didSetHighScore: false,
      ...stats,
    };

    const unlockedAchievementIds = { ...achievements };
    ACHIEVEMENTS.forEach((achievement) => {
      if (achievement.test(current)) {
        unlockAchievement(achievement.id);
        unlockedAchievementIds[achievement.id] = Date.now();
      }
    });
    checkUnlocks({
      highScore: Math.max(localHighScore, current.score),
      badges: Object.keys(unlockedAchievementIds).length,
      hasAchievement: (id) => Boolean(unlockedAchievementIds[id]),
    });
  };

  useEffect(() => {
    checkUnlocks();
  }, [localHighScore, achievements]);

  useEffect(() => {
    audio.setSoundPack(loadout.sound_glass && unlocks.sound_glass ? 'glass' : 'classic');
  }, [loadout.sound_glass, unlocks.sound_glass]);

  useEffect(() => {
    if (!showTutorial) return;

    const id = window.setInterval(() => {
      setTutorialStep((step) => (step + 1) % TUTORIAL_STEPS.length);
    }, 5200);

    return () => window.clearInterval(id);
  }, [showTutorial]);

  const toggleLoadout = (id) => {
    if (!unlocks[id]) return;
    setLoadout((current) => {
      const next = { ...current, [id]: !current[id] };

      if (id === 'skin_sunforge' && next.skin_sunforge) next.skin_void = false;
      if (id === 'skin_void' && next.skin_void) next.skin_sunforge = false;

      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    localStorage.setItem(MUTE_KEY, String(next));
    audio.setMuted(next);
    if (!next) {
      audio.init();
      audio.startMusic();
    }
  };

  const setGraphics = (mode) => {
    setGraphicsMode(mode);
    localStorage.setItem(GRAPHICS_KEY, mode);
    const option = GRAPHICS_OPTIONS.find((item) => item.id === mode);
    if (option?.quality !== undefined) {
      setGraphicsQuality(option.quality);
    }
  };

  const fetchLeaderboard = async () => {
    if (isLocalMode) {
      setLeaderboard([]);
      return;
    }

    try {
      const data = await requestDreamlo(`${DREAMLO_PUBLIC}/json`);
      setLeaderboard(normalizeLeaderboardEntries(data));
    } catch (e) { console.error("Leaderboard fetch failed", e); }
  };

  const submitScore = async () => {
    if (!playerName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    localStorage.setItem('orbital_smash_name', playerName);
    if (isLocalMode) {
      setGameState('menu');
      setIsSubmitting(false);
      return;
    }

    try {
      await requestDreamlo(
        `${DREAMLO_PRIVATE}/add/${encodeURIComponent(playerName.trim())}/${score}`,
        { expectJson: false }
      );
      setGameState('menu');
      await new Promise(r => setTimeout(r, 600));
      await fetchLeaderboard();
    } catch (e) { console.error("Score submission failed", e); }
    setIsSubmitting(false);
  };

  const leaderboardRows = isLocalMode ? localScores : leaderboard;
  const playerLookupName = playerName.trim().toLowerCase();
  const playerLeaderboardIndex = leaderboardRows.findIndex((entry) => {
    if (playerLookupName && String(entry.name || '').trim().toLowerCase() === playerLookupName) return true;
    return isLocalMode && localHighScore > 0 && Number(entry.score) === localHighScore;
  });
  const playerLeaderboardEntry = playerLeaderboardIndex >= 0 ? leaderboardRows[playerLeaderboardIndex] : null;

  useEffect(() => {
    if (gameState === 'menu') {
        fetchLeaderboard();
    }
  }, [gameState]);

  // Initialize or reset game engine state
  const initEngine = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < MOBILE_BREAKPOINT;
    const graphicsOption = GRAPHICS_OPTIONS.find((item) => item.id === graphicsMode) ?? GRAPHICS_OPTIONS[0];
    const initialQuality = graphicsOption.quality ?? 0;
    const performance = isMobile
      ? {
          isMobile: true,
          quality: initialQuality,
          autoQuality: graphicsMode === 'auto',
          frameAvg: FRAME_DURATION,
          qualityCooldown: 0,
          coreFollow: 0.22,
          friction: 0.92,
          constraintIterations: 3,
          renderScale: 0.7,
          trailLength: 6,
          overdriveTrailLength: 10,
          particleMultiplier: 0.42,
          particleCap: 70,
          textCap: 12,
          pickupGlow: 6,
          enemyGlow: 6,
          ropeGlow: 6,
          maceGlowBase: 10,
          overdriveMaceGlow: 26,
          shadowScale: 0.45,
          shakeDecay: 0.82,
          hitStopMultiplier: 0.5,
          drawGrid: false,
          motionBlurAlpha: 0.18,
          gridAlpha: 0.12,
          hudSyncInterval: 12,
        }
      : {
          isMobile: false,
          quality: initialQuality,
          autoQuality: graphicsMode === 'auto',
          frameAvg: FRAME_DURATION,
          qualityCooldown: 0,
          coreFollow: 0.15,
          friction: 0.95,
          constraintIterations: 4,
          renderScale: 1,
          trailLength: 12,
          overdriveTrailLength: 20,
          particleMultiplier: 1,
          particleCap: 220,
          textCap: 24,
          pickupGlow: 10,
          enemyGlow: 10,
          ropeGlow: 10,
          maceGlowBase: 15,
          overdriveMaceGlow: 40,
          shadowScale: 1,
          shakeDecay: 0.9,
          hitStopMultiplier: 1,
          drawGrid: true,
          motionBlurAlpha: 0.3,
          gridAlpha: 0.2,
          hudSyncInterval: 10,
        };
    applyQualityPreset(performance, performance.quality);
    setGraphicsQuality(performance.quality);
    
    // Physics nodes for the chain-mace (Verlet integration)
    const nodes = Array.from({ length: NUM_NODES }, (_, i) => ({
      x: width / 2,
      y: height / 2 + i * SEGMENT_LENGTH,
      oldX: width / 2,
      oldY: height / 2 + i * SEGMENT_LENGTH,
    }));

    stateRef.current = {
      width, height,
      mouse: { x: width / 2, y: height / 2 },
      isMouseDown: false,
      activePointerId: null,
      performance,
      loadout: { ...loadout },
      nodes,
      maceHistory: [],
      enemies: [],
      particles: [],
      pickups: [],
      texts: [], // floating combat text
      score: 0,
      health: 3,
      energy: 0,
      maxEnergy: 100,
      isOverdrive: false,
      overdriveTimer: 0,
      wave: 1,
      frames: 0,
      spawnRate: BASE_ENEMY_SPAWN_RATE,
      shake: 0,
      hitStop: 0,
      invulnTimer: 0,
      combo: 0,
      comboTimer: 0,
      giantMaceTimer: 0,
      freezeTimer: 0,
      magnetTimer: 0,
      shieldTimer: 0,
      kills: 0,
      maxCombo: 0,
      pickupsCollected: 0,
      powerupsCollected: 0,
      overdrives: 0,
      bombs: 0,
      freezes: 0,
      secondWindUsed: false,
    };
    
    setScore(0);
    setHealth(3);
    setEnergy(0);
    setActiveEffects([]);
  };

  const startGame = () => {
    audio.init();
    audio.setMuted(isMuted);
    audio.startMusic();
    initEngine();
    setGameState('playing');
  };

  useEffect(() => {
    if (gameState !== 'menu' && !showTutorial) return;

    const canvases = [
      { canvas: menuDemoCanvasRef.current, mode: 'menu' },
      { canvas: tutorialCanvasRef.current, mode: 'tutorial' },
    ].filter((entry) => entry.canvas);

    if (canvases.length === 0) return;

    const scenes = canvases.map(({ canvas, mode }) => {
      const nodes = Array.from({ length: NUM_NODES }, () => ({ x: 0, y: 0, oldX: 0, oldY: 0 }));
      return { canvas, mode, nodes, trail: [], width: 0, height: 0, staticDrawn: false };
    });

    const resizeScene = (scene) => {
      const rect = scene.canvas.getBoundingClientRect();
      const isSmallPreview = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < MOBILE_BREAKPOINT;
      const ratio = Math.min(window.devicePixelRatio || 1, isSmallPreview ? 1 : 1.5);
      const width = Math.max(280, rect.width);
      const height = Math.max(180, rect.height);

      if (scene.width === width && scene.height === height) return;

      scene.width = width;
      scene.height = height;
      scene.canvas.width = Math.floor(width * ratio);
      scene.canvas.height = Math.floor(height * ratio);
      const ctx = scene.canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const cx = width * 0.45;
      const cy = height * 0.45;
      scene.nodes.forEach((node, index) => {
        node.x = cx;
        node.y = cy + index * (SEGMENT_LENGTH * 0.82);
        node.oldX = node.x;
        node.oldY = node.y;
      });
      scene.trail = [];
      scene.staticDrawn = false;
    };

    const targetFor = (scene, time) => {
      const t = time / 1000;
      const w = scene.width;
      const h = scene.height;
      const step = scene.mode === 'tutorial' ? tutorialStep : -1;

      if (step === 0) {
        return { x: w * 0.5 + Math.sin(t * 1.8) * w * 0.2, y: h * 0.48 + Math.sin(t * 2.4) * h * 0.08 };
      }
      if (step === 1) {
        return { x: w * 0.5 + Math.cos(t * 2.2) * w * 0.18, y: h * 0.48 + Math.sin(t * 2.2) * h * 0.18 };
      }
      if (step === 2) {
        return { x: w * 0.45 + Math.sin(t * 4.4) * w * 0.22, y: h * 0.48 + Math.cos(t * 3.3) * h * 0.16 };
      }
      if (step === 3) {
        return { x: w * 0.55 + Math.sin(t * 1.7) * w * 0.12, y: h * 0.5 + Math.cos(t * 1.7) * h * 0.12 };
      }
      if (step === 4) {
        return { x: w * 0.5 + Math.cos(t * 3.5) * w * 0.22, y: h * 0.48 + Math.sin(t * 3.5) * h * 0.18 };
      }

      return {
        x: w * 0.48 + Math.cos(t * 1.35) * w * 0.19 + Math.sin(t * 2.4) * w * 0.05,
        y: h * 0.47 + Math.sin(t * 1.35) * h * 0.2,
      };
    };

    const updateChain = (scene, target) => {
      const segmentLength = SEGMENT_LENGTH * 0.82;
      const nodes = scene.nodes;

      nodes[0].oldX = nodes[0].x;
      nodes[0].oldY = nodes[0].y;
      nodes[0].x += (target.x - nodes[0].x) * 0.18;
      nodes[0].y += (target.y - nodes[0].y) * 0.18;

      for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        const vx = (node.x - node.oldX) * 0.94;
        const vy = (node.y - node.oldY) * 0.94;
        node.oldX = node.x;
        node.oldY = node.y;
        node.x += vx;
        node.y += vy;
      }

      for (let iter = 0; iter < 5; iter++) {
        for (let i = 0; i < nodes.length - 1; i++) {
          const n1 = nodes[i];
          const n2 = nodes[i + 1];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.max(0.01, Math.hypot(dx, dy));
          const diff = (segmentLength - dist) / dist;
          const offsetX = dx * diff * 0.5;
          const offsetY = dy * diff * 0.5;

          if (i === 0) {
            n2.x += offsetX * 2;
            n2.y += offsetY * 2;
          } else {
            n1.x -= offsetX;
            n1.y -= offsetY;
            n2.x += offsetX;
            n2.y += offsetY;
          }
        }
      }

      const mace = nodes[nodes.length - 1];
      scene.trail.push({ x: mace.x, y: mace.y });
      if (scene.trail.length > 18) scene.trail.shift();
    };

    const drawShape = (ctx, x, y, type, color, radius = 16) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      if (type === 'diamond') {
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius, y);
      } else if (type === 'triangle') {
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y + radius);
        ctx.lineTo(x - radius, y + radius);
      } else if (type === 'square') {
        ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawScene = (scene, time) => {
      resizeScene(scene);
      const isSmallPreview = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < MOBILE_BREAKPOINT;
      if (scene.mode === 'menu' && isSmallPreview && scene.staticDrawn) return;

      const ctx = scene.canvas.getContext('2d');
      const w = scene.width;
      const h = scene.height;
      const target = targetFor(scene, time);
      const step = scene.mode === 'tutorial' ? tutorialStep : -1;

      updateChain(scene, target);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(3, 7, 18, 0.94)';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(34, 211, 238, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 44) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const enemies = [
        { x: w * 0.72, y: h * 0.36, type: 'diamond', color: '#f0f' },
        { x: w * 0.24, y: h * 0.67, type: 'triangle', color: '#facc15' },
        { x: w * 0.76, y: h * 0.68, type: 'square', color: '#22c55e', radius: 13 },
      ];

      enemies.forEach((enemy, index) => {
        const pulse = 1 + Math.sin(time / 240 + index) * 0.08;
        drawShape(ctx, enemy.x, enemy.y, enemy.type, enemy.color, (enemy.radius ?? 16) * pulse);
      });

      if (step === 3 || scene.mode === 'menu') {
        ctx.fillStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        const pickupPull = step === 3 ? (Math.sin(time / 360) + 1) * 0.5 : 0;
        ctx.arc(w * (0.58 - pickupPull * 0.1), h * (0.66 - pickupPull * 0.14), 7, 0, Math.PI * 2);
        ctx.fill();
      }

      const nodes = scene.nodes;
      const core = nodes[0];
      const mace = nodes[nodes.length - 1];
      const maceSpeed = Math.hypot(mace.x - mace.oldX, mace.y - mace.oldY);
      const overdrive = step === 4;

      if (scene.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(scene.trail[0].x, scene.trail[0].y);
        scene.trail.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = overdrive ? 'rgba(255,255,255,0.55)' : 'rgba(249,115,22,0.45)';
        ctx.lineWidth = overdrive ? 28 : 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      ctx.shadowBlur = overdrive ? 20 : 10;
      ctx.shadowColor = overdrive ? '#fff' : '#22d3ee';
      ctx.strokeStyle = overdrive ? '#fff' : '#22d3ee';
      ctx.lineWidth = overdrive ? 6 : 4;
      ctx.beginPath();
      ctx.moveTo(core.x, core.y);
      for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();

      ctx.fillStyle = '#67e8f9';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(core.x, core.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(core.x, core.y, 6, 0, Math.PI * 2);
      ctx.fill();

      const maceRadius = overdrive ? 34 : 21 + Math.min(9, maceSpeed * 0.08);
      ctx.fillStyle = overdrive ? '#fff' : '#f97316';
      ctx.shadowColor = overdrive ? '#fff' : '#f97316';
      ctx.shadowBlur = overdrive ? 46 : 30;
      ctx.beginPath();
      ctx.arc(mace.x, mace.y, maceRadius, 0, Math.PI * 2);
      ctx.fill();

      if (step === 4) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(core.x, core.y, 40 + Math.sin(time / 180) * 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (scene.mode === 'menu' && isSmallPreview) scene.staticDrawn = true;
    };

    const handlePreviewResize = () => scenes.forEach((scene) => { scene.width = 0; });
    let frame = 0;
    let lastPreviewFrame = 0;
    const loop = (time) => {
      const isSmallPreview = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < MOBILE_BREAKPOINT;
      const frameInterval = isSmallPreview ? 1000 / 12 : 1000 / 30;
      if (time - lastPreviewFrame < frameInterval) {
        frame = requestAnimationFrame(loop);
        return;
      }
      lastPreviewFrame = time;
      scenes.forEach((scene) => drawScene(scene, time));
      frame = requestAnimationFrame(loop);
    };

    window.addEventListener('resize', handlePreviewResize);

    const isStaticMenuPreview = !showTutorial && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < MOBILE_BREAKPOINT);
    if (isStaticMenuPreview) {
      frame = requestAnimationFrame((time) => {
        scenes.forEach((scene) => drawScene(scene, time));
      });
    } else {
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handlePreviewResize);
    };
  }, [gameState, showTutorial, tutorialStep]);

  // The massive game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    let s = stateRef.current;
    const perf = s.performance;
    let appliedRenderScale = perf.renderScale ?? 1;

    // Handle Window Resize
    const resizeCanvas = () => {
      s.width = window.innerWidth;
      s.height = window.innerHeight;
      const renderScale = perf.renderScale ?? 1;
      appliedRenderScale = renderScale;
      canvas.width = Math.floor(s.width * renderScale);
      canvas.height = Math.floor(s.height * renderScale);
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    };
    const handleResize = () => resizeCanvas();
    window.addEventListener('resize', handleResize);
    resizeCanvas();

    const updateQuality = (deltaMs) => {
      if (!perf.autoQuality) return;
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      perf.frameAvg = perf.frameAvg * 0.94 + deltaMs * 0.06;
      if (perf.qualityCooldown > 0) perf.qualityCooldown--;

      const downThreshold = perf.isMobile ? 24 : 30;
      const upThreshold = perf.isMobile ? 17 : 19;
      const presets = perf.isMobile ? QUALITY_PRESETS.mobile : QUALITY_PRESETS.desktop;

      if (perf.qualityCooldown <= 0 && perf.frameAvg > downThreshold && perf.quality < presets.length - 1) {
        applyQualityPreset(perf, perf.quality + 1);
        setGraphicsQuality(perf.quality);
        perf.qualityCooldown = 90;
        resizeCanvas();
      } else if (perf.qualityCooldown <= 0 && perf.frameAvg < upThreshold && perf.quality > 0) {
        applyQualityPreset(perf, perf.quality - 1);
        setGraphicsQuality(perf.quality);
        perf.qualityCooldown = 180;
        resizeCanvas();
      } else if (Math.abs((perf.renderScale ?? 1) - appliedRenderScale) > 0.01) {
        resizeCanvas();
      }
    };

    // Handle Input Tracking
    const handlePointerMove = (e) => {
      if (s.activePointerId !== null && e.pointerId !== s.activePointerId && e.pointerType !== 'mouse') {
        return;
      }
      s.mouse.x = e.clientX;
      s.mouse.y = e.clientY;
    };
    const handlePointerDown = (e) => {
      s.activePointerId = e.pointerId;
      s.isMouseDown = true;
      s.mouse.x = e.clientX;
      s.mouse.y = e.clientY;
      if (e.pointerType !== 'mouse') {
        e.preventDefault();
        canvas.setPointerCapture?.(e.pointerId);
      }
    };
    const handlePointerUp = (e) => {
      if (s.activePointerId !== null && e.pointerId !== s.activePointerId && e.pointerType !== 'mouse') {
        return;
      }
      s.isMouseDown = false;
      s.activePointerId = null;
      if (e.pointerType !== 'mouse') {
        e.preventDefault();
      }
    };
    
    canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    window.addEventListener('pointerup', handlePointerUp, { passive: false });
    window.addEventListener('pointercancel', handlePointerUp, { passive: false });

    // Helper functions inside the loop
    const spawnEnemy = () => {
      const isFast = Math.random() < 0.2 * (s.wave * 0.5);
      const isTank = Math.random() < 0.1 * (s.wave * 0.5);
      const isSplitter = s.wave >= 2 && Math.random() < 0.08 + s.wave * 0.01;
      
      let radius = 15;
      let hp = 1;
      let speed = 2 + Math.random() * 1.5;
      let type = 'basic';
      let color = '#f0f';

      if (isSplitter) {
        radius = 18; speed = 1.7; hp = 2; type = 'splitter'; color = '#a855f7';
      } else if (isFast) {
        radius = 12; speed = 4; type = 'fast'; color = '#ff0';
      } else if (isTank) {
        radius = 25; speed = 1.2; hp = 3; type = 'tank'; color = '#0f0';
      }

      // Spawn slightly off screen
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.max(s.width, s.height) / 1.5;
      
      s.enemies.push({
        x: s.width/2 + Math.cos(angle) * dist,
        y: s.height/2 + Math.sin(angle) * dist,
        vx: 0, vy: 0, radius, hp, speed, type, color, hitFlash: 0
      });
    };

    const spawnSplitterShards = (enemy) => {
      for (let n = 0; n < 2; n++) {
        const angle = Math.random() * Math.PI * 2;
        s.enemies.push({
          x: enemy.x + Math.cos(angle) * 20,
          y: enemy.y + Math.sin(angle) * 20,
          vx: Math.cos(angle) * 6,
          vy: Math.sin(angle) * 6,
          radius: 10,
          hp: 1,
          speed: 3.6,
          type: 'fast',
          color: '#facc15',
          hitFlash: 0,
        });
      }
    };

    const spawnParticles = (x, y, color, count, speedFactor = 1) => {
      const particleCount = Math.max(1, Math.floor(count * perf.particleMultiplier));
      const skipHeavyParticles = perf.quality >= 2;
      for (let i = 0; i < particleCount; i++) {
        if (skipHeavyParticles && i % 2 === 1) continue;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 * speedFactor;
        s.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          decay: 0.02 + Math.random() * 0.03,
          color,
          size: 2 + Math.random() * 4
        });
      }
      if (s.particles.length > perf.particleCap) {
        s.particles.splice(0, s.particles.length - perf.particleCap);
      }
    };

    const spawnFloatingText = (text, x, y, color) => {
      s.texts.push({ text, x, y, life: 1.0, color, vy: -1 - Math.random() });
      if (s.texts.length > perf.textCap) {
        s.texts.splice(0, s.texts.length - perf.textCap);
      }
    };

    const detonateBomb = (x, y) => {
      let destroyed = 0;
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        const dist = Math.hypot(e.x - x, e.y - y);
        if (dist < 310) {
          s.enemies.splice(i, 1);
          destroyed++;
          spawnParticles(e.x, e.y, e.color, 12, 2);
          if (e.type === 'splitter') spawnSplitterShards(e);
        }
      }
      s.bombs++;
      s.score += destroyed * 35;
      s.shake += 18;
      spawnParticles(x, y, '#fb7185', 45, 3);
      spawnFloatingText(`BOMB x${destroyed}`, x, y, '#fb7185');
      audio.bomb();
      checkAchievements({ bombs: s.bombs, score: s.score });
    };

    const triggerChainLightning = (x, y) => {
      let arcs = 0;
      const targets = [...s.enemies]
        .map((enemy) => ({ enemy, dist: Math.hypot(enemy.x - x, enemy.y - y) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 7);

      targets.forEach(({ enemy }, index) => {
        const enemyIndex = s.enemies.indexOf(enemy);
        if (enemyIndex >= 0) {
          s.enemies.splice(enemyIndex, 1);
          arcs++;
          spawnParticles(enemy.x, enemy.y, '#fde047', 18, 2.2);
          spawnFloatingText(index === 0 ? 'CHAIN!' : 'ZAP', enemy.x, enemy.y, '#fde047');
          if (enemy.type === 'splitter') spawnSplitterShards(enemy);
        }
      });

      s.score += arcs * 45;
      s.powerupsCollected++;
      s.shake += 12;
      spawnParticles(x, y, '#fde047', 28, 2.5);
      audio.chain();
      checkAchievements({ score: s.score, powerupsCollected: s.powerupsCollected });
    };

    const triggerSingularity = (x, y) => {
      let crushed = 0;
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        const dist = Math.hypot(e.x - x, e.y - y);
        if (dist < 420) {
          e.x += (x - e.x) * 0.72;
          e.y += (y - e.y) * 0.72;
          if (dist < 260) {
            s.enemies.splice(i, 1);
            crushed++;
            spawnParticles(e.x, e.y, '#c084fc', 16, 2);
            if (e.type === 'splitter') spawnSplitterShards(e);
          }
        }
      }

      s.score += crushed * 55;
      s.powerupsCollected++;
      s.shake += 24;
      spawnParticles(x, y, '#c084fc', 70, 3);
      spawnFloatingText(`SINGULARITY x${crushed}`, x, y, '#e9d5ff');
      audio.singularity();
      checkAchievements({ score: s.score, powerupsCollected: s.powerupsCollected });
    };

    // Main Update Function
    const update = () => {
      s.frames++;

      // Hit-stop effect (pauses physics for dramatic impact)
      if (s.hitStop > 0) {
        s.hitStop--;
        return; 
      }

      // --- Overdrive Logic ---
      if (s.isMouseDown && s.energy >= s.maxEnergy && !s.isOverdrive) {
        s.isOverdrive = true;
        s.energy = 0;
        s.overdriveTimer = 300; // 5 seconds at 60fps
        s.overdrives++;
        s.shake += 20;
        audio.overdrive();
        setEnergy(0);
        checkAchievements({ overdrives: s.overdrives });
      }

      if (s.giantMaceTimer > 0) s.giantMaceTimer--;
      if (s.freezeTimer > 0) s.freezeTimer--;
      if (s.magnetTimer > 0) s.magnetTimer--;
      if (s.shieldTimer > 0) s.shieldTimer--;

      const activeMaceRadius = s.isOverdrive ? MACE_RADIUS * 2.5 : (s.giantMaceTimer > 0 ? MACE_RADIUS * 2.0 : MACE_RADIUS);
      
      if (s.isOverdrive) {
        s.overdriveTimer--;
        s.shake = Math.max(s.shake, 2); // constant hum shake
        if (s.overdriveTimer <= 0) {
          s.isOverdrive = false;
        }
      }

      // --- Physics: Chain & Mace ---
      // Node 0 (Core) smoothly follows mouse
      s.nodes[0].oldX = s.nodes[0].x;
      s.nodes[0].oldY = s.nodes[0].y;
      s.nodes[0].x += (s.mouse.x - s.nodes[0].x) * perf.coreFollow;
      s.nodes[0].y += (s.mouse.y - s.nodes[0].y) * perf.coreFollow;

      // Verlet integration for the rest of the chain
      for (let i = 1; i < NUM_NODES; i++) {
        let n = s.nodes[i];
        let vx = (n.x - n.oldX) * perf.friction; // Friction
        let vy = (n.y - n.oldY) * perf.friction;
        
        n.oldX = n.x;
        n.oldY = n.y;
        
        n.x += vx;
        n.y += vy;
      }

      // Solve Constraints (Stiffen the chain)
      for (let iter = 0; iter < perf.constraintIterations; iter++) {
        for (let i = 0; i < NUM_NODES - 1; i++) {
          let n1 = s.nodes[i];
          let n2 = s.nodes[i+1];
          let dx = n2.x - n1.x;
          let dy = n2.y - n1.y;
          let dist = Math.hypot(dx, dy);
          if (dist === 0) dist = 0.01;
          
          let diff = SEGMENT_LENGTH - dist;
          let percent = diff / dist / 2;
          let offsetX = dx * percent;
          let offsetY = dy * percent;

          if (i === 0) {
            // Core is heavy/fixed to mouse, don't move it during constraint
            n2.x += offsetX * 2;
            n2.y += offsetY * 2;
          } else {
            n1.x -= offsetX;
            n1.y -= offsetY;
            n2.x += offsetX;
            n2.y += offsetY;
          }
        }
      }

      // Mace Logic (The last node)
      const mace = s.nodes[NUM_NODES - 1];
      let maceSpeed = Math.hypot(mace.x - mace.oldX, mace.y - mace.oldY);
      
      // Update Mace Trail
      s.maceHistory.push({ x: mace.x, y: mace.y });
      if (s.maceHistory.length > (s.isOverdrive ? perf.overdriveTrailLength : perf.trailLength)) s.maceHistory.shift();

      // --- Spawning ---
      if (s.frames % Math.max(10, Math.floor(s.spawnRate)) === 0) {
        spawnEnemy();
      }

      // Wave progression - Slowed down ramp up (1200 frames instead of 600)
      if (s.frames % 1200 === 0) {
        s.wave++;
        s.spawnRate = Math.max(20, s.spawnRate - 3); // More gentle scaling
        spawnFloatingText(`WAVE ${s.wave}`, s.width / 2, 90, '#67e8f9');
        triggerCelebration(`Wave ${s.wave}`, 'The swarm is getting meaner.', 'cyan');
        checkAchievements({ wave: s.wave });
      }

      // Combo Decay
      if (s.comboTimer > 0) {
        s.comboTimer--;
        if (s.comboTimer <= 0) s.combo = 0;
      }

      // Player Invulnerability
      if (s.invulnTimer > 0) s.invulnTimer--;

      // --- Entities Update & Collisions ---
      const core = s.nodes[0];

      // Update Pickups (Energy Orbs)
      for (let i = s.pickups.length - 1; i >= 0; i--) {
        let p = s.pickups[i];
        
        // Magnetism to core
        let dx = core.x - p.x;
        let dy = core.y - p.y;
        let dist = Math.hypot(dx, dy);
        
        const magnetRange = s.magnetTimer > 0 ? 320 : 150;
        if ((dist < magnetRange || s.isOverdrive) && dist > 0.01) {
          const pull = s.magnetTimer > 0 ? 12 : 8;
          p.x += (dx / dist) * pull;
          p.y += (dy / dist) * pull;
        }

        // Collection
        if (dist < CORE_RADIUS + 5) {
          s.pickupsCollected++;
          if (p.type === 'energy' || !p.type) {
            if (!s.isOverdrive) {
              s.energy = Math.min(s.maxEnergy, s.energy + (s.magnetTimer > 0 ? 7 : 5));
              setEnergy(s.energy);
            }
            audio.collect();
          } else if (p.type === 'health') {
            if (s.health < 3) {
              s.health++;
              setHealth(s.health);
            }
            audio.powerup();
            spawnFloatingText("+1 HEALTH", p.x, p.y, '#0f0');
          } else if (p.type === 'giant') {
            s.giantMaceTimer = 600; // 10 seconds
            s.powerupsCollected++;
            audio.powerup();
            spawnFloatingText("GIANT MACE!", p.x, p.y, '#f90');
          } else if (p.type === 'freeze') {
            s.freezeTimer = 300;
            s.freezes++;
            s.powerupsCollected++;
            audio.powerup();
            spawnFloatingText("TIME FREEZE!", p.x, p.y, '#93c5fd');
          } else if (p.type === 'magnet') {
            s.magnetTimer = 600;
            s.powerupsCollected++;
            audio.powerup();
            spawnFloatingText("MAGNET CORE!", p.x, p.y, '#22d3ee');
          } else if (p.type === 'bomb') {
            s.powerupsCollected++;
            detonateBomb(p.x, p.y);
          } else if (p.type === 'shield') {
            s.shieldTimer = 480;
            s.powerupsCollected++;
            audio.powerup();
            spawnFloatingText("CORE SHIELD!", p.x, p.y, '#38bdf8');
          } else if (p.type === 'chain') {
            triggerChainLightning(p.x, p.y);
          } else if (p.type === 'singularity') {
            triggerSingularity(p.x, p.y);
          }
          checkAchievements({
            pickupsCollected: s.pickupsCollected,
            powerupsCollected: s.powerupsCollected,
            freezes: s.freezes,
            score: s.score,
          });
          s.pickups.splice(i, 1);
        }
      }

      // Update Enemies
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        let e = s.enemies[i];
        if (e.hitFlash > 0) e.hitFlash--;

        // AI: Move towards core
        let angleToCore = Math.atan2(core.y - e.y, core.x - e.x);
        const freezeFactor = s.freezeTimer > 0 ? 0.28 : 1;
        e.vx = Math.cos(angleToCore) * e.speed * freezeFactor;
        e.vy = Math.sin(angleToCore) * e.speed * freezeFactor;

        e.x += e.vx;
        e.y += e.vy;

        // Collision: Mace vs Enemy
        let mdx = mace.x - e.x;
        let mdy = mace.y - e.y;
        let mDist = Math.hypot(mdx, mdy);

        // Mace has a damage threshold based on speed. Overdrive always kills.
        let isLethalHit = s.isOverdrive || maceSpeed > 8; 

        if (mDist < activeMaceRadius + e.radius) {
          if (isLethalHit) {
            // Apply Damage
            e.hp--;
            e.hitFlash = 5;
            
            // Knockback
            e.x -= mdx * 0.5;
            e.y -= mdy * 0.5;

            if (e.hp <= 0) {
              // Enemy Destroyed
              s.enemies.splice(i, 1);
              spawnParticles(e.x, e.y, e.color, 15, maceSpeed * 0.1);
              
              // Drop Pickup
              if (Math.random() < 0.45) {
                let type = 'energy';
                let roll = Math.random();
                if (roll < 0.05) type = 'health'; // 5% chance for Health
                else if (roll < 0.12) type = 'giant'; // Giant Mace
                else if (roll < 0.19) type = 'freeze'; // Time Freeze
                else if (roll < 0.26) type = 'magnet'; // Pickup Magnet
                else if (roll < 0.32) type = 'bomb'; // Screen-clearing burst
                else if (roll < 0.38) type = 'shield'; // Brief core guard
                else if (roll < 0.43 && s.loadout.power_chain) type = 'chain'; // Unlockable chain burst
                else if (roll < 0.47 && s.loadout.power_singularity) type = 'singularity'; // Unlockable crush zone
                s.pickups.push({x: e.x, y: e.y, type});
              }

              if (e.type === 'splitter') spawnSplitterShards(e);

              // Combo & Score
              s.kills++;
              s.combo++;
              s.maxCombo = Math.max(s.maxCombo, s.combo);
              s.comboTimer = 120; // 2 seconds to keep combo
              let points = 10 * s.combo;
              s.score += points;
              spawnFloatingText(s.combo > 1 ? `${points} (x${s.combo})` : `${points}`, e.x, e.y, '#fff');
              checkAchievements({
                score: s.score,
                kills: s.kills,
                maxCombo: s.maxCombo,
              });
              
              // Juice
              if (maceSpeed > 25 || s.isOverdrive) {
                s.shake += 8;
                s.hitStop = Math.max(1, Math.round(2 * perf.hitStopMultiplier)); // Pause for impact
                audio.smash();
              } else {
                s.shake += 2;
                audio.hit();
              }
              continue; // Enemy dead, skip rest
            } else {
              // Hit but didn't die (Tank)
              audio.hit();
              spawnParticles(e.x, e.y, '#fff', 5);
              // Bounce mace off tank slightly
              mace.x += mdx * 0.2;
              mace.y += mdy * 0.2;
            }
          } else {
            // Low speed hit - just push enemy away softly
            e.x -= mdx * 0.1;
            e.y -= mdy * 0.1;
          }
        }

        // Collision: Enemy vs Player Core
        let cdx = core.x - e.x;
        let cdy = core.y - e.y;
        let cDist = Math.hypot(cdx, cdy);
        
        if (cDist < CORE_RADIUS + e.radius && s.invulnTimer <= 0) {
          if (s.shieldTimer > 0) {
            s.shieldTimer = 0;
            s.invulnTimer = 40;
            s.shake += 12;
            audio.powerup();
            spawnParticles(core.x, core.y, '#38bdf8', 36, 2.5);
            spawnFloatingText("SHIELD BREAK", core.x, core.y - 25, '#38bdf8');
            s.enemies.forEach(en => {
              let dx = en.x - core.x;
              let dy = en.y - core.y;
              let d = Math.max(1, Math.hypot(dx, dy));
              if (d < 260) {
                en.x += (dx/d) * 75;
                en.y += (dy/d) * 75;
              }
            });
            continue;
          }
          // Take Damage
          s.health--;
          setHealth(s.health);
          s.invulnTimer = 90; // 1.5 seconds i-frames
          s.shake += 15;
          s.combo = 0;
          audio.damage();
          spawnParticles(core.x, core.y, '#0ff', 30, 2);
          
          // Push enemies away in a shockwave
          s.enemies.forEach(en => {
            let dx = en.x - core.x;
            let dy = en.y - core.y;
            let d = Math.hypot(dx, dy);
            if (d < 200) {
              en.x += (dx/d) * 50;
              en.y += (dy/d) * 50;
            }
          });

          if (s.health <= 0) {
            if (s.loadout.power_second_wind && !s.secondWindUsed) {
              s.secondWindUsed = true;
              s.health = 1;
              setHealth(1);
              s.invulnTimer = 180;
              s.shieldTimer = 360;
              s.energy = Math.min(s.maxEnergy, s.energy + 50);
              setEnergy(s.energy);
              s.shake += 26;
              spawnParticles(core.x, core.y, '#fef08a', 80, 3);
              spawnFloatingText('SECOND WIND!', core.x, core.y - 32, '#fef08a');
              audio.achievement();
              continue;
            }

            recordLocalScore(s.score);
            const storedHighScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
            if (s.score > storedHighScore) {
              localStorage.setItem(HIGH_SCORE_KEY, String(s.score));
              setLocalHighScore(s.score);
              triggerCelebration('New high score', `${s.score.toLocaleString()} points`, 'gold');
              checkAchievements({ didSetHighScore: true, score: s.score });
              audio.achievement();
            }
            audio.stopMusic();
            setScore(s.score);
            setGameState('gameover');
          }
        }
      }

      // Update Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        let p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life -= p.decay;
        if (p.life <= 0) s.particles.splice(i, 1);
      }

      // Update Texts
      for (let i = s.texts.length - 1; i >= 0; i--) {
        let t = s.texts[i];
        t.y += t.vy;
        t.life -= 0.02;
        if (t.life <= 0) s.texts.splice(i, 1);
      }
      
      // Sync score to React state periodically to avoid lag
      if (s.frames % perf.hudSyncInterval === 0) {
        setScore(s.score);
        setActiveEffects([
          s.giantMaceTimer > 0 && { label: 'GIANT', value: s.giantMaceTimer },
          s.freezeTimer > 0 && { label: 'FREEZE', value: s.freezeTimer },
          s.magnetTimer > 0 && { label: 'MAGNET', value: s.magnetTimer },
          s.shieldTimer > 0 && { label: 'SHIELD', value: s.shieldTimer },
        ].filter(Boolean));
      }
    };

    // Main Draw Function
    const draw = () => {
      const skin = s.loadout.skin_sunforge
        ? { core: '#facc15', inner: '#fff7ed', rope: '#f59e0b', mace: '#f97316', trail: 'rgba(250, 204, 21, 0.62)' }
        : s.loadout.skin_void
          ? { core: '#a78bfa', inner: '#f5f3ff', rope: '#c084fc', mace: '#7c3aed', trail: 'rgba(192, 132, 252, 0.62)' }
          : { core: '#0ff', inner: '#fff', rope: '#0ff', mace: null, trail: null };

      // Motion blur effect by drawing semi-transparent dark background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.isOverdrive ? 'rgba(5, 0, 15, 0.2)' : `rgba(10, 10, 12, ${perf.motionBlurAlpha})`;
      ctx.fillRect(0, 0, s.width, s.height);
      if (s.loadout.bg_aurora) {
        const aurora = ctx.createLinearGradient(0, 0, s.width, s.height);
        aurora.addColorStop(0, 'rgba(34, 211, 238, 0.08)');
        aurora.addColorStop(0.52, 'rgba(168, 85, 247, 0.08)');
        aurora.addColorStop(1, 'rgba(250, 204, 21, 0.05)');
        ctx.fillStyle = aurora;
        ctx.fillRect(0, 0, s.width, s.height);
      }

      // Screen Shake
      ctx.save();
      if (s.shake > 0) {
        const dx = (Math.random() - 0.5) * s.shake;
        const dy = (Math.random() - 0.5) * s.shake;
        ctx.translate(dx, dy);
        s.shake *= perf.shakeDecay; // decay shake
        if (s.shake < 0.5) s.shake = 0;
      }

      ctx.globalCompositeOperation = 'lighter';

      // Draw Grid (Subtle background motion)
      if (perf.drawGrid) {
        ctx.strokeStyle = `rgba(30, 40, 60, ${perf.gridAlpha})`;
        ctx.lineWidth = 1;
        const gridSize = 50;
        const offsetX = (s.nodes[0].x * 0.1) % gridSize;
        const offsetY = (s.nodes[0].y * 0.1) % gridSize;
        ctx.beginPath();
        for(let x = -offsetX; x < s.width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, s.height); }
        for(let y = -offsetY; y < s.height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(s.width, y); }
        ctx.stroke();
      }

      // Draw Pickups (Energy & Powerups)
      s.pickups.forEach(p => {
        if (p.type === 'health') {
          ctx.fillStyle = '#0f0';
          ctx.shadowColor = '#0f0';
        } else if (p.type === 'giant') {
          ctx.fillStyle = '#f90';
          ctx.shadowColor = '#f90';
        } else if (p.type === 'freeze') {
          ctx.fillStyle = '#93c5fd';
          ctx.shadowColor = '#93c5fd';
        } else if (p.type === 'magnet') {
          ctx.fillStyle = '#22d3ee';
          ctx.shadowColor = '#22d3ee';
        } else if (p.type === 'bomb') {
          ctx.fillStyle = '#fb7185';
          ctx.shadowColor = '#fb7185';
        } else if (p.type === 'shield') {
          ctx.fillStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
        } else if (p.type === 'chain') {
          ctx.fillStyle = '#fde047';
          ctx.shadowColor = '#fde047';
        } else if (p.type === 'singularity') {
          ctx.fillStyle = '#c084fc';
          ctx.shadowColor = '#c084fc';
        } else {
          ctx.fillStyle = '#0ff';
          ctx.shadowColor = '#0ff';
        }
        
        ctx.shadowBlur = perf.pickupGlow * perf.shadowScale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.type === 'energy' || !p.type ? 4 : 7, 0, Math.PI * 2);
        ctx.fill();

        // Draw cross for health
        if (p.type === 'health') {
          ctx.fillStyle = '#fff';
          ctx.shadowBlur = 0;
          ctx.fillRect(p.x - 1, p.y - 4, 2, 8);
          ctx.fillRect(p.x - 4, p.y - 1, 8, 2);
        } else if (p.type === 'bomb') {
          ctx.strokeStyle = '#fff';
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.type === 'freeze') {
          ctx.strokeStyle = '#fff';
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - 5, p.y);
          ctx.lineTo(p.x + 5, p.y);
          ctx.moveTo(p.x, p.y - 5);
          ctx.lineTo(p.x, p.y + 5);
          ctx.stroke();
        } else if (p.type === 'chain') {
          ctx.strokeStyle = '#fff';
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - 5, p.y - 7);
          ctx.lineTo(p.x + 1, p.y - 1);
          ctx.lineTo(p.x - 2, p.y - 1);
          ctx.lineTo(p.x + 5, p.y + 7);
          ctx.stroke();
        } else if (p.type === 'singularity') {
          ctx.strokeStyle = '#fff';
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 11, 0, Math.PI * 1.55);
          ctx.stroke();
        }
      });

      // Draw Enemies
      s.enemies.forEach(e => {
        ctx.shadowBlur = (e.hitFlash > 0 ? perf.enemyGlow * 2 : perf.enemyGlow) * perf.shadowScale;
        const frozen = s.freezeTimer > 0;
        ctx.shadowColor = e.hitFlash > 0 ? '#fff' : frozen ? '#93c5fd' : e.color;
        ctx.fillStyle = e.hitFlash > 0 ? '#fff' : frozen ? '#bfdbfe' : e.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;

        ctx.beginPath();
        if (e.type === 'basic') {
          // Diamond
          ctx.moveTo(e.x, e.y - e.radius);
          ctx.lineTo(e.x + e.radius, e.y);
          ctx.lineTo(e.x, e.y + e.radius);
          ctx.lineTo(e.x - e.radius, e.y);
        } else if (e.type === 'fast') {
          // Triangle pointing to core
          let angle = Math.atan2(s.nodes[0].y - e.y, s.nodes[0].x - e.x);
          ctx.moveTo(e.x + Math.cos(angle) * e.radius, e.y + Math.sin(angle) * e.radius);
          ctx.lineTo(e.x + Math.cos(angle + 2.5) * e.radius, e.y + Math.sin(angle + 2.5) * e.radius);
          ctx.lineTo(e.x + Math.cos(angle - 2.5) * e.radius, e.y + Math.sin(angle - 2.5) * e.radius);
        } else if (e.type === 'tank') {
          // Square Tank
          ctx.rect(e.x - e.radius, e.y - e.radius, e.radius*2, e.radius*2);
        } else {
          // Splitter
          ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
          ctx.moveTo(e.x - e.radius, e.y);
          ctx.lineTo(e.x + e.radius, e.y);
          ctx.moveTo(e.x, e.y - e.radius);
          ctx.lineTo(e.x, e.y + e.radius);
        }
        ctx.closePath();
        ctx.fill();
        if (e.hitFlash > 0) ctx.stroke();
      });

      // Draw Particles
      s.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.shadowBlur = perf.quality >= 1 ? 0 : 5 * perf.shadowScale;
        ctx.shadowColor = p.color;
        ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      });
      ctx.globalAlpha = 1.0;

      // Draw Player Chain (Rope)
      ctx.shadowBlur = (s.isOverdrive ? perf.ropeGlow * 2 : perf.ropeGlow) * perf.shadowScale;
      ctx.shadowColor = s.isOverdrive ? '#fff' : skin.rope;
      ctx.strokeStyle = s.isOverdrive ? '#fff' : skin.rope;
      ctx.lineWidth = s.isOverdrive ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(s.nodes[0].x, s.nodes[0].y);
      for (let i = 1; i < NUM_NODES; i++) {
        ctx.lineTo(s.nodes[i].x, s.nodes[i].y);
      }
      ctx.stroke();

      // Draw Player Core
      if (s.invulnTimer % 10 < 5) { // Blink if invulnerable
        const core = s.nodes[0];
        ctx.fillStyle = skin.core;
        ctx.shadowBlur = perf.ropeGlow * 2 * perf.shadowScale;
        ctx.beginPath();
        ctx.arc(core.x, core.y, CORE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // Inner white core
        ctx.fillStyle = skin.inner;
        ctx.beginPath();
        ctx.arc(core.x, core.y, CORE_RADIUS/2, 0, Math.PI * 2);
        ctx.fill();
        if (s.shieldTimer > 0) {
          ctx.strokeStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 18 * perf.shadowScale;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(core.x, core.y, CORE_RADIUS + 9 + Math.sin(s.frames * 0.18) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw Mace
      const mace = s.nodes[NUM_NODES - 1];
      const maceSpeed = Math.hypot(mace.x - mace.oldX, mace.y - mace.oldY);
      const activeMaceRadius = s.isOverdrive ? MACE_RADIUS * 2.5 : (s.giantMaceTimer > 0 ? MACE_RADIUS * 2.0 : MACE_RADIUS);
      
      // Mace Tail
      if (s.maceHistory.length > 1 && perf.trailLength > 0) {
        ctx.beginPath();
        ctx.moveTo(s.maceHistory[0].x, s.maceHistory[0].y);
        for (let i = 1; i < s.maceHistory.length; i++) {
          ctx.lineTo(s.maceHistory[i].x, s.maceHistory[i].y);
        }
        ctx.lineWidth = activeMaceRadius * 0.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        let grad = ctx.createLinearGradient(
          s.maceHistory[0].x, s.maceHistory[0].y, mace.x, mace.y
        );
        if (s.isOverdrive) {
          grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          grad.addColorStop(1, 'rgba(100, 200, 255, 0.8)');
        } else {
          // Color heat map based on speed
          let r = Math.min(255, maceSpeed * 10);
          let g = Math.max(0, 100 - maceSpeed * 2);
          grad.addColorStop(0, `rgba(${r}, ${g}, 0, 0)`);
          grad.addColorStop(1, skin.trail ?? `rgba(${r}, ${g}, 0, 0.5)`);
        }
        
        ctx.strokeStyle = grad;
        ctx.stroke();
      }

      // Mace Head
      ctx.shadowBlur = (s.isOverdrive ? perf.overdriveMaceGlow : perf.maceGlowBase + maceSpeed * (perf.isMobile ? 0.55 : 1)) * perf.shadowScale;
      
      if (s.isOverdrive) {
        ctx.shadowColor = '#fff';
        ctx.fillStyle = '#ccffff';
      } else if (s.giantMaceTimer > 0) {
        ctx.shadowColor = '#f90';
        ctx.fillStyle = '#ffaa00';
      } else if (skin.mace) {
        ctx.shadowColor = skin.mace;
        ctx.fillStyle = skin.mace;
      } else {
        let r = Math.min(255, 100 + maceSpeed * 8);
        let g = Math.max(0, 150 - maceSpeed * 3);
        ctx.shadowColor = `rgb(${r}, ${g}, 0)`;
        ctx.fillStyle = `rgb(${r}, ${g}, 0)`;
      }

      ctx.beginPath();
      ctx.arc(mace.x, mace.y, activeMaceRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw Floating Texts
      ctx.shadowBlur = 0;
      s.texts.forEach(t => {
        ctx.fillStyle = t.color;
        ctx.globalAlpha = t.life;
        ctx.font = 'bold 20px "Courier New", Courier, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y);
      });
      ctx.globalAlpha = 1.0;

      ctx.restore(); // Restore from Screen Shake
    };

    // The Animation Loop
    let lastTime = window.performance.now();
    let accumulator = 0;
    const mobileLoop = (time) => {
      const deltaMs = Math.min(50, time - lastTime || FRAME_DURATION);
      lastTime = time;
      accumulator += deltaMs;
      const maxSteps = 4;
      let steps = 0;

      while (accumulator >= FRAME_DURATION && steps < maxSteps) {
        update();
        accumulator -= FRAME_DURATION;
        steps++;
      }

      if (steps === maxSteps && accumulator > FRAME_DURATION * 2) {
        accumulator = FRAME_DURATION;
      }

      draw();
      updateQuality(deltaMs);
      reqRef.current = requestAnimationFrame(mobileLoop);
    };
    let lastDesktopTime = window.performance.now();
    const desktopLoop = (time) => {
      const deltaMs = Math.min(50, time - lastDesktopTime || FRAME_DURATION);
      lastDesktopTime = time;
      update();
      draw();
      updateQuality(deltaMs);
      reqRef.current = requestAnimationFrame(desktopLoop);
    };
    reqRef.current = requestAnimationFrame(perf.isMobile ? mobileLoop : desktopLoop);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      cancelAnimationFrame(reqRef.current);
    };
  }, [gameState]);

  return (
    <div className="relative w-full h-screen bg-gray-950 overflow-hidden font-mono text-white select-none">
      
      {/* Game Canvas */}
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full block cursor-none touch-none"
      />

      <button
        onClick={toggleMute}
        className="absolute bottom-4 right-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-gray-950/70 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.16)] backdrop-blur transition-colors hover:bg-cyan-950/70"
        aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
        title={isMuted ? 'Unmute audio' : 'Mute audio'}
      >
        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>

      <div className="pointer-events-none absolute left-1/2 top-5 z-40 flex w-[min(92vw,440px)] -translate-x-1/2 flex-col gap-3">
        {celebrations.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border px-4 py-3 text-center font-bold shadow-2xl backdrop-blur-md animate-pulse ${
              item.tone === 'gold'
                ? 'border-yellow-300/70 bg-yellow-950/80 text-yellow-100 shadow-yellow-500/20'
                : 'border-cyan-300/60 bg-cyan-950/80 text-cyan-100 shadow-cyan-500/20'
            }`}
          >
            <div className="text-xs uppercase tracking-widest opacity-80">{item.title}</div>
            <div className="text-lg">{item.detail}</div>
          </div>
        ))}
      </div>

      {showBadges && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/85 p-4 backdrop-blur-md">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-cyan-400/30 bg-gray-900 p-6 shadow-[0_0_45px_rgba(34,211,238,0.18)]">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2 text-cyan-200">
                <Award size={20} />
                <h2 className="text-2xl font-black tracking-widest">BADGES</h2>
              </div>
              <button
                onClick={() => setShowBadges(false)}
                className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-bold uppercase tracking-widest text-gray-300 transition-colors hover:border-cyan-400 hover:text-cyan-200"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {ACHIEVEMENTS.map((item) => {
                const isUnlocked = Boolean(achievements[item.id]);
                return (
                  <div key={item.id} className={`rounded-lg border p-4 ${isUnlocked ? 'border-yellow-400/50 bg-yellow-950/25' : 'border-gray-800 bg-gray-950/55'}`}>
                    <div className={`text-sm font-black ${isUnlocked ? 'text-yellow-200' : 'text-gray-500'}`}>{item.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-gray-400">{item.desc}</div>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                      {isUnlocked ? `Unlocked ${new Date(achievements[item.id]).toLocaleDateString()}` : 'Locked'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showKey && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/85 p-4 backdrop-blur-md">
          <div className="max-h-[86vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-fuchsia-400/30 bg-gray-900 p-6 shadow-[0_0_45px_rgba(217,70,239,0.16)]">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2 text-fuchsia-200">
                <Zap size={20} />
                <h2 className="text-2xl font-black tracking-widest">COMBAT KEY</h2>
              </div>
              <button onClick={() => setShowKey(false)} className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-bold uppercase tracking-widest text-gray-300 transition-colors hover:border-fuchsia-400 hover:text-fuchsia-200">
                Close
              </button>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">Enemies</div>
                <div className="space-y-2">
                  {ENEMY_KEY.map((item) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-900">
                        <div
                          className="h-5 w-5 shadow-[0_0_12px_currentColor]"
                          style={{
                            color: item.color,
                            backgroundColor: item.color,
                            borderRadius: item.shape === 'circle' ? '999px' : item.shape === 'square' ? '2px' : '3px',
                            clipPath: item.shape === 'triangle' ? 'polygon(50% 0, 100% 86%, 0 86%)' : undefined,
                            transform: item.shape === 'diamond' ? 'rotate(45deg)' : undefined,
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-black text-white">{item.name}</div>
                        <div className="text-xs leading-snug text-gray-400">{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">Powerups</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {POWERUP_KEY.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.name} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-900" style={{ color: item.color }}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <div className="text-sm font-black text-white">{item.name}</div>
                          <div className="text-xs leading-snug text-gray-400">{item.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUnlocks && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/85 p-4 backdrop-blur-md">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-yellow-300/30 bg-gray-900 p-6 shadow-[0_0_45px_rgba(250,204,21,0.13)]">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2 text-yellow-200">
                <Sparkles size={20} />
                <h2 className="text-2xl font-black tracking-widest">UNLOCKS</h2>
              </div>
              <button onClick={() => setShowUnlocks(false)} className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-bold uppercase tracking-widest text-gray-300 transition-colors hover:border-yellow-300 hover:text-yellow-100">
                Close
              </button>
            </div>

            <div className="grid gap-2">
              {UNLOCKABLES.map((item) => {
                const isUnlocked = Boolean(unlocks[item.id]);
                const isEnabled = Boolean(loadout[item.id]);
                const TypeIcon = item.type === 'skin' ? Palette : item.type === 'sound' ? Music : item.type === 'background' ? Eye : Sparkles;
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleLoadout(item.id)}
                    disabled={!isUnlocked}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      isUnlocked
                        ? isEnabled
                          ? 'border-cyan-300/60 bg-cyan-950/40 text-cyan-100'
                          : 'border-gray-700 bg-gray-950/70 text-gray-200 hover:border-cyan-400/50'
                        : 'border-gray-800 bg-gray-950/50 text-gray-600'
                    }`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-950">
                      <TypeIcon size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black">{item.title}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest">{isUnlocked ? (isEnabled ? 'On' : 'Off') : 'Locked'}</span>
                      </div>
                      <div className="mt-1 text-xs leading-snug text-gray-400">{isUnlocked ? item.desc : item.requirement}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/85 p-4 backdrop-blur-md">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-lg border border-yellow-300/30 bg-gray-900 shadow-[0_0_45px_rgba(250,204,21,0.13)]">
            <div className="flex items-center justify-between gap-4 border-b border-gray-800 p-5">
              <div className="flex items-center gap-2 text-yellow-200">
                <Trophy size={20} />
                <div>
                  <h2 className="text-2xl font-black tracking-widest">{isLocalMode ? 'LOCAL LEADERBOARD' : 'LEADERBOARD'}</h2>
                  <div className="mt-1 text-xs font-bold uppercase tracking-widest text-gray-500">
                    {playerLeaderboardEntry
                      ? `You are #${playerLeaderboardIndex + 1} with ${Number(playerLeaderboardEntry.score).toLocaleString()}`
                      : 'Play a run to place yourself'}
                  </div>
                </div>
              </div>
              <button onClick={() => setShowLeaderboard(false)} className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-bold uppercase tracking-widest text-gray-300 transition-colors hover:border-yellow-300 hover:text-yellow-100">
                Close
              </button>
            </div>

            <div className="max-h-[68vh] overflow-y-auto p-4">
              {leaderboardRows.length > 0 ? (
                <div className="space-y-2">
                  {leaderboardRows.map((entry, index) => {
                    const isPlayer = index === playerLeaderboardIndex;
                    return (
                      <div
                        key={`${entry.name}-${entry.score}-${index}`}
                        className={`grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                          isPlayer
                            ? 'border-cyan-300/60 bg-cyan-950/40 text-cyan-50'
                            : 'border-gray-800 bg-gray-950/55 text-gray-200'
                        }`}
                      >
                        <span className={`font-black ${index < 3 ? 'text-yellow-200' : 'text-gray-500'}`}>#{index + 1}</span>
                        <span className="min-w-0 truncate font-bold">{entry.name || 'LOCAL'}</span>
                        <span className="font-mono text-cyan-300">{Number(entry.score).toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-950/55 px-4 py-10 text-center text-sm text-gray-500">
                  No scores yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showTutorial && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/90 p-4 backdrop-blur-md">
          <div className="grid max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border border-cyan-400/30 bg-gray-900 shadow-[0_0_55px_rgba(34,211,238,0.18)] md:grid-cols-[1.35fr_0.9fr]">
            <div className="tutorial-stage">
              <canvas ref={tutorialCanvasRef} className="absolute inset-0 h-full w-full" />
              <div className="tutorial-caption">{TUTORIAL_STEPS[tutorialStep].cue}</div>
            </div>

            <div className="flex flex-col justify-between gap-5 p-6">
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-widest text-cyan-300">
                  Tutorial {tutorialStep + 1}/{TUTORIAL_STEPS.length}
                </div>
                <h2 className="text-3xl font-black tracking-tight text-white">{TUTORIAL_STEPS[tutorialStep].title}</h2>
                <p className="mt-4 text-sm leading-relaxed text-gray-300">{TUTORIAL_STEPS[tutorialStep].body}</p>
              </div>

              <div>
                <div className="mb-4 flex gap-2">
                  {TUTORIAL_STEPS.map((step, index) => (
                    <button
                      key={step.title}
                      onClick={() => setTutorialStep(index)}
                      className={`h-2 flex-1 rounded-full transition-colors ${index === tutorialStep ? 'bg-cyan-300' : 'bg-gray-700'}`}
                      aria-label={`Tutorial step ${index + 1}`}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => setTutorialStep((step) => (step + TUTORIAL_STEPS.length - 1) % TUTORIAL_STEPS.length)}
                    className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm font-bold uppercase tracking-widest text-gray-200 transition-colors hover:border-cyan-400 hover:text-cyan-200"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setTutorialStep((step) => (step + 1) % TUTORIAL_STEPS.length)}
                    className="rounded-lg border border-cyan-400/50 bg-cyan-950/60 px-4 py-3 text-sm font-bold uppercase tracking-widest text-cyan-100 transition-colors hover:bg-cyan-900/70"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => {
                      setShowTutorial(false);
                      setTutorialStep(0);
                    }}
                    className="rounded-lg bg-cyan-600 px-4 py-3 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-cyan-500"
                  >
                    Got It
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- UI HUD --- */}
      {gameState === 'playing' && (
        <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none z-10">
          <div className="flex flex-col gap-2">
            <div className="text-3xl font-bold tracking-wider text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
              SCORE: {score.toLocaleString()}
            </div>
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <Shield 
                  key={i} 
                  size={24} 
                  className={i < health ? "text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,1)]" : "text-gray-700"} 
                  fill={i < health ? "currentColor" : "none"}
                />
              ))}
            </div>
            {activeEffects.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {activeEffects.map((effect) => (
                  <div key={effect.label} className="rounded border border-cyan-400/40 bg-gray-950/70 px-2 py-1 text-xs font-bold text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.2)]">
                    {effect.label} {Math.ceil(effect.value / 60)}s
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex flex-col items-end gap-2 w-48">
            <div className="text-sm text-gray-400 font-bold">OVERDRIVE ENERGY</div>
            <div className="w-full h-4 bg-gray-800 rounded-full border border-gray-700 overflow-hidden">
              <div 
                className="h-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] transition-all duration-300 ease-out"
                style={{ width: `${energy}%`, backgroundColor: energy >= 100 ? '#fff' : '' }}
              />
            </div>
            {energy >= 100 && (
              <div className="text-xs text-white animate-pulse font-bold mt-1 tracking-widest">
                CLICK TO ACTIVATE!
              </div>
            )}
            <div className="mt-1 rounded border border-gray-700 bg-gray-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
              GFX {graphicsMode === 'auto' ? `Auto ${qualityLabel(graphicsQuality)}` : qualityLabel(graphicsQuality)}
            </div>
          </div>
        </div>
      )}

      {/* --- MENU UI --- */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/85 backdrop-blur-sm z-20 p-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 menu-grid opacity-70" />
          <div className="pointer-events-none absolute left-[8%] top-[18%] h-2 w-2 rounded-full bg-cyan-300 menu-spark" />
          <div className="pointer-events-none absolute right-[14%] top-[24%] h-2 w-2 rounded-full bg-fuchsia-300 menu-spark menu-spark-delay" />
          <div className="pointer-events-none absolute bottom-[14%] left-[20%] h-1.5 w-1.5 rounded-full bg-yellow-200 menu-spark menu-spark-slow" />

          <div className="relative grid h-[min(760px,92vh)] w-full max-w-6xl grid-rows-[auto_1fr_auto] gap-4 rounded-lg border border-cyan-400/20 bg-gray-950/40 p-5 shadow-[0_0_60px_rgba(34,211,238,0.12)] menu-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.36em] text-cyan-200/80">Arcade survival</div>
                <h1 className="mt-1 text-5xl font-black italic tracking-tighter text-white drop-shadow-2xl md:text-7xl">
                  ORBITAL SMASH
                </h1>
              </div>
              <div className="hidden flex-col items-end gap-2 sm:flex">
                <div className="flex gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
                  <button onClick={() => setShowBadges(true)} className="rounded border border-gray-700 bg-gray-950/70 px-3 py-2 hover:border-cyan-400 hover:text-cyan-200">
                    Badges {Object.keys(achievements).length}/{ACHIEVEMENTS.length}
                  </button>
                  <div className="rounded border border-gray-700 bg-gray-950/70 px-3 py-2 text-yellow-200">
                    Best {localHighScore.toLocaleString()}
                  </div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-950/70 p-1">
                  <div className="mb-1 px-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    Graphics {graphicsMode === 'auto' ? `Auto (${qualityLabel(graphicsQuality)})` : qualityLabel(graphicsQuality)}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {GRAPHICS_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setGraphics(option.id)}
                        className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
                          graphicsMode === option.id
                            ? 'bg-cyan-500 text-gray-950'
                            : 'bg-gray-900 text-gray-400 hover:bg-cyan-950 hover:text-cyan-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative min-h-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-950/70">
              <canvas ref={menuDemoCanvasRef} className="absolute inset-0 h-full w-full" />
              <div className="absolute right-3 top-3 w-52 rounded-lg border border-gray-700/80 bg-gray-950/80 p-3 shadow-[0_0_20px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-yellow-200">
                  <Trophy size={14} />
                  {isLocalMode ? 'Local Board' : 'Leaderboard'}
                </div>
                <div className="space-y-1.5">
                  {leaderboardRows.slice(0, 3).map((entry, index) => (
                    <div key={`${entry.name}-${entry.score}-${index}`} className="flex items-center gap-2 rounded border border-gray-800/80 bg-gray-900/70 px-2 py-1.5 text-xs">
                      <span className="w-5 text-gray-500">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate font-bold text-gray-100">{entry.name || 'LOCAL'}</span>
                      <span className="font-mono text-cyan-300">{Number(entry.score).toLocaleString()}</span>
                    </div>
                  ))}
                  {leaderboardRows.length === 0 && (
                    <div className="rounded border border-gray-800/80 bg-gray-900/70 px-2 py-3 text-center text-xs text-gray-500">
                      No runs yet
                    </div>
                  )}
                </div>
                <div className="mt-2 border-t border-gray-800 pt-2">
                  <button
                    onClick={() => setShowLeaderboard(true)}
                    className="w-full rounded border border-yellow-300/30 bg-yellow-950/30 px-2 py-1.5 text-xs font-black uppercase tracking-widest text-yellow-100 transition-colors hover:bg-yellow-900/40"
                  >
                    {playerLeaderboardEntry ? `You: #${playerLeaderboardIndex + 1}` : 'View all'}
                  </button>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                <div className="max-w-md text-lg font-bold text-cyan-50 md:text-2xl">
                  Swing the chain. Build speed. Smash the swarm.
                </div>
                <div className="rounded border border-yellow-300/30 bg-yellow-950/40 px-3 py-2 text-xs font-bold uppercase tracking-widest text-yellow-100">
                  Overdrive at 100%
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={startGame} className="group relative inline-flex items-center justify-center overflow-hidden rounded-lg bg-cyan-600 px-6 py-4 text-xl font-black text-white shadow-[0_0_30px_rgba(34,211,238,0.28)] transition-colors hover:bg-cyan-500 menu-start-button">
                  <div className="absolute inset-0 bg-white/20 group-hover:translate-x-full -translate-x-full transition-transform duration-500 ease-out skew-x-12"></div>
                  <Play className="mr-2" size={24} fill="currentColor" />
                  PLAY
                </button>
                <button onClick={() => { setTutorialStep(0); setShowTutorial(true); }} className="inline-flex items-center justify-center rounded-lg border border-fuchsia-400/40 bg-fuchsia-950/40 px-6 py-4 text-lg font-black text-fuchsia-100 transition-colors hover:bg-fuchsia-900/60">
                  <Sparkles className="mr-2" size={22} />
                  TUTORIAL
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-bold uppercase tracking-widest">
                <button onClick={() => setShowKey(true)} className="rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-3 text-gray-200 transition-colors hover:border-cyan-400 hover:text-cyan-200">
                  Key
                </button>
                <button onClick={() => setShowUnlocks(true)} className="rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-3 text-gray-200 transition-colors hover:border-yellow-300 hover:text-yellow-100">
                  Unlocks
                </button>
                <button onClick={() => setShowLeaderboard(true)} className="rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-3 text-gray-200 transition-colors hover:border-yellow-300 hover:text-yellow-100">
                  Board
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-gray-800 bg-gray-950/70 p-1 text-[10px] font-black uppercase tracking-widest sm:hidden">
              {GRAPHICS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setGraphics(option.id)}
                  className={`rounded px-2 py-2 transition-colors ${
                    graphicsMode === option.id
                      ? 'bg-cyan-500 text-gray-950'
                      : 'bg-gray-900 text-gray-400'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- GAME OVER UI --- */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-md z-20 animate-in fade-in duration-500 p-4">
          <h2 className="text-5xl md:text-6xl font-black text-red-500 tracking-widest drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] mb-2 text-center">
            CORE DESTROYED
          </h2>
          <div className="text-2xl md:text-3xl text-white mb-8 font-bold tracking-widest">
            FINAL SCORE: <span className="text-cyan-400">{score.toLocaleString()}</span>
          </div>
          <div className="mb-6 flex gap-3 text-xs font-bold uppercase tracking-widest">
            <div className="rounded-lg border border-yellow-400/30 bg-gray-950/50 px-4 py-2 text-yellow-200">
              Local Best {localHighScore.toLocaleString()}
            </div>
            <div className="rounded-lg border border-cyan-400/30 bg-gray-950/50 px-4 py-2 text-cyan-200">
              <button onClick={() => setShowBadges(true)} className="underline decoration-cyan-400/40 underline-offset-4 hover:text-cyan-100">
                Badges {Object.keys(achievements).length}/{ACHIEVEMENTS.length}
              </button>
            </div>
          </div>

          {!isLocalMode && (
          <div className="w-full max-w-sm bg-gray-900/80 p-6 rounded-2xl border border-red-900/50 shadow-2xl mb-8">
            <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2 font-bold">Transmit Identity</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value.toUpperCase().slice(0, 12))}
                    placeholder="PLAYER NAME"
                    className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-cyan-400 focus:outline-none focus:border-cyan-500 font-bold placeholder:text-gray-800"
                />
                <button
                    onClick={submitScore}
                    disabled={!playerName.trim() || isSubmitting}
                    className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 px-4 rounded-lg font-bold transition-colors"
                >
                    {isSubmitting ? "SENDING..." : <><Send size={18} /> SUBMIT</>}
                </button>
            </div>
          </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setShowBadges(true)}
              className="inline-flex items-center justify-center rounded-lg border border-cyan-400/40 bg-gray-950/70 px-5 py-4 font-bold text-cyan-100 transition-colors hover:bg-cyan-950/70"
            >
              <Award className="mr-2" size={20} />
              VIEW BADGES
            </button>
            <button
              onClick={() => setGameState('menu')}
              className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-950/70 px-5 py-4 font-bold text-gray-100 transition-colors hover:border-yellow-300/50 hover:text-yellow-100"
            >
              <Home className="mr-2" size={20} />
              MAIN MENU
            </button>
            <button
              onClick={startGame}
              className="group relative inline-flex items-center justify-center overflow-hidden rounded-lg bg-red-600 px-6 py-4 text-xl font-bold text-white shadow-[0_0_30px_rgba(220,38,38,0.5)] transition-all duration-200 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
            >
              <div className="absolute inset-0 bg-white/20 group-hover:translate-x-full -translate-x-full transition-transform duration-500 ease-out skew-x-12"></div>
              <RotateCcw className="mr-3" size={24} />
              RESTART
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
