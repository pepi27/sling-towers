// ============================================================
//  TOWER SIEGE — Tower Defense + Skill Shot  (Pixi.js v7)
// ============================================================
const W = 1280, H = 720;
const GRAVITY    = 820;
const PATH_Y     = 385;   // y where enemies walk
const SHOP_H     = 80;    // bottom shop bar height
const SPAWN_X    = 1310;
const BASE_X     = 90;    // x of player base

// Slingshot (left side, fires RIGHT at incoming enemies)
const SL_ANCHOR = { x: 190, y: 498 };
const SL_FORK_L = { x: 168, y: 455 };
const SL_FORK_R = { x: 212, y: 455 };
const MAX_PULL   = 88;
const LAUNCH_SPD = 1100;
const SLOW_SCALE = 0.11;
const SHOT_CD    = 0.45;   // min seconds between manual shots

// Tower slot grid  (6 above path, 6 below)
const SLOT_XS = [350, 510, 670, 830, 990, 1150];
const SLOTS   = [
  ...SLOT_XS.map((x, i) => ({ x, y: 268, id: i,     tower: null })),
  ...SLOT_XS.map((x, i) => ({ x, y: 502, id: i + 6, tower: null })),
];

// Tower type catalogue
const TDEFS = {
  archer: { name:'Archer', cost:60,  color:0x3a8c3a, accent:0x66ff66, range:230, rate:1.1,  dmg:1,   spd:500, pc:0x88ff44, label:'60g · Steady' },
  cannon: { name:'Cannon', cost:130, color:0x556677, accent:0x99bbcc, range:290, rate:0.4,  dmg:4,   spd:680, pc:0x334455, label:'130g · Heavy'  },
  rapid:  { name:'Rapid',  cost:90,  color:0x224499, accent:0x6699ff, range:175, rate:3.5,  dmg:0.5, spd:920, pc:0x66aaff, label:'90g · Fast'   },
};

// ── State ─────────────────────────────────────────────────────
let gold = 150, lives = 20, waveNum = 0;
let phase = 'build';   // 'build' | 'wave'
let gameOver  = false;
let selectedType = 'archer';
let isAiming  = false, dragPos = null;
let timeScale = 1, shakeAmt = 0, shotCD = 0;
let lastAimPow = -1;

let waveQueue = [], waveSpawnT = 0, waveAlive = 0;

const enemies = [], projectiles = [], particles = [], coins = [], towers = [];

// ── Audio ─────────────────────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();

const _sfx = (fn) => { try { fn(); } catch(e){} };

function playLaunch() { _sfx(() => {
  const o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination);
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(360, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(75, AC.currentTime + 0.32);
  g.gain.setValueAtTime(0.4, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.32);
  o.start(); o.stop(AC.currentTime + 0.32);
}); }

