import React, { useState, useEffect, useRef } from 'react';
import { Award, Bomb, Magnet, Play, RotateCcw, Shield, Snowflake, Trophy, Volume2, VolumeX, Zap } from 'lucide-react';

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
const MUTE_KEY = 'orbital_smash_muted';

const DREAMLO_PUBLIC = "69f664cb8f40bb1068bd441a";
const DREAMLO_PRIVATE = "qJcEBUUmAE6ApG2ZQjVRiw4nBSAtJFnUGNixUKRstFdA";

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
    .slice(0, 10);
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

const readStoredJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
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

  playTone(freq, type, duration, vol = 1, slideDown = false) {
    if (!this.enabled || !this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
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
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('orbital_smash_name') || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem(MUTE_KEY) === 'true');
  const [localHighScore, setLocalHighScore] = useState(() => Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0);
  const [achievements, setAchievements] = useState(() => readStoredJson(ACHIEVEMENTS_KEY, {}));
  const [celebrations, setCelebrations] = useState([]);
  const [activeEffects, setActiveEffects] = useState([]);
  
  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const stateRef = useRef(null);

  const triggerCelebration = (title, detail, tone = 'cyan') => {
    const id = `${Date.now()}-${Math.random()}`;
    setCelebrations((items) => [...items.slice(-2), { id, title, detail, tone }]);
    window.setTimeout(() => {
      setCelebrations((items) => items.filter((item) => item.id !== id));
    }, 3400);
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

    ACHIEVEMENTS.forEach((achievement) => {
      if (achievement.test(current)) unlockAchievement(achievement.id);
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

  const fetchLeaderboard = async () => {
    try {
      const data = await requestDreamlo(`${DREAMLO_PUBLIC}/json`);
      setLeaderboard(normalizeLeaderboardEntries(data));
    } catch (e) { console.error("Leaderboard fetch failed", e); }
  };

  const submitScore = async () => {
    if (!playerName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    localStorage.setItem('orbital_smash_name', playerName);
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
    const performance = isMobile
      ? {
          isMobile: true,
          coreFollow: 0.22,
          friction: 0.92,
          constraintIterations: 3,
          renderScale: 0.8,
          trailLength: 8,
          overdriveTrailLength: 14,
          particleMultiplier: 0.55,
          particleCap: 90,
          textCap: 12,
          pickupGlow: 6,
          enemyGlow: 6,
          ropeGlow: 6,
          maceGlowBase: 10,
          overdriveMaceGlow: 26,
          shakeDecay: 0.82,
          hitStopMultiplier: 0.5,
          drawGrid: false,
          motionBlurAlpha: 0.2,
          gridAlpha: 0.12,
          hudSyncInterval: 12,
        }
      : {
          isMobile: false,
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
          shakeDecay: 0.9,
          hitStopMultiplier: 1,
          drawGrid: true,
          motionBlurAlpha: 0.3,
          gridAlpha: 0.2,
          hudSyncInterval: 10,
        };
    
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

  // The massive game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    let s = stateRef.current;
    const perf = s.performance;

    // Handle Window Resize
    const handleResize = () => {
      s.width = window.innerWidth;
      s.height = window.innerHeight;
      const renderScale = perf.renderScale ?? 1;
      canvas.width = Math.floor(s.width * renderScale);
      canvas.height = Math.floor(s.height * renderScale);
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    };
    window.addEventListener('resize', handleResize);
    handleResize();

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
      for (let i = 0; i < particleCount; i++) {
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
      // Motion blur effect by drawing semi-transparent dark background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.isOverdrive ? 'rgba(5, 0, 15, 0.2)' : `rgba(10, 10, 12, ${perf.motionBlurAlpha})`;
      ctx.fillRect(0, 0, s.width, s.height);

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
        } else {
          ctx.fillStyle = '#0ff';
          ctx.shadowColor = '#0ff';
        }
        
        ctx.shadowBlur = perf.pickupGlow;
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
        }
      });

      // Draw Enemies
      s.enemies.forEach(e => {
        ctx.shadowBlur = e.hitFlash > 0 ? perf.enemyGlow * 2 : perf.enemyGlow;
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
        ctx.shadowBlur = 5;
        ctx.shadowColor = p.color;
        ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      });
      ctx.globalAlpha = 1.0;

      // Draw Player Chain (Rope)
      ctx.shadowBlur = s.isOverdrive ? perf.ropeGlow * 2 : perf.ropeGlow;
      ctx.shadowColor = s.isOverdrive ? '#fff' : '#0ff';
      ctx.strokeStyle = s.isOverdrive ? '#fff' : '#0ff';
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
        ctx.fillStyle = '#0ff';
        ctx.shadowBlur = perf.ropeGlow * 2;
        ctx.beginPath();
        ctx.arc(core.x, core.y, CORE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // Inner white core
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(core.x, core.y, CORE_RADIUS/2, 0, Math.PI * 2);
        ctx.fill();
        if (s.shieldTimer > 0) {
          ctx.strokeStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 18;
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
      if (s.maceHistory.length > 1) {
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
          grad.addColorStop(1, `rgba(${r}, ${g}, 0, 0.5)`);
        }
        
        ctx.strokeStyle = grad;
        ctx.stroke();
      }

      // Mace Head
      ctx.shadowBlur = s.isOverdrive ? perf.overdriveMaceGlow : perf.maceGlowBase + maceSpeed * (perf.isMobile ? 0.55 : 1);
      
      if (s.isOverdrive) {
        ctx.shadowColor = '#fff';
        ctx.fillStyle = '#ccffff';
      } else if (s.giantMaceTimer > 0) {
        ctx.shadowColor = '#f90';
        ctx.fillStyle = '#ffaa00';
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
      reqRef.current = requestAnimationFrame(mobileLoop);
    };
    const desktopLoop = () => {
      update();
      draw();
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
          </div>
        </div>
      )}

      {/* --- MENU UI --- */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/80 backdrop-blur-sm z-20 p-4 overflow-y-auto">
          <div className="relative group mb-8">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-pulse"></div>
            <h1 className="relative text-5xl md:text-7xl font-black italic tracking-tighter text-white drop-shadow-2xl px-8 py-4 bg-gray-900 rounded-lg text-center">
              ORBITAL SMASH
            </h1>
          </div>
          
          <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl items-stretch">
            {/* Left Column: Instructions */}
            <div className="flex-1 space-y-6 text-gray-300 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
                <p className="text-lg leading-relaxed text-center">
                You are the weapon. Swing your mouse to build momentum and obliterate the swarm.
                </p>
                
                <div className="grid grid-cols-1 gap-4 text-sm bg-gray-950/50 p-4 rounded-xl">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-800 rounded text-cyan-400"><Trophy size={16}/></div>
                    <span>Fast Swings = More Damage</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-800 rounded text-yellow-400"><Zap size={16}/></div>
                    <span>Collect Orbs for Energy</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex gap-1 p-2 bg-gray-800 rounded text-rose-400"><Bomb size={14}/><Snowflake size={14}/><Magnet size={14}/></div>
                    <span>Bomb, Freeze, Magnet, Shield, and Giant pickups can drop</span>
                </div>
                <div className="flex items-center gap-3 pt-4 border-t border-gray-800">
                    <div className="px-3 py-1 bg-gray-800 rounded border border-gray-600 font-bold">CLICK</div>
                    <span className="text-white font-bold tracking-widest text-xs">Activate Overdrive (100% Energy)</span>
                </div>
                </div>

                <button 
                onClick={startGame}
                className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-200 bg-cyan-600 text-xl rounded-xl hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-600 w-full"
                >
                <Play className="mr-2" size={24} fill="currentColor" />
                INITIATE NEON CORE
                </button>
            </div>

            {/* Right Column: Leaderboard */}
            <div className="w-full md:w-80 bg-gray-900/50 p-6 rounded-2xl border border-gray-800 flex flex-col">
                <div className="flex items-center gap-2 mb-4 text-cyan-400 border-b border-gray-800 pb-2">
                    <Trophy size={20}/>
                    <h2 className="text-xl font-bold tracking-widest">HALL OF FAME</h2>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                    <div className="text-gray-500 uppercase tracking-widest">Local Best</div>
                    <div className="text-lg font-black text-yellow-300">{localHighScore.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                    <div className="text-gray-500 uppercase tracking-widest">Badges</div>
                    <div className="text-lg font-black text-cyan-300">{Object.keys(achievements).length}/{ACHIEVEMENTS.length}</div>
                  </div>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto max-h-64 pr-2">
                    {leaderboard.length > 0 ? leaderboard.map((entry, i) => (
                        <div key={i} className="flex justify-between items-center text-sm bg-gray-950/50 p-2 rounded border border-gray-800/50">
                            <span className="text-gray-500 w-6">{i + 1}.</span>
                            <span className="flex-1 text-white font-bold truncate px-2">{entry.name}</span>
                            <span className="text-cyan-400 font-mono">{Number(entry.score).toLocaleString()}</span>
                        </div>
                    )) : (
                        <div className="text-center text-gray-600 py-8 italic text-sm">
                            Scanning satellites...
                        </div>
                    )}
                </div>
                <div className="mt-4 border-t border-gray-800 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500">
                    <Award size={14} />
                    Local Achievements
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ACHIEVEMENTS.slice(0, 6).map((item) => (
                      <div key={item.id} title={item.desc} className={`truncate rounded border px-2 py-1 text-xs font-bold ${achievements[item.id] ? 'border-yellow-400/50 bg-yellow-950/40 text-yellow-200' : 'border-gray-800 bg-gray-950/40 text-gray-600'}`}>
                        {item.title}
                      </div>
                    ))}
                  </div>
                </div>
            </div>
          </div>
          
          <p className="text-xs text-gray-500 mt-8 uppercase tracking-widest">Audio Required for Maximum Impact</p>
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
              Badges {Object.keys(achievements).length}/{ACHIEVEMENTS.length}
            </div>
          </div>

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
                    className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 px-4 rounded-lg transition-colors"
                >
                    {isSubmitting ? "..." : <Zap size={20} fill="currentColor"/>}
                </button>
            </div>
          </div>
          
          <button 
            onClick={startGame}
            className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-200 bg-red-600 text-xl rounded-xl hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-600 overflow-hidden shadow-[0_0_30px_rgba(220,38,38,0.5)]"
          >
            <div className="absolute inset-0 bg-white/20 group-hover:translate-x-full -translate-x-full transition-transform duration-500 ease-out skew-x-12"></div>
            <RotateCcw className="mr-3" size={24} />
            RESTART SIMULATION
          </button>
        </div>
      )}
    </div>
  );
}
