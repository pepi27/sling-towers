// ============================================================
//  TOWER SIEGE  –  Angry Birds-style skill shot in Pixi.js
// ============================================================

const W = 1280, H = 720;
const GRAVITY = 900;          // px / s²
const SLING_X = 200, SLING_Y = 520;
const SLING_ANCHOR = { x: SLING_X, y: SLING_Y - 45 };
const MAX_PULL   = 85;        // px  max drag distance
const LAUNCH_SPD = 1150;      // px/s at full pull
const SLOW_SCALE = 0.12;      // time scale while aiming

// ── global state ──────────────────────────────────────────────
let score      = 0;
let shotsLeft  = 5;
let isAiming   = false;
let dragPos    = null;        // current mouse/touch position
let shakeAmt   = 0;
let timeScale  = 1;
let gameOver   = false;

const projectiles = [];
const enemies     = [];
const particles   = [];

// ── Audio (Web Audio API synth, no asset files needed) ────────
const AC = new (window.AudioContext || window.webkitAudioContext)();

function playLaunch() {
  const osc  = AC.createOscillator();
  const gain = AC.createGain();
  osc.connect(gain); gain.connect(AC.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(380, AC.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, AC.currentTime + 0.35);
  gain.gain.setValueAtTime(0.4, AC.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.35);
  osc.start(); osc.stop(AC.currentTime + 0.35);
}

function playHit(big) {
  // noise burst
  const len    = big ? 0.35 : 0.18;
  const buf    = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src    = AC.createBufferSource();
  src.buffer   = buf;
  const filter = AC.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.value = big ? 600 : 300;
  const gain   = AC.createGain();
  gain.gain.setValueAtTime(big ? 1.0 : 0.5, AC.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
  src.connect(filter); filter.connect(gain); gain.connect(AC.destination);
  src.start(); src.stop(AC.currentTime + len);

  if (big) {
    // low BOOM underneath
    const osc  = AC.createOscillator();
    const g2   = AC.createGain();
    osc.connect(g2); g2.connect(AC.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, AC.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, AC.currentTime + 0.4);
    g2.gain.setValueAtTime(0.6, AC.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.4);
    osc.start(); osc.stop(AC.currentTime + 0.4);
  }
}

function playAimTick(power) {
  const osc  = AC.createOscillator();
  const gain = AC.createGain();
  osc.connect(gain); gain.connect(AC.destination);
  osc.frequency.value = 180 + power * 600;
  gain.gain.setValueAtTime(0.08, AC.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.06);
  osc.start(); osc.stop(AC.currentTime + 0.06);
}

// ── Pixi setup ────────────────────────────────────────────────
const app = new PIXI.Application({
  width: W, height: H,
  backgroundColor: 0x0d0020,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});

const container = document.getElementById('game-container');
container.appendChild(app.view);
app.view.style.display = 'block';

const slowOverlay = document.getElementById('slow-overlay');

// Layer order
const worldLayer     = new PIXI.Container(); // shaken on impact
const bgLayer        = new PIXI.Container();
const enemyLayer     = new PIXI.Container();
const projLayer      = new PIXI.Container();
const fxLayer        = new PIXI.Container();
const aimLayer       = new PIXI.Container();
const uiLayer        = new PIXI.Container();

app.stage.addChild(worldLayer);
worldLayer.addChild(bgLayer);
worldLayer.addChild(enemyLayer);
worldLayer.addChild(projLayer);
worldLayer.addChild(fxLayer);
worldLayer.addChild(aimLayer);
app.stage.addChild(uiLayer);

// ── Background ────────────────────────────────────────────────
(function buildBackground() {
  const sky = new PIXI.Graphics();
  sky.beginFill(0x0d0020); sky.drawRect(0, 0, W, H); sky.endFill();
  // horizon glow
  sky.beginFill(0x1a0050, 0.6);
  sky.drawEllipse(W / 2, H - 60, W * 0.8, 200);
  sky.endFill();
  bgLayer.addChild(sky);

  // stars
  for (let i = 0; i < 160; i++) {
    const g   = new PIXI.Graphics();
    const r   = Math.random() * 1.4 + 0.3;
    const a   = Math.random() * 0.7 + 0.3;
    g.beginFill(0xffffff, a);
    g.drawCircle(0, 0, r);
    g.endFill();
    g.x = Math.random() * W;
    g.y = Math.random() * (H * 0.72);
    bgLayer.addChild(g);
  }

  // distant mountains
  const mtn = new PIXI.Graphics();
  mtn.beginFill(0x1a1035);
  for (let i = 0; i < 6; i++) {
    const mx = 150 + i * 200;
    const mh = 80 + Math.random() * 130;
    mtn.moveTo(mx - 100, H - 60);
    mtn.lineTo(mx, H - 60 - mh);
    mtn.lineTo(mx + 100, H - 60);
  }
  mtn.endFill();
  bgLayer.addChild(mtn);

  // ground
  const ground = new PIXI.Graphics();
  ground.beginFill(0x1e3a10); ground.drawRect(0, H - 60, W, 60); ground.endFill();
  ground.beginFill(0x2d5518); ground.drawRect(0, H - 60, W, 10);  ground.endFill();
  bgLayer.addChild(ground);
})();

// ── Slingshot ─────────────────────────────────────────────────
(function buildSlingshot() {
  const g = new PIXI.Graphics();
  // pole
  g.lineStyle(14, 0x5a2d0c, 1);
  g.moveTo(SLING_X, H - 60);
  g.lineTo(SLING_X, SLING_Y - 20);
  // fork left
  g.lineStyle(10, 0x6b3515, 1);
  g.moveTo(SLING_X, SLING_Y - 20);
  g.lineTo(SLING_X - 22, SLING_Y - 65);
  // fork right
  g.moveTo(SLING_X, SLING_Y - 20);
  g.lineTo(SLING_X + 22, SLING_Y - 65);
  // knobs
  g.lineStyle(0);
  g.beginFill(0x8b4513); g.drawCircle(SLING_X - 22, SLING_Y - 65, 6); g.endFill();
  g.beginFill(0x8b4513); g.drawCircle(SLING_X + 22, SLING_Y - 65, 6); g.endFill();
  aimLayer.addChild(g);
})();

// ── Rubber band (redrawn in loop) ─────────────────────────────
const rubberBand = new PIXI.Graphics();
aimLayer.addChild(rubberBand);

// ── Trajectory dots ───────────────────────────────────────────
const TRAJ_COUNT = 32;
const trajDots   = [];
for (let i = 0; i < TRAJ_COUNT; i++) {
  const d = new PIXI.Graphics();
  const sz = 5 - i * 0.1;
  d.beginFill(0xffffff, 0.85 - i * 0.025);
  d.drawCircle(0, 0, Math.max(sz, 1.5));
  d.endFill();
  d.visible = false;
  aimLayer.addChild(d);
  trajDots.push(d);
}

// ── Aim circle ────────────────────────────────────────────────
const aimRing = new PIXI.Graphics();
aimRing.lineStyle(2, 0xffffff, 0.25);
aimRing.drawCircle(SLING_ANCHOR.x, SLING_ANCHOR.y, MAX_PULL);
aimRing.visible = false;
aimLayer.addChild(aimRing);

// ── Power bar ─────────────────────────────────────────────────
const powerBarBg = new PIXI.Graphics();
powerBarBg.beginFill(0x000000, 0.55);
powerBarBg.drawRoundedRect(0, 0, 100, 12, 6);
powerBarBg.endFill();
powerBarBg.x = SLING_X - 50;
powerBarBg.y = SLING_Y - 155;
powerBarBg.visible = false;
aimLayer.addChild(powerBarBg);

const powerBarFill = new PIXI.Graphics();
powerBarFill.x = SLING_X - 48;
powerBarFill.y = SLING_Y - 153;
powerBarFill.visible = false;
aimLayer.addChild(powerBarFill);

// ── Particle ──────────────────────────────────────────────────
class Particle {
  constructor(x, y, color, speedMult = 1) {
    this.x  = x; this.y  = y;
    this.vx = (Math.random() - 0.5) * 460 * speedMult;
    this.vy = (-Math.random() * 380 - 60) * speedMult;
    this.life    = 1;
    this.decay   = Math.random() * 0.022 + 0.014;
    this.size    = Math.random() * 11 + 3;
    this.rot     = Math.random() * Math.PI * 2;
    this.rotSpd  = (Math.random() - 0.5) * 0.25;
    this.square  = Math.random() > 0.45;
    this.color   = color;

    this.gfx = new PIXI.Graphics();
    this.gfx.beginFill(color);
    if (this.square) {
      this.gfx.drawRect(-this.size / 2, -this.size / 2, this.size, this.size);
    } else {
      this.gfx.drawCircle(0, 0, this.size / 2);
    }
    this.gfx.endFill();
    fxLayer.addChild(this.gfx);
    particles.push(this);
  }

  update(dt) {
    this.vy   += GRAVITY * 0.55 * dt;
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.rot  += this.rotSpd;
    this.life -= this.decay;
    this.gfx.x        = this.x;
    this.gfx.y        = this.y;
    this.gfx.rotation = this.rot;
    this.gfx.alpha    = Math.max(this.life, 0);
    if (this.life <= 0) { this.gfx.destroy(); return false; }
    return true;
  }
}

function burst(x, y, color, count = 18, big = false) {
  for (let i = 0; i < count; i++) new Particle(x, y, color, big ? 1.5 : 1);
  const sparks = big ? 12 : 5;
  for (let i = 0; i < sparks; i++) new Particle(x, y, 0xffffff, big ? 1.8 : 1.2);

  // shockwave ring
  const ring = new PIXI.Graphics();
  ring.lineStyle(big ? 4 : 2, 0xffffff, 1);
  ring.drawCircle(0, 0, 8);
  ring.x = x; ring.y = y;
  fxLayer.addChild(ring);
  let rf = 0;
  const maxF = big ? 28 : 18;
  const expandRing = () => {
    rf++;
    ring.scale.set(1 + rf * (big ? 0.18 : 0.12));
    ring.alpha = 1 - rf / maxF;
    if (rf < maxF) requestAnimationFrame(expandRing);
    else ring.destroy();
  };
  expandRing();

  // screen flash
  if (big) {
    const flash = new PIXI.Graphics();
    flash.beginFill(0xffffff, 0.25);
    flash.drawRect(0, 0, W, H);
    flash.endFill();
    fxLayer.addChild(flash);
    let ff = 0;
    const fadeFlash = () => {
      ff++;
      flash.alpha = 0.25 * (1 - ff / 8);
      if (ff < 8) requestAnimationFrame(fadeFlash);
      else flash.destroy();
    };
    fadeFlash();
  }
}

// ── Enemy block ───────────────────────────────────────────────
class EnemyBlock {
  constructor(x, y, w, h, color, hp) {
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.hp = hp; this.maxHp = hp;
    this.color = color;
    this.alive = true;
    this.hitFlash = 0;
    this.localShakeX = 0;
    this.localShakeY = 0;

    this.ctr  = new PIXI.Container();
    this.body = new PIXI.Graphics();
    this.ctr.addChild(this.body);
    this.ctr.x = x;
    this.ctr.y = y;
    enemyLayer.addChild(this.ctr);
    enemies.push(this);
    this._draw(false);
  }

  _draw(flash) {
    const g = this.body;
    g.clear();
    const c = flash ? 0xffffff : this.color;
    // shadow
    g.beginFill(0x000000, 0.25);
    g.drawRoundedRect(-this.w / 2 + 3, -this.h + 4, this.w, this.h, 4);
    g.endFill();
    // body
    g.lineStyle(2, 0x000000, 0.35);
    g.beginFill(c);
    g.drawRoundedRect(-this.w / 2, -this.h, this.w, this.h, 4);
    g.endFill();
    // highlight
    g.beginFill(0xffffff, 0.18);
    g.drawRoundedRect(-this.w / 2 + 3, -this.h + 3, this.w - 6, this.h * 0.35, 3);
    g.endFill();
    // cracks
    const dmgRatio = 1 - this.hp / this.maxHp;
    if (dmgRatio > 0.3) {
      g.lineStyle(1.5, 0x000000, 0.55);
      g.moveTo(-this.w / 4, -this.h * 0.25);
      g.lineTo(this.w / 3, -this.h * 0.75);
    }
    if (dmgRatio > 0.65) {
      g.lineStyle(2, 0x000000, 0.75);
      g.moveTo(this.w / 5, -this.h * 0.15);
      g.lineTo(-this.w / 3, -this.h * 0.85);
      g.moveTo(-this.w / 6, -this.h * 0.5);
      g.lineTo(this.w / 4, -this.h * 0.55);
    }
    // HP bar
    if (this.hp < this.maxHp) {
      g.lineStyle(0);
      g.beginFill(0x222222);
      g.drawRect(-this.w / 2, -this.h - 9, this.w, 6);
      g.endFill();
      const ratio = this.hp / this.maxHp;
      const barColor = ratio > 0.6 ? 0x44dd44 : ratio > 0.3 ? 0xffaa00 : 0xff3300;
      g.beginFill(barColor);
      g.drawRect(-this.w / 2, -this.h - 9, this.w * ratio, 6);
      g.endFill();
    }
  }

  hit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 8;
    if (this.hp <= 0) { this._destroy(); return true; }
    this._draw(false);
    playHit(false);
    this.localShakeX = (Math.random() - 0.5) * 22;
    this.localShakeY = (Math.random() - 0.5) * 14;
    return false;
  }

  _destroy() {
    this.alive = false;
    burst(this.x, this.y - this.h * 0.5, this.color, 22, true);
    playHit(true);
    score += Math.ceil(this.maxHp) * 100;
    document.getElementById('score').textContent = `Score: ${score}`;
    this.ctr.destroy();
  }

  update(dt) {
    if (this.hitFlash > 0) {
      this.hitFlash--;
      this._draw(this.hitFlash % 2 === 0);
    }
    this.localShakeX *= 0.75;
    this.localShakeY *= 0.75;
    this.ctr.x = this.x + this.localShakeX;
    this.ctr.y = this.y + this.localShakeY;
  }
}

// ── Projectile ────────────────────────────────────────────────
class Projectile {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.alive = true;
    this.age   = 0;
    this.trail = [];

    this.ctr   = new PIXI.Container();
    this.trailCtr = new PIXI.Container();

    // glow
    this.glow = new PIXI.Graphics();
    this.glow.beginFill(0xff5500, 0.28);
    this.glow.drawCircle(0, 0, 28); this.glow.endFill();
    this.ctr.addChild(this.glow);

    // core
    this.core = new PIXI.Graphics();
    this.core.beginFill(0xff3311);
    this.core.drawCircle(0, 0, 14); this.core.endFill();
    this.core.beginFill(0xff8855);
    this.core.drawCircle(-4, -4, 5); this.core.endFill();
    this.ctr.addChild(this.core);

    projLayer.addChildAt(this.trailCtr, 0);
    projLayer.addChild(this.ctr);
    projectiles.push(this);
  }

  update(dt) {
    this.vy  += GRAVITY * dt;
    this.x   += this.vx * dt;
    this.y   += this.vy * dt;
    this.age += dt;

    // trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 18) this.trail.shift();
    this.trailCtr.removeChildren();
    for (let i = 0; i < this.trail.length; i++) {
      const t  = this.trail[i];
      const a  = (i / this.trail.length) * 0.5;
      const sz = (i / this.trail.length) * 10 + 1;
      const tg = new PIXI.Graphics();
      tg.beginFill(0xff7700, a);
      tg.drawCircle(0, 0, sz); tg.endFill();
      tg.x = t.x; tg.y = t.y;
      this.trailCtr.addChild(tg);
    }

    this.ctr.x = this.x;
    this.ctr.y = this.y;
    this.core.rotation += 0.18;
    this.glow.scale.set(0.85 + Math.sin(this.age * 12) * 0.15);

    // ground
    if (this.y > H - 58) {
      burst(this.x, H - 60, 0x888888, 8, false);
      this._kill(); return;
    }
    if (this.x > W + 120 || this.x < -120) { this._kill(); return; }

    // hit enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = this.x - e.x;
      const dy = this.y - (e.y - e.h / 2);
      if (Math.abs(dx) < e.w / 2 + 15 && Math.abs(dy) < e.h / 2 + 15) {
        const killed = e.hit(1);
        triggerShake(killed ? 18 : 7);
        this._kill(); return;
      }
    }
  }

  _kill() {
    this.alive = false;
    this.ctr.destroy();
    this.trailCtr.destroy();
  }
}