function playHit(big) { _sfx(() => {
  const len = big ? 0.34 : 0.17;
  const buf = AC.createBuffer(1, ~~(AC.sampleRate * len), AC.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource(); src.buffer = buf;
  const flt = AC.createBiquadFilter(); flt.type = 'lowpass';
  flt.frequency.value = big ? 550 : 260;
  const g = AC.createGain();
  g.gain.setValueAtTime(big ? 0.9 : 0.45, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
  src.connect(flt); flt.connect(g); g.connect(AC.destination);
  src.start(); src.stop(AC.currentTime + len);
  if (big) {
    const o2 = AC.createOscillator(), g2 = AC.createGain();
    o2.connect(g2); g2.connect(AC.destination); o2.type = 'sine';
    o2.frequency.setValueAtTime(85, AC.currentTime);
    o2.frequency.exponentialRampToValueAtTime(22, AC.currentTime + 0.4);
    g2.gain.setValueAtTime(0.55, AC.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.4);
    o2.start(); o2.stop(AC.currentTime + 0.4);
  }
}); }

function playCoin() { _sfx(() => {
  const o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination); o.type = 'sine';
  o.frequency.setValueAtTime(960, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(1350, AC.currentTime + 0.09);
  g.gain.setValueAtTime(0.13, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.14);
  o.start(); o.stop(AC.currentTime + 0.14);
}); }

function playAimTick(p) { _sfx(() => {
  const o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination);
  o.frequency.value = 190 + p * 560;
  g.gain.setValueAtTime(0.07, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.06);
  o.start(); o.stop(AC.currentTime + 0.06);
}); }

// ── Pixi init ─────────────────────────────────────────────────
const app = new PIXI.Application({
  width: W, height: H, backgroundColor: 0x060e04,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById('game-container').appendChild(app.view);
app.view.style.display = 'block';
const slowOverlay = document.getElementById('slow-overlay');

// Layers (in z order)
const worldLayer = new PIXI.Container();
const bgLayer    = new PIXI.Container();
const slotLayer  = new PIXI.Container();
const towerLayer = new PIXI.Container();
const enemyLayer = new PIXI.Container();
const coinLayer  = new PIXI.Container();
const projLayer  = new PIXI.Container();
const fxLayer    = new PIXI.Container();
const aimLayer   = new PIXI.Container();
const uiLayer    = new PIXI.Container();

app.stage.addChild(worldLayer);
[bgLayer, slotLayer, towerLayer, enemyLayer, coinLayer, projLayer, fxLayer, aimLayer].forEach(l => worldLayer.addChild(l));
app.stage.addChild(uiLayer);

// ── Background ────────────────────────────────────────────────
(function drawBG() {
  const g = new PIXI.Graphics();
  // sky
  g.beginFill(0x0a1406); g.drawRect(0, 0, W, 260); g.endFill();
  // grass above path
  g.beginFill(0x163a0c); g.drawRect(0, 260, W, PATH_Y - 260); g.endFill();
  // dirt path
  g.beginFill(0x7a5c10); g.drawRect(0, PATH_Y - 8, W, 48); g.endFill();
  g.beginFill(0x9a740e, 0.6); g.drawRect(0, PATH_Y - 2, W, 6); g.endFill();
  // grass below path
  g.beginFill(0x163a0c); g.drawRect(0, PATH_Y + 40, W, H - PATH_Y - 40 - SHOP_H); g.endFill();
  // shop bar
  g.beginFill(0x08080f); g.drawRect(0, H - SHOP_H, W, SHOP_H); g.endFill();
  g.lineStyle(1, 0x333355, 0.8);
  g.moveTo(0, H - SHOP_H); g.lineTo(W, H - SHOP_H);
  bgLayer.addChild(g);

  // Path stones
  for (let px = 20; px < W; px += 38) {
    const s = new PIXI.Graphics();
    s.beginFill(0x6b4e10, 0.45);
    s.drawRoundedRect(px + Math.random()*8-4, PATH_Y - 10, 14, 7, 2); s.endFill();
    s.beginFill(0x6b4e10, 0.45);
    s.drawRoundedRect(px + Math.random()*8-4, PATH_Y + 42, 14, 7, 2); s.endFill();
    bgLayer.addChild(s);
  }

  // Stars
  for (let i = 0; i < 90; i++) {
    const s = new PIXI.Graphics();
    s.beginFill(0xffffff, Math.random() * 0.55 + 0.15);
    s.drawCircle(0, 0, Math.random() * 1.1 + 0.3); s.endFill();
    s.x = Math.random() * W; s.y = Math.random() * 200;
    bgLayer.addChild(s);
  }

  // Trees (decorative, along slots rows)
  for (let i = 0; i < 5; i++) {
    const tx = 280 + i * 190;
    [270, PATH_Y + 52].forEach(ty => {
      const t = new PIXI.Graphics();
      t.beginFill(0x1e5010); t.drawPolygon([0,-38, 22,0, -22,0]); t.endFill();
      t.beginFill(0x164010); t.drawPolygon([0,-60, 16,-18, -16,-18]); t.endFill();
      t.beginFill(0x3c2010); t.drawRect(-5, 0, 10, 18); t.endFill();
      t.x = tx; t.y = ty;
      bgLayer.addChild(t);
    });
  }

  // Base castle (left side)
  const c = new PIXI.Graphics();
  c.beginFill(0x3a3a55); c.drawRect(8, PATH_Y - 90, 88, 138); c.endFill();
  for (let i = 0; i < 5; i++) {
    c.beginFill(0x4a4a66); c.drawRect(8 + i * 18, PATH_Y - 108, 12, 22); c.endFill();
  }
  c.beginFill(0x1a1a28); c.drawRect(38, PATH_Y + 10, 28, 38); c.endFill(); // gate arch
  c.beginFill(0x5577aa, 0.7); c.drawRect(44, PATH_Y + 16, 10, 10); c.endFill();
  const flag = new PIXI.Graphics();
  flag.beginFill(0xee2222); flag.drawPolygon([0,0, 22,-14, 0,-28]); flag.endFill();
  flag.lineStyle(2, 0x888888); flag.moveTo(0,0); flag.lineTo(0,-34);
  flag.x = 8; flag.y = PATH_Y - 108;
  bgLayer.addChild(c); bgLayer.addChild(flag);

  // Slingshot body
  const sl = new PIXI.Graphics();
  sl.lineStyle(13, 0x5a2d0c); sl.moveTo(SL_ANCHOR.x, H - SHOP_H - 10); sl.lineTo(SL_ANCHOR.x, SL_ANCHOR.y + 10);
  sl.lineStyle(9,  0x6b3515); sl.moveTo(SL_ANCHOR.x, SL_ANCHOR.y + 10); sl.lineTo(SL_FORK_L.x, SL_FORK_L.y);
  sl.lineStyle(9,  0x6b3515); sl.moveTo(SL_ANCHOR.x, SL_ANCHOR.y + 10); sl.lineTo(SL_FORK_R.x, SL_FORK_R.y);
  sl.lineStyle(0);
  sl.beginFill(0x8b4513); sl.drawCircle(SL_FORK_L.x, SL_FORK_L.y, 7); sl.endFill();
  sl.beginFill(0x8b4513); sl.drawCircle(SL_FORK_R.x, SL_FORK_R.y, 7); sl.endFill();
  bgLayer.addChild(sl);
})();

// ── Tower slots (clickable zones) ─────────────────────────────
const slotGfxMap = new Map();
SLOTS.forEach(slot => {
  const g = new PIXI.Graphics();
  drawSlotGfx(g, slot, false);
  g.x = slot.x; g.y = slot.y;
  g.interactive = true; g.buttonMode = true;
  g.on('pointerdown', () => onSlotClick(slot));
  slotLayer.addChild(g);
  slotGfxMap.set(slot.id, g);
});

function drawSlotGfx(g, slot, hover) {
  g.clear();
  if (slot.tower) return; // tower covers it
  g.lineStyle(2, hover ? 0xffffff : 0x44aa44, hover ? 0.9 : 0.45);
  g.beginFill(0x1e5010, hover ? 0.55 : 0.25);
  g.drawRoundedRect(-24, -24, 48, 48, 6);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(hover ? 0xffffff : 0x44aa44, hover ? 0.7 : 0.35);
  g.drawPolygon([0,-10, 8,4, -8,4]); // + icon
  g.endFill();
}

function refreshSlot(slot) {
  const g = slotGfxMap.get(slot.id);
  drawSlotGfx(g, slot, false);
}

// ── HUD ───────────────────────────────────────────────────────
const hudStyle   = { fontFamily: 'Arial Black, Arial', fontSize: 18, fill: 0xffffff, dropShadow: true, dropShadowBlur: 6, dropShadowColor: 0x000000, dropShadowDistance: 2 };
const labelStyle = { fontFamily: 'Arial, sans-serif', fontSize: 13, fill: 0xaaaaaa };

const goldTxt  = new PIXI.Text('', hudStyle);
const livesTxt = new PIXI.Text('', hudStyle);
const waveTxt  = new PIXI.Text('', hudStyle);
goldTxt.x  = 14;  goldTxt.y  = 10;
livesTxt.x = 200; livesTxt.y = 10;
waveTxt.x  = 380; waveTxt.y  = 10;
uiLayer.addChild(goldTxt, livesTxt, waveTxt);

// Send Wave / Next Wave button
const waveBtn = new PIXI.Container();
const waveBtnBg = new PIXI.Graphics();
waveBtn.addChild(waveBtnBg);
const waveBtnTxt = new PIXI.Text('▶ Send Wave', { fontFamily:'Arial Black,Arial', fontSize:16, fill:0xffffff });
waveBtnTxt.anchor.set(0.5);
waveBtnTxt.x = 0; waveBtnTxt.y = 0;
waveBtn.addChild(waveBtnTxt);
waveBtn.x = W - 120; waveBtn.y = 24;
waveBtn.interactive = true; waveBtn.buttonMode = true;
waveBtn.on('pointerdown', startWave);
uiLayer.addChild(waveBtn);

function drawWaveBtn(hover) {
  waveBtnBg.clear();
  waveBtnBg.lineStyle(2, 0x66ff44, 0.9);
  waveBtnBg.beginFill(hover ? 0x338833 : 0x1a4a1a, 0.92);
  waveBtnBg.drawRoundedRect(-90, -18, 180, 36, 8);
  waveBtnBg.endFill();
}
waveBtn.on('pointerover',  () => drawWaveBtn(true));
waveBtn.on('pointerout',   () => drawWaveBtn(false));
drawWaveBtn(false);

// Shop bar
const SHOP_TYPES = Object.keys(TDEFS);
const shopBtns = [];
SHOP_TYPES.forEach((type, i) => {
  const def  = TDEFS[type];
  const btn  = new PIXI.Container();
  btn.x = 20 + i * 200; btn.y = H - SHOP_H + 8;
  btn.interactive = true; btn.buttonMode = true;
  btn.on('pointerdown', () => { selectedType = type; refreshShop(); });
  btn.on('pointerover',  () => { if (selectedType !== type) drawShopBtn(btn, type, false, true); });
  btn.on('pointerout',   () => { drawShopBtn(btn, type, selectedType === type, false); });

  const bg = new PIXI.Graphics();
  btn.addChild(bg);
  const swatch = new PIXI.Graphics();
  swatch.beginFill(def.color); swatch.drawRoundedRect(0, 0, 26, 26, 4); swatch.endFill();
  swatch.x = 8; swatch.y = 9;
  btn.addChild(swatch);
  const lbl = new PIXI.Text(`${def.name}\n${def.label}`, { fontFamily:'Arial,sans-serif', fontSize:12, fill:0xffffff, lineHeight:16 });
  lbl.x = 42; lbl.y = 9;
  btn.addChild(lbl);

  uiLayer.addChild(btn);
  shopBtns.push({ btn, type });
  drawShopBtn(btn, type, type === selectedType, false);
});

function drawShopBtn(btn, type, selected, hover) {
  const bg = btn.children[0];
  bg.clear();
  const canAfford = gold >= TDEFS[type].cost;
  bg.lineStyle(2, selected ? 0xffee44 : hover ? 0xaaaaaa : 0x334433, 0.9);
  bg.beginFill(selected ? 0x2a2a08 : hover ? 0x1a2a1a : 0x111118, 0.88);
  bg.drawRoundedRect(0, 0, 185, 60, 7);
  bg.endFill();
  if (!canAfford) { bg.beginFill(0x000000, 0.45); bg.drawRoundedRect(0,0,185,60,7); bg.endFill(); }
}

function refreshShop() {
  shopBtns.forEach(({ btn, type }) => drawShopBtn(btn, type, type === selectedType, false));
}

function updateHUD() {
  goldTxt.text  = `💰 ${gold}g`;
  livesTxt.text = `❤️  ${lives} lives`;
  waveTxt.text  = `Wave ${waveNum}`;
  waveBtn.visible = (phase === 'build');
  refreshShop();
}
updateHUD();

// ── Coin drop + float text ─────────────────────────────────────
class Coin {
  constructor(x, y, amount) {
    this.x = x; this.y = y;
    this.amount = amount;
    this.vy     = -160;
    this.life   = 1;
    this.collected = false;
    this.collectTimer = 1.8; // auto collect after this

    const g = new PIXI.Graphics();
    g.beginFill(0xffdd00); g.drawCircle(0, 0, 9); g.endFill();
    g.beginFill(0xffaa00); g.drawCircle(2, -2, 5); g.endFill();
    g.lineStyle(2, 0xcc8800); g.drawCircle(0,0,9);
    this.gfx = g;
    this.gfx.x = x; this.gfx.y = y;
    coinLayer.addChild(g);

    const lbl = new PIXI.Text(`+${amount}g`, { fontFamily:'Arial Black,Arial', fontSize:13, fill:0xffee44, stroke:0x000000, strokeThickness:3 });
    lbl.anchor.set(0.5); lbl.x = x; lbl.y = y - 20;
    this.lbl = lbl;
    fxLayer.addChild(lbl);

    // click to collect instantly
    g.interactive = true; g.buttonMode = true;
    g.on('pointerdown', () => this.collect());

    coins.push(this);
  }

  collect() {
    if (this.collected) return;
    this.collected = true;
    gold += this.amount;
    updateHUD();
    playCoin();
    spawnFloatText(`+${this.amount}g`, this.gfx.x, this.gfx.y, 0xffee44);
    this.gfx.destroy();
    this.lbl.destroy();
  }

  update(dt) {
    if (this.collected) return false;
    this.vy += 300 * dt;
    this.y  += this.vy * dt;
    if (this.y > PATH_Y + 20) { this.y = PATH_Y + 20; this.vy *= -0.3; }
    this.gfx.x = this.x; this.gfx.y = this.y;
    this.lbl.x = this.x; this.lbl.y = this.y - 18;
    this.lbl.alpha = Math.min(1, this.collectTimer / 0.6);
    this.collectTimer -= dt;
    if (this.collectTimer <= 0) { this.collect(); return false; }
    return true;
  }
}

// ── Float text ────────────────────────────────────────────────
function spawnFloatText(str, x, y, color = 0xffffff) {
  const t = new PIXI.Text(str, { fontFamily:'Arial Black,Arial', fontSize:18, fill:color, stroke:0x000000, strokeThickness:4 });
  t.anchor.set(0.5); t.x = x; t.y = y;
  fxLayer.addChild(t);
  let age = 0;
  const tick = () => {
    age += 0.04;
    t.y   -= 1.2;
    t.alpha = Math.max(0, 1 - age);
    if (age < 1) requestAnimationFrame(tick);
    else t.destroy();
  };
  tick();
}

// ── Particles ─────────────────────────────────────────────────
class Particle {
  constructor(x, y, color, big = false) {
    this.x = x; this.y = y;
    const sp = big ? 1.6 : 1;
    this.vx   = (Math.random() - 0.5) * 460 * sp;
    this.vy   = (-Math.random() * 360 - 50) * sp;
    this.life = 1;
    this.dec  = Math.random() * 0.022 + 0.014;
    this.sz   = Math.random() * 10 + 3;
    this.rot  = Math.random() * Math.PI * 2;
    this.rs   = (Math.random() - 0.5) * 0.24;
    this.sq   = Math.random() > 0.5;

    const g = new PIXI.Graphics();
    g.beginFill(color);
    this.sq ? g.drawRect(-this.sz/2,-this.sz/2,this.sz,this.sz) : g.drawCircle(0,0,this.sz/2);
    g.endFill();
    this.gfx = g; fxLayer.addChild(g);
    particles.push(this);
  }
  update(dt) {
    this.vy  += GRAVITY * 0.5 * dt;
    this.x   += this.vx * dt; this.y += this.vy * dt;
    this.rot += this.rs; this.life -= this.dec;
    this.gfx.x = this.x; this.gfx.y = this.y;
    this.gfx.rotation = this.rot;
    this.gfx.alpha = Math.max(this.life, 0);
    if (this.life <= 0) { this.gfx.destroy(); return false; }
    return true;
  }
}

function burst(x, y, color, count = 16, big = false) {
  for (let i = 0; i < count; i++) new Particle(x, y, color, big);
  for (let i = 0; i < (big?10:4); i++) new Particle(x, y, 0xffffff, big);
  const ring = new PIXI.Graphics();
  ring.lineStyle(big?4:2, 0xffffff, 1); ring.drawCircle(0,0,8);
  ring.x = x; ring.y = y; fxLayer.addChild(ring);
  let rf = 0, maxF = big ? 28 : 16;
  const go = () => { rf++; ring.scale.set(1 + rf * (big?0.2:0.13)); ring.alpha = 1 - rf/maxF;
    rf < maxF ? requestAnimationFrame(go) : ring.destroy(); };
  go();
  if (big) {
    const fl = new PIXI.Graphics();
    fl.beginFill(0xffffff, 0.22); fl.drawRect(0,0,W,H); fl.endFill();
    fxLayer.addChild(fl); let ff=0;
    const ff2 = () => { ff++; fl.alpha = 0.22*(1-ff/7); ff<7 ? requestAnimationFrame(ff2) : fl.destroy(); };
    ff2();
  }
}

// ── Enemy ─────────────────────────────────────────────────────
const ENEMY_DEFS = {
  grunt:   { hp:2, spd:68,  reward:12, color:0x44cc44, accentColor:0x88ff88, w:22, h:30, pts:80  },
  armored: { hp:5, spd:45,  reward:25, color:0x8888cc, accentColor:0xaaaaff, w:26, h:34, pts:200 },
  fast:    { hp:1, spd:120, reward:8,  color:0xffcc22, accentColor:0xffee88, w:18, h:26, pts:50  },
  boss:    { hp:20,spd:30,  reward:80, color:0xff4444, accentColor:0xff9999, w:38, h:50, pts:600 },
};

let totalScore = 0;
const scoreTxt = new PIXI.Text('Score: 0', { fontFamily:'Arial Black,Arial', fontSize:16, fill:0xffd700, dropShadow:true, dropShadowBlur:4, dropShadowColor:0x000000, dropShadowDistance:2 });
scoreTxt.x = W / 2 - 60; scoreTxt.y = 10;
uiLayer.addChild(scoreTxt);

class Enemy {
  constructor(type) {
    const d = ENEMY_DEFS[type];
    this.type   = type;
    this.x      = SPAWN_X;
    this.y      = PATH_Y + 10;
    this.hp     = d.hp; this.maxHp = d.hp;
    this.spd    = d.spd;
    this.reward = d.reward;
    this.color  = d.color;
    this.accent = d.accentColor;
    this.w = d.w; this.h = d.h;
    this.pts = d.pts;
    this.alive  = true;
    this.hitFlash = 0;
    this.walkCycle = 0;
    this.shakeX = 0; this.shakeY = 0;

    this.ctr  = new PIXI.Container();
    this.body = new PIXI.Graphics();
    this.ctr.addChild(this.body);
    this.ctr.x = this.x; this.ctr.y = this.y;
    enemyLayer.addChild(this.ctr);
    enemies.push(this);
    this._draw(false);
  }

  _draw(flash) {
    const g = this.body; g.clear();
    const c = flash ? 0xffffff : this.color;
    const ac = flash ? 0xffffff : this.accent;
    const hw = this.w / 2, hh = this.h;
    // shadow
    g.beginFill(0x000000, 0.2); g.drawEllipse(0, 2, hw + 2, 5); g.endFill();
    // body
    g.lineStyle(1.5, 0x000000, 0.4);
    g.beginFill(c); g.drawRoundedRect(-hw, -hh, this.w, this.h * 0.65, 4); g.endFill();
    // head
    g.beginFill(ac); g.drawCircle(0, -hh - 4, this.w * 0.38); g.endFill();
    // helmet
    g.beginFill(c); g.drawRoundedRect(-hw * 0.7, -hh - this.w * 0.38 - 4, this.w * 0.7 * 2, 8, 3); g.endFill();
    // eyes
    g.lineStyle(0); g.beginFill(0x110000); g.drawCircle(-4, -hh - 6, 2.5); g.drawCircle(4, -hh - 6, 2.5); g.endFill();
    // legs (walk cycle)
    const lsw = Math.sin(this.walkCycle) * 5;
    g.lineStyle(3.5, c, 1);
    g.moveTo(-5, -hh + this.h * 0.65); g.lineTo(-5 + lsw, -hh + this.h);
    g.moveTo(5,  -hh + this.h * 0.65); g.lineTo(5 - lsw,  -hh + this.h);
    // HP bar
    if (this.hp < this.maxHp) {
      g.lineStyle(0);
      g.beginFill(0x222222); g.drawRect(-hw, -hh - 16, this.w, 6); g.endFill();
      const r = this.hp / this.maxHp;
      g.beginFill(r > 0.6 ? 0x44dd44 : r > 0.3 ? 0xffaa00 : 0xff2200);
      g.drawRect(-hw, -hh - 16, this.w * r, 6); g.endFill();
    }
  }

  hit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 7;
    if (this.hp <= 0) { this._die(); return true; }
    this._draw(false);
    playHit(false);
    this.shakeX = (Math.random() - 0.5) * 18;
    this.shakeY = (Math.random() - 0.5) * 10;
    return false;
  }

  _die() {
    this.alive = false;
    burst(this.x, this.y - this.h * 0.5, this.color, 18, this.type === 'boss');
    playHit(true);
    new Coin(this.x, this.y - 20, this.reward);
    totalScore += this.pts;
    scoreTxt.text = `Score: ${totalScore}`;
    waveAlive = Math.max(0, waveAlive - 1);
    this.ctr.destroy();
  }

  update(dt) {
    if (!this.alive) return;
    this.x        -= this.spd * dt;
    this.walkCycle += this.spd * dt * 0.07;
    if (this.hitFlash > 0) { this.hitFlash--; this._draw(this.hitFlash % 2 === 0); }
    else this._draw(false);
    this.shakeX *= 0.7; this.shakeY *= 0.7;
    this.ctr.x = this.x + this.shakeX;
    this.ctr.y = this.y + this.shakeY;

    // reached base
    if (this.x < BASE_X + 20) {
      lives--;
      updateHUD();
      burst(BASE_X + 40, PATH_Y, 0xff2222, 10, false);
      spawnFloatText(`-1 ❤️`, BASE_X + 40, PATH_Y - 40, 0xff4444);
      this.alive = false;
      waveAlive = Math.max(0, waveAlive - 1);
      this.ctr.destroy();
      if (lives <= 0) triggerGameOver();
    }
  }
}

// ── Tower ─────────────────────────────────────────────────────
class Tower {
  constructor(slot, type) {
    this.slot    = slot;
    this.type    = type;
    this.def     = TDEFS[type];
    this.x       = slot.x;
    this.y       = slot.y;
    this.fireT   = 0;
    this.alive   = true;
    this.rangeGfx = null;

    slot.tower = this;
    towers.push(this);
    refreshSlot(slot);

    const ctr  = new PIXI.Container();
    ctr.x = slot.x; ctr.y = slot.y;
    const g = new PIXI.Graphics();
    this._buildGfx(g);
    ctr.addChild(g);
    this.ctr  = ctr;
    this.gun  = ctr.children[0]; // same as g for targeting angle
    towerLayer.addChild(ctr);

    // Range ring (shown briefly on place)
    this.showRange(1.5);
  }

  _buildGfx(g) {
    const d = this.def;
    g.clear();
    // base
    g.beginFill(0x222233); g.drawRoundedRect(-18, -36, 36, 36, 4); g.endFill();
    g.beginFill(d.color); g.drawRoundedRect(-14, -32, 28, 28, 3); g.endFill();
    // top accent
    g.beginFill(d.accent, 0.8); g.drawRoundedRect(-10, -32, 20, 10, 2); g.endFill();
    // barrel
    g.lineStyle(4, d.accent, 0.9);
    g.moveTo(0, -18); g.lineTo(22, -18); // points right initially
    g.lineStyle(0);
    // gem / emblem
    g.beginFill(0xffffff, 0.6); g.drawCircle(0, -20, 5); g.endFill();
    g.beginFill(d.accent); g.drawCircle(0, -20, 3); g.endFill();
  }

  showRange(duration) {
    if (this.rangeGfx) this.rangeGfx.destroy();
    const rg = new PIXI.Graphics();
    rg.lineStyle(2, this.def.accent, 0.45);
    rg.drawCircle(0, 0, this.def.range);
    rg.x = this.x; rg.y = this.y;
    fxLayer.addChild(rg);
    this.rangeGfx = rg;
    let t = 0;
    const fade = () => { t += 1/60; rg.alpha = Math.max(0, 1 - t/duration); t < duration ? requestAnimationFrame(fade) : rg.destroy(); };
    fade();
  }

  update(dt) {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    // Find nearest enemy in range
    let nearest = null, minDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < this.def.range && dist < minDist) { minDist = dist; nearest = e; }
    }
    if (!nearest) return;
    this.fireT = 1 / this.def.rate;
    // Aim barrel direction
    const ang = Math.atan2(nearest.y - this.y, nearest.x - this.x);
    this.ctr.rotation = ang; // rotate whole tower toward enemy
    // Fire projectile (straight, fast)
    new TowerProjectile(this.x, this.y, nearest, this.def);
  }
}

// ── Projectiles ───────────────────────────────────────────────
// Manual: ballistic arc (gravity)
class ManualProjectile {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.alive = true; this.age = 0;
    this.trail = [];

    this.ctr = new PIXI.Container();
    const glow = new PIXI.Graphics();
    glow.beginFill(0xff5500, 0.28); glow.drawCircle(0,0,28); glow.endFill();
    const core = new PIXI.Graphics();
    core.beginFill(0xff3311); core.drawCircle(0,0,14); core.endFill();
    core.beginFill(0xff8855); core.drawCircle(-4,-4,5); core.endFill();
    this.ctr.addChild(glow); this.ctr.addChild(core);
    this.core = core; this.glow = glow;
    this.trailCtr = new PIXI.Container();
    projLayer.addChildAt(this.trailCtr, 0);
    projLayer.addChild(this.ctr);
    projectiles.push(this);
  }

  update(dt) {
    this.vy  += GRAVITY * dt;
    this.x   += this.vx * dt; this.y += this.vy * dt;
    this.age += dt;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 16) this.trail.shift();
    this.trailCtr.removeChildren();
    this.trail.forEach((t, i) => {
      const tg = new PIXI.Graphics();
      tg.beginFill(0xff7700, (i / this.trail.length) * 0.45);
      tg.drawCircle(0, 0, (i / this.trail.length) * 9 + 1); tg.endFill();
      tg.x = t.x; tg.y = t.y; this.trailCtr.addChild(tg);
    });
    this.ctr.x = this.x; this.ctr.y = this.y;
    this.core.rotation += 0.18;
    this.glow.scale.set(0.85 + Math.sin(this.age * 12) * 0.15);
    return this._checkHit();
  }

  _checkHit() {
    if (this.y > H - SHOP_H + 10 || this.x < -50 || this.x > W + 100) { this._kill(false); return false; }
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = this.x - e.x, dy = this.y - (e.y - e.h / 2);
      if (Math.abs(dx) < e.w/2 + 14 && Math.abs(dy) < e.h/2 + 14) {
        const killed = e.hit(1);
        triggerShake(killed ? 20 : 8);
        burst(this.x, this.y, 0xff8800, killed ? 20 : 8, killed);
        this._kill(true); return false;
      }
    }
    return true;
  }

  _kill(hit) {
    this.alive = false;
    if (!hit) burst(this.x, this.y, 0x888888, 5);
    this.ctr.destroy(); this.trailCtr.destroy();
  }
}