// ── Screen shake ─────────────────────────────────────────────
function triggerShake(amt) { shakeAmount = amt; }
let shakeAmount = 0;

// ── Level builder ─────────────────────────────────────────────
function buildLevel() {
  // Tower A — wooden stacked column
  new EnemyBlock(760, H - 60,  52, 75, 0x8B4513, 2);
  new EnemyBlock(760, H - 135, 52, 75, 0xa0522d, 2);
  new EnemyBlock(760, H - 210, 52, 55, 0xcd853f, 1);

  // Tower B — stone arch
  new EnemyBlock(920, H - 60,  60, 80, 0x607080, 3);
  new EnemyBlock(980, H - 60,  60, 80, 0x607080, 3);
  new EnemyBlock(950, H - 140, 80, 60, 0x708090, 2);
  new EnemyBlock(950, H - 200, 55, 60, 0x8090a0, 1);

  // Tower C — tall enemy tower
  new EnemyBlock(1130, H - 60,  45, 220, 0x2a6030, 4);
  new EnemyBlock(1130, H - 280, 65,  60, 0xff2222, 3);

  // Tower D — fat fortification
  new EnemyBlock(1230, H - 60, 80, 90, 0x4a3070, 3);
  new EnemyBlock(1230, H - 150, 60, 90, 0x5a3d8a, 2);
}
buildLevel();