// Tower auto-fire: straight line toward enemy position
class TowerProjectile {
  constructor(x, y, target, def) {
    const dx = target.x - x, dy = target.y - y;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    this.x = x; this.y = y;
    this.vx = (dx / dist) * def.spd;
    this.vy = (dy / dist) * def.spd;
    this.dmg = def.dmg;
    this.pc  = def.pc;
    this.alive = true;

    const g = new PIXI.Graphics();
    g.beginFill(def.pc); g.drawCircle(0,0, def === TDEFS.cannon ? 7 : 5); g.endFill();
    if (def === TDEFS.cannon) { g.lineStyle(2, 0xaaaacc); g.drawCircle(0,0,9); }
    this.gfx = g; g.x = x; g.y = y;
    projLayer.addChild(g);
    projectiles.push(this);
  }

  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.gfx.x = this.x; this.gfx.y = this.y;
    if (this.x < -30 || this.x > W+30 || this.y < -30 || this.y > H) { this._kill(); return false; }
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = this.x - e.x, dy = this.y - (e.y - e.h/2);
      if (Math.abs(dx) < e.w/2 + 8 && Math.abs(dy) < e.h/2 + 8) {
        const killed = e.hit(this.dmg);
        if (killed) { triggerShake(10); burst(this.x, this.y, e.color, 12, true); }
        else burst(this.x, this.y, this.pc, 4);
        this._kill(); return false;
      }
    }
    return true;
  }

  _kill() { this.alive = false; this.gfx.destroy(); }
}

// ── Wave system ───────────────────────────────────────────────
function buildWave(n) {
  const q = [];
  const base = 5 + n * 3;
  for (let i = 0; i < base; i++) {
    let type = 'grunt';
    if (n >= 2 && i % 4 === 1) type = 'armored';
    if (n >= 3 && i % 5 === 2) type = 'fast';
    if (n >= 4 && i === Math.floor(base / 2)) type = 'boss';
    q.push(type);
  }
  return q;
}

function startWave() {
  if (phase !== 'build' || gameOver) return;
  waveNum++;
  phase = 'wave';
  waveQueue = buildWave(waveNum);
  waveAlive = waveQueue.length;
  waveSpawnT = 0;
  updateHUD();
  spawnFloatText(`Wave ${waveNum}!`, W / 2, H / 2 - 80, 0xff8844);
}

function onSlotClick(slot) {
  if (slot.tower || gameOver) return;
  const def = TDEFS[selectedType];
  if (gold < def.cost) {
    spawnFloatText('Not enough gold!', slot.x, slot.y - 30, 0xff4444);
    return;
  }
  gold -= def.cost;
  updateHUD();
  new Tower(slot, selectedType);
  spawnFloatText(`-${def.cost}g`, slot.x, slot.y - 30, 0xffdd44);
}