// ── Trajectory math ───────────────────────────────────────────
function trajectoryPoints(x, y, vx, vy, steps, step_dt) {
  const pts = [];
  let cx = x, cy = y, cvx = vx, cvy = vy;
  for (let i = 0; i < steps; i++) {
    cvy += GRAVITY * step_dt;
    cx  += cvx * step_dt;
    cy  += cvy * step_dt;
    pts.push({ x: cx, y: cy });
    if (cy > H - 60) break;
  }
  return pts;
}

// ── Input ─────────────────────────────────────────────────────
let lastAimPower = -1;

function screenToGame(clientX, clientY) {
  const rect = app.view.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (W / rect.width),
    y: (clientY - rect.top)  * (H / rect.height),
  };
}

function onDown(clientX, clientY) {
  if (gameOver || shotsLeft <= 0) return;
  AC.resume();
  const p   = screenToGame(clientX, clientY);
  const dx  = p.x - SLING_ANCHOR.x;
  const dy  = p.y - SLING_ANCHOR.y;
  if (Math.sqrt(dx * dx + dy * dy) < 68) {
    isAiming  = true;
    dragPos   = p;
    timeScale = SLOW_SCALE;
    slowOverlay.style.opacity = '1';
    aimRing.visible      = true;
    powerBarBg.visible   = true;
    powerBarFill.visible = true;
    playAimTick(0);
  }
}