// ── Aim ring + rubber band + trajectory ───────────────────────
const aimRing = new PIXI.Graphics();
aimRing.lineStyle(2, 0xffffff, 0.22); aimRing.drawCircle(SL_ANCHOR.x, SL_ANCHOR.y, MAX_PULL);
aimRing.visible = false;
aimLayer.addChild(aimRing);

const rubberBand = new PIXI.Graphics();
aimLayer.addChild(rubberBand);

const TDOT_N = 34;
const trajDots = [];
for (let i = 0; i < TDOT_N; i++) {
  const d = new PIXI.Graphics();
  d.beginFill(0xffffff, 0.82 - i * 0.022); d.drawCircle(0, 0, Math.max(5 - i * 0.1, 1.5)); d.endFill();
  d.visible = false; aimLayer.addChild(d); trajDots.push(d);
}

const pwrBg = new PIXI.Graphics();
pwrBg.beginFill(0x000000, 0.5); pwrBg.drawRoundedRect(0, 0, 100, 12, 6); pwrBg.endFill();
pwrBg.x = SL_ANCHOR.x - 50; pwrBg.y = SL_ANCHOR.y - 155; pwrBg.visible = false;
aimLayer.addChild(pwrBg);

const pwrFill = new PIXI.Graphics();
pwrFill.x = SL_ANCHOR.x - 48; pwrFill.y = SL_ANCHOR.y - 153; pwrFill.visible = false;
aimLayer.addChild(pwrFill);