function onMove(clientX, clientY) {
  if (!isAiming) return;
  dragPos = screenToGame(clientX, clientY);
}

function onUp() {
  if (!isAiming) return;
  isAiming  = false;
  timeScale = 1;
  slowOverlay.style.opacity = '0';
  aimRing.visible      = false;
  powerBarBg.visible   = false;
  powerBarFill.visible = false;
  rubberBand.clear();
  trajDots.forEach(d => d.visible = false);

  if (!dragPos) return;
  const dx   = SLING_ANCHOR.x - dragPos.x;
  const dy   = SLING_ANCHOR.y - dragPos.y;
  let dist   = Math.sqrt(dx * dx + dy * dy);
  if (dist < 8) { dragPos = null; return; }
  dist       = Math.min(dist, MAX_PULL);
  const pwr  = dist / MAX_PULL;
  const spd  = pwr * LAUNCH_SPD;
  const ang  = Math.atan2(dy, dx);

  new Projectile(SLING_ANCHOR.x, SLING_ANCHOR.y, Math.cos(ang) * spd, Math.sin(ang) * spd);
  shotsLeft--;
  document.getElementById('shots').textContent = `Shots: ${shotsLeft}`;
  playLaunch();
  triggerShake(4);
  dragPos = null;
  lastAimPower = -1;
}