function computeTraj(x, y, vx, vy, n, step) {
  const pts = []; let cx = x, cy = y, cvx = vx, cvy = vy;
  for (let i = 0; i < n; i++) {
    cvy += GRAVITY * step; cx += cvx * step; cy += cvy * step;
    pts.push({ x: cx, y: cy });
    if (cy > H - SHOP_H) break;
  }
  return pts;
}

// ── Input ─────────────────────────────────────────────────────
function s2g(cx, cy) {
  const r = app.view.getBoundingClientRect();
  return { x: (cx - r.left) * (W / r.width), y: (cy - r.top) * (H / r.height) };
}

function onDown(cx, cy) {
  if (gameOver) return;
  AC.resume();
  const p = s2g(cx, cy);
  const dx = p.x - SL_ANCHOR.x, dy = p.y - SL_ANCHOR.y;
  if (Math.sqrt(dx*dx + dy*dy) < 72) {
    isAiming = true; dragPos = p;
    timeScale = SLOW_SCALE;
    slowOverlay.style.opacity = '1';
    aimRing.visible = true; pwrBg.visible = true; pwrFill.visible = true;
    playAimTick(0);
  }
}
function onMove(cx, cy) { if (isAiming) dragPos = s2g(cx, cy); }
function onUp() {
  if (!isAiming) return;
  isAiming = false; timeScale = 1;
  slowOverlay.style.opacity = '0';
  aimRing.visible = false; pwrBg.visible = false; pwrFill.visible = false;
  rubberBand.clear(); trajDots.forEach(d => d.visible = false);
  if (!dragPos || shotCD > 0) { dragPos = null; return; }
  const dx = SL_ANCHOR.x - dragPos.x, dy = SL_ANCHOR.y - dragPos.y;
  let dist = Math.sqrt(dx*dx + dy*dy); if (dist < 8) { dragPos = null; return; }
  dist = Math.min(dist, MAX_PULL);
  const ang = Math.atan2(dy, dx);
  new ManualProjectile(SL_ANCHOR.x, SL_ANCHOR.y, Math.cos(ang)*LAUNCH_SPD*(dist/MAX_PULL), Math.sin(ang)*LAUNCH_SPD*(dist/MAX_PULL));
  shotCD = SHOT_CD;
  playLaunch(); triggerShake(4);
  dragPos = null; lastAimPow = -1;
}

app.view.addEventListener('mousedown',  e => onDown(e.clientX, e.clientY));
app.view.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
app.view.addEventListener('mouseup',    () => onUp());
app.view.addEventListener('mouseleave', () => { if (isAiming) onUp(); });
app.view.addEventListener('touchstart', e => { e.preventDefault(); onDown(e.touches[0].clientX, e.touches[0].clientY); }, { passive:false });
app.view.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive:false });
app.view.addEventListener('touchend',   e => { e.preventDefault(); onUp(); }, { passive:false });

// ── Screen shake ──────────────────────────────────────────────
function triggerShake(amt) { shakeAmt = Math.max(shakeAmt, amt); }

// ── Game over ─────────────────────────────────────────────────
let _goShown = false;
function triggerGameOver() {
  if (_goShown) return; _goShown = true;
  gameOver = true;
  showEndMsg('GAME OVER', 0xff3322);
}

// ── Main loop ─────────────────────────────────────────────────
let lastTs = 0;