app.view.addEventListener('mousedown',  e => onDown(e.clientX, e.clientY));
app.view.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
app.view.addEventListener('mouseup',    ()  => onUp());
app.view.addEventListener('mouseleave', ()  => onUp());

app.view.addEventListener('touchstart', e => { e.preventDefault(); onDown(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
app.view.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
app.view.addEventListener('touchend',   e => { e.preventDefault(); onUp(); }, { passive: false });

// ── Main loop ─────────────────────────────────────────────────
let lastTs  = 0;
let msgShown = false;

app.ticker.add(() => {
  const now   = performance.now();
  const rawDt = Math.min((now - lastTs) / 1000, 0.05);
  lastTs      = now;
  const dt    = rawDt * timeScale;

  // screen shake
  if (shakeAmount > 0.3) {
    worldLayer.x = (Math.random() - 0.5) * shakeAmount * 2;
    worldLayer.y = (Math.random() - 0.5) * shakeAmount * 2;
    shakeAmount *= 0.82;
  } else {
    worldLayer.x = 0;
    worldLayer.y = 0;
    shakeAmount  = 0;
  }

  // update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    projectiles[i].update(dt);
    if (!projectiles[i].alive) projectiles.splice(i, 1);
  }

  // update enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (!enemies[i].alive) enemies.splice(i, 1);
    else enemies[i].update(dt);
  }

  // update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update(dt)) particles.splice(i, 1);
  }

  // aiming visuals
  if (isAiming && dragPos) {
    // clamp drag
    const rawDx  = dragPos.x - SLING_ANCHOR.x;
    const rawDy  = dragPos.y - SLING_ANCHOR.y;
    let rawDist  = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
    let clampX   = dragPos.x;
    let clampY   = dragPos.y;
    if (rawDist > MAX_PULL) {
      clampX = SLING_ANCHOR.x + (rawDx / rawDist) * MAX_PULL;
      clampY = SLING_ANCHOR.y + (rawDy / rawDist) * MAX_PULL;
      rawDist = MAX_PULL;
    }
    const power = rawDist / MAX_PULL;

    // aim tick sound (only on significant power change)
    if (Math.abs(power - lastAimPower) > 0.06) {
      playAimTick(power);
      lastAimPower = power;
    }

    // power bar color
    const barColor = power < 0.4 ? 0x44dd44 : power < 0.72 ? 0xffaa00 : 0xff2200;
    powerBarFill.clear();
    powerBarFill.beginFill(barColor);
    powerBarFill.drawRoundedRect(0, 0, 96 * power, 8, 4);
    powerBarFill.endFill();

    // rubber band
    rubberBand.clear();
    // left fork to ball
    rubberBand.lineStyle(3.5, 0xe8b84b, 0.95);
    rubberBand.moveTo(SLING_X - 22, SLING_Y - 65);
    rubberBand.lineTo(clampX, clampY);
    // right fork to ball
    rubberBand.lineStyle(3.5, 0xe8b84b, 0.95);
    rubberBand.moveTo(SLING_X + 22, SLING_Y - 65);
    rubberBand.lineTo(clampX, clampY);
    // ball shadow
    rubberBand.lineStyle(0);
    rubberBand.beginFill(0x000000, 0.2);
    rubberBand.drawCircle(clampX + 3, clampY + 4, 14); rubberBand.endFill();
    // ball
    rubberBand.beginFill(0xff3311);
    rubberBand.drawCircle(clampX, clampY, 14); rubberBand.endFill();
    rubberBand.beginFill(0xff8855);
    rubberBand.drawCircle(clampX - 4, clampY - 4, 5); rubberBand.endFill();

    // trajectory
    const ldx   = SLING_ANCHOR.x - clampX;
    const ldy   = SLING_ANCHOR.y - clampY;
    const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
    const lspd  = (ldist / MAX_PULL) * LAUNCH_SPD;
    const lang  = Math.atan2(ldy, ldx);
    const pts   = trajectoryPoints(
      SLING_ANCHOR.x, SLING_ANCHOR.y,
      Math.cos(lang) * lspd,
      Math.sin(lang) * lspd,
      TRAJ_COUNT, 0.055
    );

    for (let i = 0; i < TRAJ_COUNT; i++) {
      if (i < pts.length) {
        trajDots[i].x       = pts[i].x;
        trajDots[i].y       = pts[i].y;
        trajDots[i].visible = true;
        trajDots[i].alpha   = (1 - i / pts.length) * 0.85;
        const sc = 1 - i * 0.02;
        trajDots[i].scale.set(Math.max(sc, 0.15));
      } else {
        trajDots[i].visible = false;
      }
    }

    // pulsing aim ring
    aimRing.visible = true;
    aimRing.alpha   = 0.18 + Math.sin(now * 0.006) * 0.12;
  } else {
    rubberBand.clear();
    trajDots.forEach(d => d.visible = false);
  }

  // win / lose
  if (!msgShown && !gameOver) {
    const allDead  = enemies.length === 0;
    const noShots  = shotsLeft <= 0 && projectiles.length === 0 && !isAiming;
    if (allDead) {
      gameOver = true; msgShown = true;
      showEndMessage('YOU WIN!', 0x44ff88);
    } else if (noShots) {
      gameOver = true; msgShown = true;
      showEndMessage('GAME OVER', 0xff3322);
    }
  }
});