app.ticker.add(() => {
  const now   = performance.now();
  const rawDt = Math.min((now - lastTs) / 1000, 0.05);
  lastTs      = now;
  const dt    = rawDt * timeScale;

  // screen shake
  if (shakeAmt > 0.3) {
    worldLayer.x = (Math.random()-0.5) * shakeAmt * 2;
    worldLayer.y = (Math.random()-0.5) * shakeAmt * 2;
    shakeAmt *= 0.8;
  } else { worldLayer.x = 0; worldLayer.y = 0; shakeAmt = 0; }

  shotCD = Math.max(0, shotCD - rawDt); // shot cooldown uses real time

  // Wave spawning
  if (phase === 'wave' && waveQueue.length > 0) {
    waveSpawnT -= rawDt;
    if (waveSpawnT <= 0) {
      new Enemy(waveQueue.shift());
      waveSpawnT = Math.max(0.5, 1.3 - waveNum * 0.06);
    }
  }

  // Wave end check
  if (phase === 'wave' && waveQueue.length === 0 && waveAlive <= 0 && enemies.length === 0 && !gameOver) {
    phase = 'build';
    const bonus = waveNum * 20;
    gold += bonus;
    updateHUD();
    spawnFloatText(`Wave ${waveNum} Clear!  +${bonus}g`, W/2, H/2 - 60, 0x44ff88);
  }

  // Update enemies
  for (let i = enemies.length-1; i >= 0; i--) {
    enemies[i].update(dt);
    if (!enemies[i].alive) enemies.splice(i, 1);
  }

  // Update towers
  towers.forEach(t => t.update(dt));

  // Update projectiles
  for (let i = projectiles.length-1; i >= 0; i--) {
    if (!projectiles[i].update(dt)) projectiles.splice(i, 1);
  }

  // Update particles
  for (let i = particles.length-1; i >= 0; i--) {
    if (!particles[i].update(dt)) particles.splice(i, 1);
  }

  // Update coins
  for (let i = coins.length-1; i >= 0; i--) {
    if (!coins[i].update(dt)) coins.splice(i, 1);
  }

  // Aiming visuals
  if (isAiming && dragPos) {
    const rdx = dragPos.x - SL_ANCHOR.x, rdy = dragPos.y - SL_ANCHOR.y;
    let rdist = Math.sqrt(rdx*rdx + rdy*rdy);
    let cx = dragPos.x, cy = dragPos.y;
    if (rdist > MAX_PULL) {
      cx = SL_ANCHOR.x + (rdx/rdist)*MAX_PULL; cy = SL_ANCHOR.y + (rdy/rdist)*MAX_PULL;
      rdist = MAX_PULL;
    }
    const pwr = rdist / MAX_PULL;
    if (Math.abs(pwr - lastAimPow) > 0.06) { playAimTick(pwr); lastAimPow = pwr; }

    // power bar
    pwrFill.clear();
    pwrFill.beginFill(pwr < 0.4 ? 0x44dd44 : pwr < 0.72 ? 0xffaa00 : 0xff2200);
    pwrFill.drawRoundedRect(0, 0, 96*pwr, 8, 4); pwrFill.endFill();

    // rubber band
    rubberBand.clear();
    rubberBand.lineStyle(4, 0xe8b840, 0.95);
    rubberBand.moveTo(SL_FORK_L.x, SL_FORK_L.y); rubberBand.lineTo(cx, cy);
    rubberBand.moveTo(SL_FORK_R.x, SL_FORK_R.y); rubberBand.lineTo(cx, cy);
    rubberBand.lineStyle(0);
    rubberBand.beginFill(0x000000, 0.2); rubberBand.drawCircle(cx+3, cy+4, 14); rubberBand.endFill();
    rubberBand.beginFill(0xff3311); rubberBand.drawCircle(cx, cy, 14); rubberBand.endFill();
    rubberBand.beginFill(0xff8855); rubberBand.drawCircle(cx-4, cy-4, 5); rubberBand.endFill();

    // trajectory arc
    const ldx = SL_ANCHOR.x - cx, ldy = SL_ANCHOR.y - cy;
    const ld  = Math.sqrt(ldx*ldx + ldy*ldy);
    const la  = Math.atan2(ldy, ldx);
    const spd = (ld / MAX_PULL) * LAUNCH_SPD;
    const pts = computeTraj(SL_ANCHOR.x, SL_ANCHOR.y, Math.cos(la)*spd, Math.sin(la)*spd, TDOT_N, 0.055);
    for (let i = 0; i < TDOT_N; i++) {
      if (i < pts.length) {
        trajDots[i].x = pts[i].x; trajDots[i].y = pts[i].y;
        trajDots[i].visible = true;
        trajDots[i].alpha   = (1 - i/pts.length) * 0.88;
        trajDots[i].scale.set(Math.max(1 - i*0.022, 0.12));
      } else { trajDots[i].visible = false; }
    }
    aimRing.visible = true;
    aimRing.alpha   = 0.18 + Math.sin(now * 0.006) * 0.12;
  } else {
    rubberBand.clear(); trajDots.forEach(d => d.visible = false);
  }
});

// ── End screen ────────────────────────────────────────────────
function showEndMsg(text, color) {
  const st = new PIXI.TextStyle({ fontFamily:'Arial Black,Arial', fontSize:82, fontWeight:'bold',
    fill:color, stroke:0x000000, strokeThickness:8, dropShadow:true, dropShadowBlur:16,
    dropShadowColor:0x000000, dropShadowDistance:5 });
  const msg = new PIXI.Text(text, st);
  msg.anchor.set(0.5); msg.x = W/2; msg.y = H/2; msg.alpha = 0; msg.scale.set(0.3);
  uiLayer.addChild(msg);
  const sub = new PIXI.Text(`Score: ${totalScore}  •  Wave ${waveNum}`,
    { fontFamily:'Arial,sans-serif', fontSize:26, fill:0xffffff, dropShadow:true, dropShadowBlur:6 });
  sub.anchor.set(0.5); sub.x = W/2; sub.y = H/2 + 68; sub.alpha = 0;
  uiLayer.addChild(sub);
  let t = 0;
  const anim = () => {
    t += 0.045; msg.alpha = Math.min(t*1.6,1); msg.scale.set(Math.min(0.3+t*0.75, 1.05));
    sub.alpha = Math.max(0, (t-0.35)*2.5);
    if (t < 1.2) { requestAnimationFrame(anim); return; }
    const r = new PIXI.Text('Click to Play Again', { fontFamily:'Arial,sans-serif', fontSize:22, fill:0xffffff });
    r.anchor.set(0.5); r.x = W/2; r.y = H/2 + 118; uiLayer.addChild(r);
    app.view.addEventListener('click', () => location.reload(), { once:true });
  };
  anim();
}