// ── End screen ────────────────────────────────────────────────
function showEndMessage(text, color) {
  const style = new PIXI.TextStyle({
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: 80,
    fontWeight: 'bold',
    fill: color,
    stroke: 0x000000,
    strokeThickness: 7,
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowBlur: 14,
    dropShadowDistance: 5,
  });
  const msg = new PIXI.Text(text, style);
  msg.anchor.set(0.5);
  msg.x = W / 2; msg.y = H / 2;
  msg.alpha = 0; msg.scale.set(0.4);
  uiLayer.addChild(msg);

  // score sub-text
  const subStyle = new PIXI.TextStyle({
    fontFamily: 'Arial, sans-serif',
    fontSize: 28,
    fill: 0xffffff,
    dropShadow: true,
    dropShadowBlur: 6,
  });
  const sub = new PIXI.Text(`Score: ${score}`, subStyle);
  sub.anchor.set(0.5);
  sub.x = W / 2; sub.y = H / 2 + 65;
  sub.alpha = 0;
  uiLayer.addChild(sub);

  let t = 0;
  const anim = () => {
    t += 0.04;
    msg.alpha  = Math.min(t * 1.5, 1);
    msg.scale.set(0.4 + t * 0.65 > 1.05 ? 1.05 : 0.4 + t * 0.65);
    sub.alpha  = Math.max(0, t - 0.4) * 2;
    if (t < 1.2) requestAnimationFrame(anim);
    else {
      const restart = new PIXI.Text('Click to Play Again', new PIXI.TextStyle({
        fontFamily: 'Arial, sans-serif', fontSize: 22, fill: 0xffffff, alpha: 0.7,
      }));
      restart.anchor.set(0.5);
      restart.x = W / 2; restart.y = H / 2 + 115;
      uiLayer.addChild(restart);
      app.view.addEventListener('click', () => location.reload(), { once: true });
    }
  };
  anim();
}
