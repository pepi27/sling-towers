// ============================================================
//  TOWER SIEGE — Tower Defense + Skill Shot  (Pixi.js v7)
// ============================================================
const W = 720,
    H = 1280;
const GRAVITY = 820;
const SHOP_H = 145;

const ZOOM = 1.0; // no extra zoom needed in portrait
const WL_CX = W / 2; // worldLayer pivot x
const WL_CY = (H - SHOP_H) / 2; // worldLayer pivot y (centre of play area)

// Curved enemy path — control points for Catmull-Rom spline (portrait: top→bottom)
const PATH_CTRL = [
    { x: 360, y: -30 }, // enter top-center
    { x: 130, y: 220 }, // curve left
    { x: 560, y: 430 }, // curve right
    { x: 150, y: 650 }, // curve left
    { x: 570, y: 870 }, // curve right
    { x: 240, y: 1050 }, // curve left
    { x: 360, y: 1110 }, // arrive at base (bottom-center)
];
// Generate dense smooth path from Catmull-Rom control points
function buildPathPts(ctrl, segs) {
    const out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
        const p0 = ctrl[Math.max(0, i - 1)];
        const p1 = ctrl[i];
        const p2 = ctrl[i + 1];
        const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
        for (let s = 0; s < segs; s++) {
            const t = s / segs,
                t2 = t * t,
                t3 = t2 * t;
            out.push({
                x:
                    0.5 *
                    (2 * p1.x +
                        (-p0.x + p2.x) * t +
                        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                y:
                    0.5 *
                    (2 * p1.y +
                        (-p0.y + p2.y) * t +
                        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            });
        }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
}
const PATH_PTS = buildPathPts(PATH_CTRL, 20); // ~120 smooth points
const PATH_WIDTH = 54; // visual half-width of road
const MIN_TOWER_PATH_DIST = 80; // can't place this close to path center
const MIN_TOWER_TOWER_DIST = 65; // can't place this close to another tower

// ── Type constants ─────────────────────────────────────────────
const TOWER = { ARCHER: 'archer', CANNON: 'cannon', RAPID: 'rapid', ICE: 'ice', FIRE: 'fire' };
const ENEMY = {
    GRUNT: 'grunt',
    ARMORED: 'armored',
    FAST: 'fast',
    ICE: 'ice',
    FIRE: 'fire',
    BOSS: 'boss',
};
const STATUS = { SLOW: 'slow', BURN: 'burn' };
const PHASE = { BUILD: 'build', WAVE: 'wave' };

// Main slingshot (left side)
const SL_ANCHOR = { x: 180, y: 700 };
const SL_FORK_L = { x: 158, y: 658 };
const SL_FORK_R = { x: 202, y: 658 };
const MAX_PULL = 420;
const LAUNCH_SPD = 1100;

// Direct aim direction — no distortion, 1:1 pull-to-angle mapping (Angry Birds feel).
// Sensitivity is controlled purely by MAX_PULL: larger = need bigger drag for same angle.
function compressAimDir(rawFdx, rawFdy) {
    return { x: rawFdx, y: rawFdy };
}
const SLOW_SCALE = 0.11;
const SL_SHOT_CD = 0.45; // slingshot recharge

// Tower types — each requires a manual skill shot, with its own recharge
const TDEFS = {
    [TOWER.ARCHER]: {
        name: 'Archer',
        cost: 60,
        color: 0x3a8c3a,
        accent: 0x66ff66,
        dmg: 1,
        spd: 980,
        pColor: 0x88ff44,
        pSize: 12,
        recharge: 1.8,
        aoe: 0,
        status: null,
        label: '60g · 1dmg · 1.8s',
    },
    [TOWER.CANNON]: {
        name: 'Cannon',
        cost: 130,
        color: 0x556677,
        accent: 0x99bbcc,
        dmg: 4,
        spd: 780,
        pColor: 0x334455,
        pSize: 18,
        recharge: 3.0,
        aoe: 55,
        status: null,
        label: '130g · 4dmg · AoE · 3s',
    },
    [TOWER.RAPID]: {
        name: 'Rapid',
        cost: 90,
        color: 0x224499,
        accent: 0x6699ff,
        dmg: 0.5,
        spd: 1200,
        pColor: 0x66aaff,
        pSize: 8,
        recharge: 0.6,
        aoe: 0,
        status: null,
        label: '90g · 0.5dmg · 0.6s',
    },
    [TOWER.ICE]: {
        name: 'Ice',
        cost: 100,
        color: 0x1188bb,
        accent: 0x88eeff,
        dmg: 0.5,
        spd: 820,
        pColor: 0x66ddff,
        pSize: 13,
        recharge: 2.5,
        aoe: 80,
        status: { type: STATUS.SLOW, duration: 2.5, factor: 0.35 },
        label: '100g · Slows · AoE · 2.5s',
    },
    [TOWER.FIRE]: {
        name: 'Fire',
        cost: 110,
        color: 0xcc3300,
        accent: 0xff8833,
        dmg: 1,
        spd: 880,
        pColor: 0xff5500,
        pSize: 14,
        recharge: 2.0,
        aoe: 55,
        status: { type: STATUS.BURN, duration: 3.5, dps: 1.5 },
        label: '110g · Burns · AoE · 2s',
    },
};

// Upgrade tiers per tower type (applied on top of current def)
const UPGRADE_DEFS = {
    [TOWER.ARCHER]: [
        { cost: 45, dmg: 2, recharge: 1.3, pSize: 14, label: 'Lv2: +dmg +speed' },
        { cost: 85, dmg: 3.5, recharge: 0.9, pSize: 16, label: 'Lv3: +dmg max speed' },
        { cost: 130, dmg: 5.5, recharge: 0.65, pSize: 18, label: 'Lv4: sniper shot' },
        { cost: 200, dmg: 8, recharge: 0.45, pSize: 20, label: 'Lv5: eagle eye' },
    ],
    [TOWER.CANNON]: [
        { cost: 100, dmg: 7, aoe: 75, recharge: 2.6, label: 'Lv2: +dmg +blast' },
        { cost: 170, dmg: 12, aoe: 100, recharge: 2.0, label: 'Lv3: mega blast' },
        { cost: 240, dmg: 18, aoe: 130, recharge: 1.6, label: 'Lv4: heavy shell' },
        { cost: 350, dmg: 28, aoe: 165, recharge: 1.2, label: 'Lv5: devastator' },
    ],
    [TOWER.RAPID]: [
        { cost: 55, dmg: 0.8, recharge: 0.45, pSize: 9, label: 'Lv2: +dmg faster' },
        { cost: 100, dmg: 1.3, recharge: 0.28, pSize: 10, label: 'Lv3: bullet storm' },
        { cost: 160, dmg: 2.0, recharge: 0.18, pSize: 11, label: 'Lv4: gatling' },
        { cost: 240, dmg: 3.0, recharge: 0.1, pSize: 12, label: 'Lv5: minigun' },
    ],
    [TOWER.ICE]: [
        {
            cost: 65,
            dmg: 0.8,
            aoe: 100,
            status: { type: STATUS.SLOW, duration: 3.5, factor: 0.25 },
            label: 'Lv2: bigger freeze',
        },
        {
            cost: 115,
            dmg: 1.2,
            aoe: 130,
            status: { type: STATUS.SLOW, duration: 5.0, factor: 0.12 },
            label: 'Lv3: deep freeze',
        },
        {
            cost: 180,
            dmg: 2.0,
            aoe: 160,
            status: { type: STATUS.SLOW, duration: 6.5, factor: 0.08 },
            label: 'Lv4: permafrost',
        },
        {
            cost: 270,
            dmg: 3.0,
            aoe: 200,
            status: { type: STATUS.SLOW, duration: 8.0, factor: 0.04 },
            label: 'Lv5: absolute zero',
        },
    ],
    [TOWER.FIRE]: [
        {
            cost: 70,
            dmg: 1.5,
            aoe: 70,
            status: { type: STATUS.BURN, duration: 4.5, dps: 2.5 },
            label: 'Lv2: hotter burn',
        },
        {
            cost: 125,
            dmg: 2.5,
            aoe: 90,
            status: { type: STATUS.BURN, duration: 6.0, dps: 4.5 },
            label: 'Lv3: inferno',
        },
        {
            cost: 190,
            dmg: 4.0,
            aoe: 115,
            status: { type: STATUS.BURN, duration: 7.0, dps: 7.0 },
            label: 'Lv4: wildfire',
        },
        {
            cost: 280,
            dmg: 6.0,
            aoe: 145,
            status: { type: STATUS.BURN, duration: 8.5, dps: 11.0 },
            label: 'Lv5: supernova',
        },
    ],
};
const MAX_TOWER_LEVEL = 5;

// ── State ─────────────────────────────────────────────────────
let gold = 150,
    lives = 20,
    waveNum = 0;
let phase = PHASE.BUILD;
let gameOver = false;
let selectedType = TOWER.ARCHER;

// Aiming — activeShooter: null=slingshot, Tower instance=that tower
let activeShooter = null;
let isAiming = false,
    dragPos = null;
let isDragging = false; // true while dragging a tower from the shop
let timeScale = 1,
    shakeAmt = 0,
    slShotCD = 0;
let lastAimPow = -1;

let waveQueue = [],
    waveSpawnT = 0,
    waveAlive = 0;

const enemies = [],
    projectiles = [],
    particles = [],
    coins = [],
    towers = [];

// ── Audio ─────────────────────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();
const _sfx = (fn) => {
    try {
        fn();
    } catch (e) {}
};

function playLaunch(big) {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = big ? 'square' : 'sawtooth';
        o.frequency.setValueAtTime(big ? 220 : 360, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(big ? 40 : 75, AC.currentTime + 0.35);
        g.gain.setValueAtTime(big ? 0.55 : 0.4, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.35);
        o.start();
        o.stop(AC.currentTime + 0.35);
    });
}

function playHit(big) {
    _sfx(() => {
        const len = big ? 0.34 : 0.17;
        const buf = AC.createBuffer(1, ~~(AC.sampleRate * len), AC.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = AC.createBufferSource();
        src.buffer = buf;
        const flt = AC.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = big ? 550 : 260;
        const g = AC.createGain();
        g.gain.setValueAtTime(big ? 0.9 : 0.45, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
        src.connect(flt);
        flt.connect(g);
        g.connect(AC.destination);
        src.start();
        src.stop(AC.currentTime + len);
        if (big) {
            const o2 = AC.createOscillator(),
                g2 = AC.createGain();
            o2.connect(g2);
            g2.connect(AC.destination);
            o2.type = 'sine';
            o2.frequency.setValueAtTime(85, AC.currentTime);
            o2.frequency.exponentialRampToValueAtTime(22, AC.currentTime + 0.4);
            g2.gain.setValueAtTime(0.55, AC.currentTime);
            g2.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.4);
            o2.start();
            o2.stop(AC.currentTime + 0.4);
        }
    });
}

function playCoin() {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(960, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(1350, AC.currentTime + 0.09);
        g.gain.setValueAtTime(0.13, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.14);
        o.start();
        o.stop(AC.currentTime + 0.14);
    });
}

function playAimTick(p) {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.frequency.value = 190 + p * 560;
        g.gain.setValueAtTime(0.07, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.06);
        o.start();
        o.stop(AC.currentTime + 0.06);
    });
}

function playTowerReady() {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(440, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(880, AC.currentTime + 0.12);
        g.gain.setValueAtTime(0.1, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.18);
        o.start();
        o.stop(AC.currentTime + 0.18);
    });
}

// ── Pixi init ─────────────────────────────────────────────────
const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundColor: 0x060e04,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
});
document.getElementById('game-container').appendChild(app.view);
app.view.style.display = 'block';
const slowOverlay = document.getElementById('slow-overlay');

// Layers
const worldLayer = new PIXI.Container();
const bgLayer = new PIXI.Container();
const terrainLayer = new PIXI.Container(); // path, trees, fort — zooms with worldLayer
const slotLayer = new PIXI.Container();
const towerLayer = new PIXI.Container();
const enemyLayer = new PIXI.Container();
const coinLayer = new PIXI.Container();
const projLayer = new PIXI.Container();
const fxLayer = new PIXI.Container();
const aimLayer = new PIXI.Container();
const uiLayer = new PIXI.Container();

// bgLayer holds only solid background — un-zoomed, no edge gaps
app.stage.addChild(bgLayer);
app.stage.addChild(worldLayer);
[terrainLayer, slotLayer, towerLayer, enemyLayer, coinLayer, projLayer, fxLayer, aimLayer].forEach(
    (l) => worldLayer.addChild(l),
);
app.stage.addChild(uiLayer);

// Zoom: scale worldLayer around the centre of the play area
worldLayer.pivot.set(WL_CX, WL_CY);
worldLayer.position.set(WL_CX, WL_CY);
worldLayer.scale.set(ZOOM);

// Use Pixi event system on stage (so coins/towers can stopPropagation)
app.stage.eventMode = 'static';
app.stage.hitArea = new PIXI.Rectangle(0, 0, W, H);

// ── Background ────────────────────────────────────────────────
(function drawBG() {
    // ── Solid background in bgLayer (un-zoomed, fills canvas) ──
    const g = new PIXI.Graphics();
    g.beginFill(0x0a1406);
    g.drawRect(0, 0, W, H);
    g.endFill();
    g.beginFill(0x1a4a0e);
    g.drawRect(0, 0, W, H - SHOP_H);
    g.endFill();
    for (let i = 0; i < 50; i++) {
        g.beginFill(0x155a0a, 0.4 + Math.random() * 0.3);
        g.drawEllipse(
            Math.random() * W,
            Math.random() * (H - SHOP_H),
            40 + Math.random() * 60,
            20 + Math.random() * 30,
        );
        g.endFill();
    }
    g.beginFill(0x08080f);
    g.drawRect(0, H - SHOP_H, W, SHOP_H);
    g.endFill();
    g.lineStyle(1, 0x333355, 0.8);
    g.moveTo(0, H - SHOP_H);
    g.lineTo(W, H - SHOP_H);
    bgLayer.addChild(g);

    // ── Path, trees, fort in terrainLayer (zooms with worldLayer) ──

    // Dirt path
    const drawPathLine = (width, color, alpha) => {
        const pg = new PIXI.Graphics();
        pg.lineStyle({ width, color, alpha, join: 'round', cap: 'round' });
        pg.moveTo(PATH_PTS[0].x, PATH_PTS[0].y);
        for (let i = 1; i < PATH_PTS.length; i++) pg.lineTo(PATH_PTS[i].x, PATH_PTS[i].y);
        terrainLayer.addChild(pg);
    };
    drawPathLine(60, 0x3a2008, 0.5);
    drawPathLine(48, 0x8a6420, 1.0);
    drawPathLine(18, 0xaa7e2a, 0.45);

    // Scattered trees — skip any too close to the path
    const treeXY = [
        [50, 70],
        [660, 80],
        [45, 280],
        [665, 310],
        [50, 490],
        [660, 530],
        [48, 710],
        [660, 740],
        [50, 930],
        [650, 900],
        [52, 1080],
        [645, 1050],
        [110, 160],
        [600, 190],
        [115, 590],
        [595, 620],
        [105, 820],
        [590, 790],
        [180, 380],
        [530, 400],
        [200, 980],
        [510, 960],
    ];
    treeXY.forEach(([tx, ty]) => {
        if (distToPath(tx, ty) < 100) return; // don't place on path
        const t = new PIXI.Graphics();
        t.beginFill(0x0a1a06, 0.5);
        t.drawCircle(4, 5, 22);
        t.endFill();
        t.beginFill(0x1e5010);
        t.drawCircle(0, 0, 20);
        t.endFill();
        t.beginFill(0x2a7018);
        t.drawCircle(-4, -4, 13);
        t.endFill();
        t.beginFill(0x3a8020);
        t.drawCircle(3, -6, 8);
        t.endFill();
        t.x = tx;
        t.y = ty;
        terrainLayer.addChild(t);
    });

    // Base fort at path end
    const ep = PATH_CTRL[PATH_CTRL.length - 1];
    const fort = new PIXI.Graphics();
    fort.beginFill(0x222233);
    fort.drawCircle(ep.x, ep.y, 42);
    fort.endFill();
    fort.lineStyle(4, 0x5566aa, 0.9);
    fort.drawCircle(ep.x, ep.y, 42);
    fort.beginFill(0x3a3a55);
    fort.drawCircle(ep.x, ep.y, 30);
    fort.endFill();
    fort.beginFill(0xee2222, 0.9);
    fort.drawCircle(ep.x, ep.y, 8);
    fort.endFill();
    for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        fort.beginFill(0x4a4a66);
        fort.drawCircle(ep.x + Math.cos(ang) * 42, ep.y + Math.sin(ang) * 42, 7);
        fort.endFill();
    }
    terrainLayer.addChild(fort);
})();

// ── Placement ghost preview ────────────────────────────────────
const ghostGfx = new PIXI.Graphics();
slotLayer.addChild(ghostGfx);
let ghostPos = null; // world coords of current hover position

// Drag icon — tower sprite that follows the pointer during shop drag (screen space)
const dragIcon = new PIXI.Graphics();
dragIcon.visible = false;
dragIcon.alpha = 0.55;
uiLayer.addChild(dragIcon);

function updateDragIcon(type, sx, sy) {
    dragIcon.clear();
    drawTowerIcon(dragIcon, TDEFS[type], type);
    dragIcon.x = sx;
    dragIcon.y = sy;
    dragIcon.visible = true;
}

function updateGhost(wx, wy) {
    ghostGfx.clear();
    if (isAiming || gameOver || !isDragging) {
        ghostPos = null;
        return;
    }
    ghostPos = { x: wx, y: wy };
    const valid = canPlaceTower(wx, wy);
    const canAfford = gold >= TDEFS[selectedType].cost;
    const ok = valid && canAfford;
    // Only show validity ring, no fill — drag icon already shows the tower
    ghostGfx.lineStyle(3, ok ? 0x88ff44 : 0xff3322, 0.9);
    ghostGfx.drawCircle(wx, wy, 30);
    if (!valid) {
        ghostGfx.lineStyle(2.5, 0xff3322, 0.9);
        ghostGfx.moveTo(wx - 14, wy - 14);
        ghostGfx.lineTo(wx + 14, wy + 14);
        ghostGfx.moveTo(wx + 14, wy - 14);
        ghostGfx.lineTo(wx - 14, wy + 14);
    }
}

// ── HUD ───────────────────────────────────────────────────────
const hudStyle = {
    fontFamily: 'Arial Black,Arial',
    fontSize: 18,
    fill: 0xffffff,
    dropShadow: true,
    dropShadowBlur: 6,
    dropShadowColor: 0x000000,
    dropShadowDistance: 2,
};
const goldTxt = new PIXI.Text('', hudStyle);
const livesTxt = new PIXI.Text('', hudStyle);
const waveTxt = new PIXI.Text('', hudStyle);
goldTxt.x = 14;
goldTxt.y = 10;
livesTxt.x = 14;
livesTxt.y = 36;
waveTxt.x = W / 2;
waveTxt.y = 10;
uiLayer.addChild(goldTxt, livesTxt, waveTxt);

// Hint label (below slingshot)
const hintTxt = new PIXI.Text('Click a READY tower to aim & fire', {
    fontFamily: 'Arial,sans-serif',
    fontSize: 12,
    fill: 0x888888,
});
hintTxt.x = 10;
hintTxt.y = H - SHOP_H - 20;
uiLayer.addChild(hintTxt);

const waveBtn = new PIXI.Container();
const waveBtnBg = new PIXI.Graphics();
waveBtn.addChild(waveBtnBg);
const waveBtnTxt = new PIXI.Text('▶ Send Wave', {
    fontFamily: 'Arial Black,Arial',
    fontSize: 16,
    fill: 0xffffff,
});
waveBtnTxt.anchor.set(0.5);
waveBtnTxt.x = 0;
waveBtnTxt.y = 0;
waveBtn.addChild(waveBtnTxt);
waveBtn.x = W - 100;
waveBtn.y = 24;
waveBtn.eventMode = 'static';
waveBtn.cursor = 'pointer';
waveBtn.on('pointerdown', (e) => {
    e.stopPropagation();
    startWave();
});
waveBtn.on('pointerover', () => drawWaveBtn(true));
waveBtn.on('pointerout', () => drawWaveBtn(false));
uiLayer.addChild(waveBtn);

function drawWaveBtn(hover) {
    waveBtnBg.clear();
    waveBtnBg.lineStyle(2, 0x66ff44, 0.9);
    waveBtnBg.beginFill(hover ? 0x338833 : 0x1a4a1a, 0.92);
    waveBtnBg.drawRoundedRect(-90, -18, 180, 36, 8);
    waveBtnBg.endFill();
}
drawWaveBtn(false);

// Draw tower icon identical to in-game look — centered at (0,0), barrel pointing up
function drawTowerIcon(g, def, type) {
    // Shadow
    g.beginFill(0x000000, 0.28);
    g.drawEllipse(5, 6, 26, 14);
    g.endFill();
    // Outer base plate
    g.lineStyle(3, 0x334455, 0.55);
    g.beginFill(0x1a1a2e);
    g.drawCircle(0, 0, 24);
    g.endFill();
    // Colored body
    g.lineStyle(1.5, def.accent, 0.6);
    g.beginFill(def.color);
    g.drawCircle(0, 0, 19);
    g.endFill();
    // Accent inner ring
    g.lineStyle(2, def.accent, 0.75);
    g.drawCircle(0, 0, 10);
    g.lineStyle(0);
    // Centre emblem
    g.beginFill(0xffffff, 0.5);
    g.drawCircle(0, 0, 5);
    g.endFill();
    g.beginFill(def.accent);
    g.drawCircle(0, 0, 3);
    g.endFill();
    // Barrel pointing up
    const isCannon = type === TOWER.CANNON;
    const bLen = isCannon ? 30 : 24;
    g.lineStyle(isCannon ? 8 : 5, def.accent, 0.95);
    g.moveTo(0, 0);
    g.lineTo(0, -bLen);
    g.lineStyle(0);
    g.beginFill(def.accent, 0.8);
    g.drawCircle(0, -bLen, isCannon ? 5 : 3);
    g.endFill();
}

const SHOP_TYPES = Object.keys(TDEFS);
const shopBtns = [];
// Portrait 2-row shop: row1=[Archer,Cannon,Rapid] row2=[Ice,Fire]
SHOP_TYPES.forEach((type, i) => {
    const def = TDEFS[type];
    const btn = new PIXI.Container();
    const row = i < 3 ? 0 : 1;
    const col = i < 3 ? i : i - 3;
    const rowX0 = i < 3 ? 18 : 134; // row2 centered: (720-2*220-12)/2=134
    btn.x = rowX0 + col * 232;
    btn.y = H - SHOP_H + 10 + row * 68;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointerdown', (e) => {
        e.stopPropagation();
        if (gameOver) return;
        selectedType = type;
        isDragging = true;
        updateDragIcon(type, e.global.x, e.global.y);
        refreshShop();
    });
    btn.on('pointerover', () => {
        if (selectedType !== type) drawShopBtn(btn, type, false, true);
    });
    btn.on('pointerout', () => drawShopBtn(btn, type, selectedType === type, false));
    const bg = new PIXI.Graphics();
    btn.addChild(bg);
    const icon = new PIXI.Graphics();
    drawTowerIcon(icon, def, type);
    icon.scale.set(0.6); // 24px radius * 0.6 = ~29px diameter fits in 60px button
    icon.x = 20; // center of ~40px icon area (24*0.6 = ~14px radius → center at 14+6=20)
    icon.y = 36; // vertical center of 60px button + barrel offset
    btn.addChild(icon);
    const lbl = new PIXI.Text(`${def.name}\n${def.label}`, {
        fontFamily: 'Arial,sans-serif',
        fontSize: 11,
        fill: 0xffffff,
        lineHeight: 15,
    });
    lbl.x = 38;
    lbl.y = 9;
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
    bg.drawRoundedRect(0, 0, 220, 60, 7);
    bg.endFill();
    if (!canAfford) {
        bg.beginFill(0x000000, 0.45);
        bg.drawRoundedRect(0, 0, 220, 60, 7);
        bg.endFill();
    }
}
function refreshShop() {
    shopBtns.forEach(({ btn, type }) => drawShopBtn(btn, type, type === selectedType, false));
}

function updateHUD() {
    goldTxt.text = `💰 ${gold}g`;
    livesTxt.text = `❤️  ${lives}`;
    waveTxt.text = `Wave ${waveNum}`;
    waveBtn.visible = phase === PHASE.BUILD;
    refreshShop();
    towers.forEach((t) => t._buildUpgradeBtn());
}
updateHUD();

// ── Float text ────────────────────────────────────────────────
function spawnFloatText(str, x, y, color = 0xffffff) {
    const t = new PIXI.Text(str, {
        fontFamily: 'Arial Black,Arial',
        fontSize: 18,
        fill: color,
        stroke: 0x000000,
        strokeThickness: 4,
    });
    t.anchor.set(0.5);
    t.x = x;
    t.y = y;
    fxLayer.addChild(t);
    let age = 0;
    const tick = () => {
        age += 0.04;
        t.y -= 1.2;
        t.alpha = Math.max(0, 1 - age);
        age < 1 ? requestAnimationFrame(tick) : t.destroy();
    };
    tick();
}

// ── Coin — click only to pick up ──────────────────────────────
let _coinId = 0;
class Coin {
    constructor(x, y, amount) {
        this.x = x;
        this.baseY = y - 5;
        this.y = y;
        this.amount = amount;
        this.vy = -180;
        this.settled = false;
        this.collected = false;
        this.age = 0;
        this.id = _coinId++;

        // Glow (behind coin)
        const glow = new PIXI.Graphics();
        glow.beginFill(0xffdd00, 0.35);
        glow.drawCircle(0, 0, 18);
        glow.endFill();
        this.glowGfx = glow;
        coinLayer.addChild(glow);

        // Coin body
        const g = new PIXI.Graphics();
        g.beginFill(0xffdd00);
        g.drawCircle(0, 0, 9);
        g.endFill();
        g.beginFill(0xffbb00);
        g.drawCircle(1, -1, 5);
        g.endFill();
        g.lineStyle(2, 0xcc8800);
        g.drawCircle(0, 0, 9);
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.hitArea = new PIXI.Circle(0, 0, 22);
        g.on('pointerdown', (e) => {
            e.stopPropagation();
            this.collect();
        });
        this.gfx = g;
        coinLayer.addChild(g);

        // "+Ng" label
        const lbl = new PIXI.Text(`+${amount}g`, {
            fontFamily: 'Arial Black,Arial',
            fontSize: 13,
            fill: 0xffee44,
            stroke: 0x000000,
            strokeThickness: 3,
        });
        lbl.anchor.set(0.5);
        lbl.x = x;
        lbl.y = y - 22;
        this.lbl = lbl;
        fxLayer.addChild(lbl);

        coins.push(this);
    }

    collect() {
        if (this.collected) return;
        this.collected = true;
        gold += this.amount;
        updateHUD();
        playCoin();
        spawnFloatText(`+${this.amount}g`, this.x, this.y - 10, 0xffee44);
        this.gfx.destroy();
        this.glowGfx.destroy();
        this.lbl.destroy();
    }

    update(dt) {
        if (this.collected) return false;
        this.age += dt;

        if (!this.settled) {
            this.vy += 400 * dt;
            this.y += this.vy * dt;
            if (this.y >= this.baseY) {
                this.y = this.baseY;
                this.vy *= -0.3;
                if (Math.abs(this.vy) < 20) this.settled = true;
            }
        } else {
            // Bob up and down, pulsing glow to attract player
            this.y = this.baseY + Math.sin(this.age * 3.5 + this.id * 1.2) * 5;
        }

        this.gfx.x = this.x;
        this.gfx.y = this.y;
        this.glowGfx.x = this.x;
        this.glowGfx.y = this.y;
        this.lbl.x = this.x;
        this.lbl.y = this.y - 20;

        // Pulsing glow
        const p = 0.3 + Math.sin(this.age * 4 + this.id) * 0.25;
        this.glowGfx.alpha = p;
        // Label fades after first second
        this.lbl.alpha = Math.max(0, 1 - (this.age - 0.5) * 0.8);

        return true; // stays until clicked
    }
}

// ── Particles ─────────────────────────────────────────────────
class Particle {
    constructor(x, y, color, big = false) {
        this.x = x;
        this.y = y;
        const sp = big ? 1.6 : 1;
        this.vx = (Math.random() - 0.5) * 460 * sp;
        this.vy = (-Math.random() * 360 - 50) * sp;
        this.life = 1;
        this.dec = Math.random() * 0.022 + 0.014;
        this.sz = Math.random() * 10 + 3;
        this.rot = Math.random() * Math.PI * 2;
        this.rs = (Math.random() - 0.5) * 0.24;
        this.sq = Math.random() > 0.5;
        const g = new PIXI.Graphics();
        g.beginFill(color);
        this.sq
            ? g.drawRect(-this.sz / 2, -this.sz / 2, this.sz, this.sz)
            : g.drawCircle(0, 0, this.sz / 2);
        g.endFill();
        this.gfx = g;
        fxLayer.addChild(g);
        particles.push(this);
    }
    update(dt) {
        this.vy += GRAVITY * 0.5 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.rot += this.rs;
        this.life -= this.dec;
        this.gfx.x = this.x;
        this.gfx.y = this.y;
        this.gfx.rotation = this.rot;
        this.gfx.alpha = Math.max(this.life, 0);
        if (this.life <= 0) {
            this.gfx.destroy();
            return false;
        }
        return true;
    }
}

function burst(x, y, color, count = 16, big = false) {
    for (let i = 0; i < count; i++) new Particle(x, y, color, big);
    for (let i = 0; i < (big ? 10 : 4); i++) new Particle(x, y, 0xffffff, big);
    const ring = new PIXI.Graphics();
    ring.lineStyle(big ? 4 : 2, 0xffffff, 1);
    ring.drawCircle(0, 0, 8);
    ring.x = x;
    ring.y = y;
    fxLayer.addChild(ring);
    let rf = 0,
        maxF = big ? 28 : 16;
    const go = () => {
        rf++;
        ring.scale.set(1 + rf * (big ? 0.2 : 0.13));
        ring.alpha = 1 - rf / maxF;
        rf < maxF ? requestAnimationFrame(go) : ring.destroy();
    };
    go();
    if (big) {
        const fl = new PIXI.Graphics();
        fl.beginFill(0xffffff, 0.22);
        fl.drawRect(0, 0, W, H);
        fl.endFill();
        fxLayer.addChild(fl);
        let ff = 0;
        const ff2 = () => {
            ff++;
            fl.alpha = 0.22 * (1 - ff / 7);
            ff < 7 ? requestAnimationFrame(ff2) : fl.destroy();
        };
        ff2();
    }
}

// ── Enemy ─────────────────────────────────────────────────────
const ENEMY_DEFS = {
    [ENEMY.GRUNT]: {
        hp: 2,
        spd: 68,
        reward: 12,
        color: 0x44cc44,
        accentColor: 0x88ff88,
        w: 22,
        h: 30,
        pts: 80,
    },
    [ENEMY.ARMORED]: {
        hp: 5,
        spd: 45,
        reward: 25,
        color: 0x8888cc,
        accentColor: 0xaaaaff,
        w: 26,
        h: 34,
        pts: 200,
    },
    [ENEMY.FAST]: {
        hp: 1,
        spd: 120,
        reward: 8,
        color: 0xccff22,
        accentColor: 0xffee88,
        w: 18,
        h: 26,
        pts: 50,
    },
    [ENEMY.ICE]: {
        hp: 4,
        spd: 55,
        reward: 22,
        color: 0x55ddff,
        accentColor: 0xaaffff,
        w: 24,
        h: 32,
        pts: 160,
        immunity: STATUS.SLOW,
        weakness: STATUS.BURN,
    },
    [ENEMY.FIRE]: {
        hp: 3,
        spd: 85,
        reward: 20,
        color: 0xff5500,
        accentColor: 0xffaa00,
        w: 22,
        h: 30,
        pts: 140,
        immunity: STATUS.BURN,
        weakness: STATUS.SLOW,
    },
    [ENEMY.BOSS]: {
        hp: 20,
        spd: 30,
        reward: 80,
        color: 0xff4444,
        accentColor: 0xff9999,
        w: 38,
        h: 50,
        pts: 600,
    },
};
let totalScore = 0;
const scoreTxt = new PIXI.Text('Score: 0', {
    fontFamily: 'Arial Black,Arial',
    fontSize: 16,
    fill: 0xffd700,
    dropShadow: true,
    dropShadowBlur: 4,
    dropShadowColor: 0x000000,
    dropShadowDistance: 2,
});
scoreTxt.x = 14;
scoreTxt.y = 62;
uiLayer.addChild(scoreTxt);

class Enemy {
    constructor(type) {
        const d = ENEMY_DEFS[type];
        this.type = type;
        this.x = PATH_PTS[0].x;
        this.y = PATH_PTS[0].y;
        this.wpIdx = 0; // current path waypoint index
        this.dirX = 0;
        this.dirY = 1; // initial direction: moving down
        // HP scales up every 2 waves: +8% per wave pair (e.g. wave 4 = +16%)
        const hpMult = 1 + Math.floor(waveNum / 2) * 0.08;
        this.hp = d.hp * hpMult;
        this.maxHp = this.hp;
        this.spd = d.spd;
        this.reward = d.reward;
        this.color = d.color;
        this.accent = d.accentColor;
        this.w = d.w;
        this.h = d.h;
        this.pts = d.pts;
        this.immunity = d.immunity || null; // status type this enemy ignores
        this.weakness = d.weakness || null; // status type that deals 2× damage
        this.alive = true;
        this.hitFlash = 0;
        this.walkCycle = 0;
        this.shakeX = 0;
        this.shakeY = 0;
        // Status effects
        this.slowTimer = 0;
        this.slowFactor = 1;
        this.burnTimer = 0;
        this.burnDps = 0;
        this.burnParticleT = 0;

        this.ctr = new PIXI.Container();
        this.body = new PIXI.Graphics();
        this.statusGfx = new PIXI.Graphics(); // status overlay (ice / fire tint)
        this.ctr.addChild(this.body);
        this.ctr.addChild(this.statusGfx);
        this.ctr.x = this.x;
        this.ctr.y = this.y;
        enemyLayer.addChild(this.ctr);
        enemies.push(this);
        this._draw(false);
    }

    applyStatus(status) {
        if (!status) return;
        if (status.type === this.immunity) {
            spawnFloatText('Immune!', this.x, this.y - this.h - 10, 0xaaaaff);
            return;
        }
        const isWeak = status.type === this.weakness;
        if (status.type === STATUS.SLOW) {
            this.slowTimer = status.duration * (isWeak ? 1.8 : 1);
            this.slowFactor = isWeak ? status.factor * 0.4 : status.factor; // weaker = more slowed
            this._drawStatus();
        } else if (status.type === STATUS.BURN) {
            this.burnTimer = status.duration * (isWeak ? 1.8 : 1);
            this.burnDps = status.dps * (isWeak ? 2.5 : 1);
            this._drawStatus();
        }
    }

    _drawStatus() {
        const g = this.statusGfx;
        g.clear();
        const hw = this.w / 2,
            hh = this.h;
        if (this.slowTimer > 0) {
            // Ice blue overlay
            g.beginFill(0x88eeff, 0.28);
            g.drawRoundedRect(-hw, -hh, this.w, this.h * 0.65, 4);
            g.endFill();
            // Snowflake lines
            g.lineStyle(1.5, 0xaaeeff, 0.9);
            const cx = 0,
                cy = -hh * 0.5;
            for (let a = 0; a < 3; a++) {
                const ang = (a / 3) * Math.PI;
                g.moveTo(cx + Math.cos(ang) * 7, cy + Math.sin(ang) * 7);
                g.lineTo(cx - Math.cos(ang) * 7, cy - Math.sin(ang) * 7);
            }
            g.lineStyle(0);
        }
        if (this.burnTimer > 0) {
            // Fire orange overlay
            g.beginFill(0xff4400, 0.22);
            g.drawRoundedRect(-hw, -hh, this.w, this.h * 0.65, 4);
            g.endFill();
        }
    }
    _draw(flash) {
        const g = this.body;
        g.clear();
        const c = flash ? 0xffffff : this.color;
        const ac = flash ? 0xffffff : this.accent;
        const r = this.w / 2;
        // Shadow
        g.beginFill(0x000000, 0.3);
        g.drawEllipse(r * 0.3, r * 0.3, r * 1.1, r * 0.7);
        g.endFill();
        // Body circle
        g.lineStyle(2, 0x000000, 0.4);
        g.beginFill(c);
        g.drawCircle(0, 0, r);
        g.endFill();
        // Inner accent ring
        g.lineStyle(1.5, ac, 0.7);
        g.drawCircle(0, 0, r * 0.55);
        // Direction indicator (arrow pointing movement direction)
        g.lineStyle(0);
        g.beginFill(ac, 0.9);
        const ax = this.dirX * r * 0.75,
            ay = this.dirY * r * 0.75;
        const perp = { x: -this.dirY * r * 0.3, y: this.dirX * r * 0.3 };
        g.drawPolygon([ax, ay, -perp.x, -perp.y, perp.x, perp.y]);
        g.endFill();
        // HP bar (top-down: arc above)
        if (this.hp < this.maxHp) {
            g.lineStyle(0);
            g.beginFill(0x222222);
            g.drawRect(-r, -r - 9, r * 2, 5);
            g.endFill();
            const hr = this.hp / this.maxHp;
            g.beginFill(hr > 0.6 ? 0x44dd44 : hr > 0.3 ? 0xffaa00 : 0xff2200);
            g.drawRect(-r, -r - 9, r * 2 * hr, 5);
            g.endFill();
        }
        // Type badge (ice/fire)
        if (this.type === ENEMY.ICE) {
            g.lineStyle(1.5, 0xaaffff, 0.9);
            for (let a = 0; a < 3; a++) {
                const ang = (a / 3) * Math.PI;
                g.moveTo(Math.cos(ang) * r * 0.45, Math.sin(ang) * r * 0.45);
                g.lineTo(-Math.cos(ang) * r * 0.45, -Math.sin(ang) * r * 0.45);
            }
            g.lineStyle(0);
        } else if (this.type === ENEMY.FIRE) {
            g.lineStyle(0);
            for (let s = -1; s <= 1; s++) {
                g.beginFill(0xff8800, 0.9);
                g.drawPolygon([
                    s * r * 0.35 - 3,
                    -r * 0.2,
                    s * r * 0.35 + 3,
                    -r * 0.2,
                    s * r * 0.35,
                    -r * 0.75,
                ]);
                g.endFill();
            }
        }
        // Boss crown
        if (this.type === ENEMY.BOSS) {
            g.lineStyle(2, 0xffcc00, 0.9);
            g.drawCircle(0, 0, r + 4);
            g.lineStyle(0);
        }
    }
    hit(dmg, sourceStatus = null) {
        if (sourceStatus && sourceStatus.type === this.weakness) dmg *= 2;
        this.hp -= dmg;
        this.hitFlash = 7;
        if (this.hp <= 0) {
            this._die();
            return true;
        }
        this._draw(false);
        playHit(false);
        this.shakeX = (Math.random() - 0.5) * 18;
        this.shakeY = (Math.random() - 0.5) * 10;
        return false;
    }
    _die() {
        this.alive = false;
        burst(this.x, this.y - this.h * 0.5, this.color, 18, this.type === ENEMY.BOSS);
        playHit(true);
        new Coin(this.x, this.y - 20, this.reward);
        totalScore += this.pts;
        scoreTxt.text = `Score: ${totalScore}`;
        waveAlive = Math.max(0, waveAlive - 1);
        this.ctr.destroy();
    }
    update(dt) {
        if (!this.alive) return;

        // Burn DoT
        if (this.burnTimer > 0) {
            this.burnTimer -= dt;
            this.hp -= this.burnDps * dt;
            this.burnParticleT -= dt;
            if (this.burnParticleT <= 0) {
                this.burnParticleT = 0.08;
                new Particle(
                    this.x + (Math.random() - 0.5) * this.w * 0.6,
                    this.y - this.h * 0.9,
                    0xff4400,
                );
                new Particle(
                    this.x + (Math.random() - 0.5) * this.w * 0.4,
                    this.y - this.h * 0.7,
                    0xff8800,
                );
            }
            if (this.burnTimer <= 0) this._drawStatus();
            if (this.hp <= 0 && this.alive) {
                this._die();
                return;
            }
        }

        // Slow timer
        if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) this._drawStatus();
        }

        const effectiveSpd = this.spd * (this.slowTimer > 0 ? this.slowFactor : 1);
        // Follow path waypoints
        let remaining = effectiveSpd * dt;
        while (remaining > 0 && this.wpIdx < PATH_PTS.length - 1) {
            const target = PATH_PTS[this.wpIdx + 1];
            const dx = target.x - this.x,
                dy = target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.01) {
                this.dirX = dx / dist;
                this.dirY = dy / dist;
            }
            if (remaining >= dist) {
                this.x = target.x;
                this.y = target.y;
                this.wpIdx++;
                remaining -= dist;
            } else {
                this.x += (dx / dist) * remaining;
                this.y += (dy / dist) * remaining;
                remaining = 0;
            }
        }
        this.walkCycle += effectiveSpd * dt * 0.07;
        if (this.hitFlash > 0) {
            this.hitFlash--;
            this._draw(this.hitFlash % 2 === 0);
        } else this._draw(false);
        this.shakeX *= 0.7;
        this.shakeY *= 0.7;
        this.ctr.x = this.x + this.shakeX;
        this.ctr.y = this.y + this.shakeY;
        if (this.wpIdx >= PATH_PTS.length - 1) {
            const ep = PATH_PTS[PATH_PTS.length - 1];
            lives--;
            updateHUD();
            burst(ep.x, ep.y, 0xff2222, 10);
            spawnFloatText(`-1 ❤️`, ep.x, ep.y - 40, 0xff4444);
            this.alive = false;
            waveAlive = Math.max(0, waveAlive - 1);
            this.ctr.destroy();
            if (lives <= 0) triggerGameOver();
        }
    }
}

// ── Tower — manual skill-shot launcher ────────────────────────
class Tower {
    constructor(x, y, type) {
        this.type = type;
        this.def = Object.assign({}, TDEFS[type]); // own copy so upgrades don't mutate TDEFS
        this.x = x;
        this.y = y;
        this.fy = y; // top-down: barrel fires from center
        this.cooldown = 0;
        this.wasReady = true;
        this.barrelAngle = 0;
        this.level = 1;

        towers.push(this);

        this.ctr = new PIXI.Container();
        this.ctr.x = x;
        this.ctr.y = y;
        this.bodyGfx = new PIXI.Graphics();
        this.cdGfx = new PIXI.Graphics();
        this.barrelGfx = new PIXI.Graphics();
        this.ctr.addChild(this.bodyGfx, this.cdGfx, this.barrelGfx);
        towerLayer.addChild(this.ctr);

        // Upgrade button lives as a sibling in towerLayer (not child of this.ctr)
        // so its events never conflict with the tower's hitArea/pointerdown
        this.upgradeBtnCtr = new PIXI.Container();
        this.upgradeBtnCtr.x = x;
        this.upgradeBtnCtr.y = y;
        towerLayer.addChild(this.upgradeBtnCtr);

        // Tower body click → aim
        this.ctr.eventMode = 'static';
        this.ctr.cursor = 'crosshair';
        this.ctr.hitArea = new PIXI.Circle(0, 0, 40);
        this.ctr.on('pointerdown', (e) => {
            e.stopPropagation();
            onTowerDown(this);
        });

        this._drawBody();
        this._drawCooldown();
        this._buildUpgradeBtn();
        this._showRangeBrief(1.5);
    }

    isReady() {
        return this.cooldown <= 0;
    }

    fire(tx, ty) {
        this.cooldown = this.def.recharge;
        this.barrelAngle = Math.atan2(ty - this.y, tx - this.x);
        this._drawBarrel();
        const dist = Math.hypot(tx - this.x, ty - this.y);
        const hangTime = 0.35 + dist / 1800;
        new TopDownBomb(
            this.x,
            this.fy,
            tx,
            ty,
            this.def.dmg,
            this.def.pColor,
            this.def.pSize,
            this.def.aoe,
            this.def.status,
            hangTime,
        );
        playLaunch(this.type === TOWER.CANNON);
        triggerShake(this.type === TOWER.CANNON ? 7 : 3);
        this.wasReady = false;
    }

    _drawBody() {
        const g = this.bodyGfx,
            d = this.def;
        g.clear();
        const borderColor = this.level === 3 ? 0xffcc00 : this.level === 2 ? 0xaaddff : 0x334455;
        const borderAlpha = this.level > 1 ? 1.0 : 0.55;
        // Shadow
        g.beginFill(0x000000, 0.28);
        g.drawEllipse(5, 6, 26, 14);
        g.endFill();
        // Outer base plate
        g.lineStyle(3, borderColor, borderAlpha);
        g.beginFill(0x1a1a2e);
        g.drawCircle(0, 0, 24);
        g.endFill();
        // Colored body
        g.lineStyle(1.5, d.accent, 0.6);
        g.beginFill(d.color);
        g.drawCircle(0, 0, 19);
        g.endFill();
        // Accent inner ring
        g.lineStyle(2, d.accent, 0.75);
        g.drawCircle(0, 0, 10);
        g.lineStyle(0);
        // Center emblem
        g.beginFill(0xffffff, 0.5);
        g.drawCircle(0, 0, 5);
        g.endFill();
        g.beginFill(d.accent);
        g.drawCircle(0, 0, 3);
        g.endFill();
        // Level pips
        for (let i = 0; i < this.level; i++) {
            const ang = (i / 3) * Math.PI * 2 - Math.PI / 2;
            const pipColor = i === 0 ? 0xffffff : i === 1 ? 0xffee44 : 0xff8800;
            g.beginFill(pipColor, 0.9);
            g.drawCircle(Math.cos(ang) * 14, Math.sin(ang) * 14, 3.5);
            g.endFill();
        }
    }

    _buildUpgradeBtn() {
        const ctr = this.upgradeBtnCtr;
        ctr.removeChildren();
        if (this.level >= MAX_TOWER_LEVEL) return; // maxed out

        const upgrades = UPGRADE_DEFS[this.type];
        const nextUpgrade = upgrades[this.level - 1]; // level 1→index 0, level 2→index 1
        const canAfford = gold >= nextUpgrade.cost;
        const isAbove = this.y > H - SHOP_H - 130; // near bottom → show above
        const btnY = isAbove ? -70 : 36;

        const bg = new PIXI.Graphics();
        bg.lineStyle(1.5, canAfford ? 0x88ff44 : 0x666666, 0.9);
        bg.beginFill(canAfford ? 0x1a3a0a : 0x1a1a1a, 0.92);
        bg.drawRoundedRect(-28, -12, 56, 24, 6);
        bg.endFill();
        ctr.addChild(bg);

        const lbl = new PIXI.Text(`↑ ${nextUpgrade.cost}g`, {
            fontFamily: 'Arial Black,Arial',
            fontSize: 11,
            fill: canAfford ? 0xccff88 : 0x777777,
        });
        lbl.anchor.set(0.5);
        lbl.x = 0;
        lbl.y = 0;
        ctr.addChild(lbl);

        ctr.x = this.x;
        ctr.y = this.y + btnY;
        ctr.eventMode = 'static';
        ctr.cursor = 'pointer';
        ctr.hitArea = new PIXI.Rectangle(-28, -12, 56, 24);
        ctr.removeAllListeners();
        ctr.on('pointerdown', (e) => {
            e.stopPropagation();
            this.upgrade();
        });
        ctr.on('pointerover', () => {
            bg.tint = 0xddffdd;
        });
        ctr.on('pointerout', () => {
            bg.tint = 0xffffff;
        });
    }

    upgrade() {
        if (this.level >= MAX_TOWER_LEVEL) return;
        const upgrades = UPGRADE_DEFS[this.type];
        const nextUp = upgrades[this.level - 1];
        if (gold < nextUp.cost) {
            spawnFloatText('Not enough gold!', this.x, this.y - 60, 0xff4444);
            return;
        }
        gold -= nextUp.cost;
        updateHUD();

        // Apply upgrade stats onto the def copy
        Object.assign(this.def, nextUp);
        this.level++;

        this._drawBody();
        this._buildUpgradeBtn();
        spawnFloatText(`Upgraded to Lv${this.level}!`, this.x, this.y - 65, 0xffee44);
        // Brief flash
        let ff = 0;
        const flash = () => {
            ff++;
            this.ctr.alpha = ff % 2 === 0 ? 1 : 0.5;
            ff < 6 ? requestAnimationFrame(flash) : (this.ctr.alpha = 1);
        };
        flash();
    }

    _drawBarrel() {
        const g = this.barrelGfx,
            d = this.def;
        g.clear();
        const isCannon = this.type === TOWER.CANNON;
        g.lineStyle(isCannon ? 8 : 5, d.accent, 0.95);
        const len = isCannon ? 30 : 24;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(this.barrelAngle) * len, Math.sin(this.barrelAngle) * len);
        // Barrel tip dot
        g.lineStyle(0);
        g.beginFill(d.accent, 0.8);
        g.drawCircle(
            Math.cos(this.barrelAngle) * len,
            Math.sin(this.barrelAngle) * len,
            isCannon ? 5 : 3,
        );
        g.endFill();
    }

    _drawCooldown() {
        const g = this.cdGfx,
            d = this.def;
        g.clear();
        const ratio = this.cooldown / d.recharge;
        if (ratio <= 0) {
            g.lineStyle(3, 0x44ff44, 0.9);
            g.drawCircle(0, 0, 27);
        } else {
            const startAng = -Math.PI / 2;
            const endAng = startAng + (1 - ratio) * Math.PI * 2;
            g.lineStyle(3, 0xff3322, 0.7);
            g.arc(0, 0, 27, startAng, startAng + Math.PI * 2);
            g.lineStyle(3, 0x44ff44, 0.9);
            if (endAng > startAng) g.arc(0, 0, 27, startAng, endAng);
        }
    }

    _showRangeBrief(duration) {
        const rg = new PIXI.Graphics();
        rg.lineStyle(2, this.def.accent, 0.4);
        rg.drawCircle(0, 0, 350); // range visual (all towers cover whole field)
        rg.x = this.x;
        rg.y = this.y;
        fxLayer.addChild(rg);
        let t = 0;
        const fade = () => {
            t += 1 / 60;
            rg.alpha = Math.max(0, 1 - t / duration);
            t < duration ? requestAnimationFrame(fade) : rg.destroy();
        };
        fade();
    }

    update(dt) {
        if (this.cooldown > 0) {
            const wasBusy = !this.wasReady;
            this.cooldown = Math.max(0, this.cooldown - dt);
            if (this.cooldown === 0 && wasBusy) {
                this.wasReady = true;
                playTowerReady();
                // Ready flash
                let ff = 0;
                const flash = () => {
                    ff++;
                    this.ctr.alpha = ff % 2 === 0 ? 1 : 1.0;
                    this.bodyGfx.tint = ff < 6 ? 0xffffff : 0xffffff;
                    if (ff < 8) requestAnimationFrame(flash);
                    else {
                        this.bodyGfx.tint = 0xffffff;
                    }
                };
                flash();
            }
        } else {
            this.wasReady = false; // will flip to true on next ready
        }
        this._drawCooldown();

        // Pulse glow when ready
        if (this.isReady()) {
            this.wasReady = true;
            const pulse = 0.85 + Math.sin(performance.now() * 0.004) * 0.15;
            this.ctr.alpha = pulse;
        } else {
            this.ctr.alpha = 0.75;
        }
    }
}

// ── Top-down bomb projectile ───────────────────────────────────
class TopDownBomb {
    constructor(sx, sy, tx, ty, dmg, color, size, aoe, status, hangTime) {
        this.sx = sx;
        this.sy = sy;
        this.tx = tx;
        this.ty = ty;
        this.dmg = dmg;
        this.color = color;
        this.size = size;
        this.aoe = Math.max(aoe || 0, 18);
        this.status = status;
        this.hangTime = hangTime;
        this.timer = hangTime;
        this.alive = true;

        this.ctr = new PIXI.Container();

        // Growing shadow circle at target
        this.shadowGfx = new PIXI.Graphics();
        this.ctr.addChild(this.shadowGfx);

        // Spinning projectile dot that travels from tower to target
        this.projGfx = new PIXI.Graphics();
        this.projGfx.beginFill(color);
        this.projGfx.drawCircle(0, 0, size * 0.6);
        this.projGfx.endFill();
        this.projGfx.beginFill(0xffffff, 0.5);
        this.projGfx.drawCircle(-size * 0.2, -size * 0.2, size * 0.25);
        this.projGfx.endFill();
        this.ctr.addChild(this.projGfx);

        projLayer.addChild(this.ctr);
        projectiles.push(this);
    }

    update(dt) {
        if (!this.alive) return false;
        this.timer -= dt;
        const progress = 1 - Math.max(this.timer, 0) / this.hangTime;

        // Projectile moves from source to target
        this.projGfx.x = this.sx + (this.tx - this.sx) * progress;
        this.projGfx.y = this.sy + (this.ty - this.sy) * progress;
        this.projGfx.rotation += 0.18;

        // Growing shadow at target
        const shadowR = this.aoe * (0.15 + progress * 0.85);
        this.shadowGfx.clear();
        this.shadowGfx.lineStyle(2, this.color, 0.6 * progress);
        this.shadowGfx.beginFill(this.color, 0.1 * progress);
        this.shadowGfx.drawCircle(this.tx, this.ty, shadowR);
        this.shadowGfx.endFill();
        // X crosshair in shadow
        this.shadowGfx.lineStyle(1, this.color, 0.4 * progress);
        const cr = shadowR * 0.35;
        this.shadowGfx.moveTo(this.tx - cr, this.ty);
        this.shadowGfx.lineTo(this.tx + cr, this.ty);
        this.shadowGfx.moveTo(this.tx, this.ty - cr);
        this.shadowGfx.lineTo(this.tx, this.ty + cr);

        if (this.timer <= 0) {
            this._impact();
            return false;
        }
        return true;
    }

    _impact() {
        this.alive = false;
        let anyKill = false;
        for (const e of enemies) {
            if (!e.alive) continue;
            const dx = this.tx - e.x,
                dy = this.ty - e.y;
            if (Math.sqrt(dx * dx + dy * dy) < this.aoe + e.w / 2) {
                const killed = e.hit(this.dmg, this.status);
                if (killed) anyKill = true;
                e.applyStatus(this.status);
            }
        }
        playHit(true);
        burst(this.tx, this.ty, this.color, anyKill ? 24 : 14, anyKill);
        triggerShake(anyKill ? 20 : 8);
        const ringColor =
            this.status?.type === STATUS.SLOW
                ? 0x66eeff
                : this.status?.type === STATUS.BURN
                  ? 0xff5500
                  : 0xff8800;
        const ring = new PIXI.Graphics();
        ring.lineStyle(3, ringColor, 1);
        ring.drawCircle(this.tx, this.ty, 10);
        fxLayer.addChild(ring);
        let rf = 0;
        const maxR = this.aoe / 8;
        const expand = () => {
            rf++;
            ring.scale.set(1 + rf * maxR * 0.18);
            ring.alpha = 1 - rf / 22;
            rf < 22 ? requestAnimationFrame(expand) : ring.destroy();
        };
        expand();
        this.ctr.destroy();
    }
}

// ── Wave system ───────────────────────────────────────────────
function buildWave(n) {
    const q = [],
        base = 7 + n * 4;
    for (let i = 0; i < base; i++) {
        let type = ENEMY.GRUNT;
        if (n >= 2 && i % 3 === 1) type = ENEMY.ARMORED;
        if (n >= 2 && i % 5 === 2) type = ENEMY.FAST;
        if (n >= 2 && i % 6 === 3) type = ENEMY.ICE;
        if (n >= 3 && i % 6 === 4) type = ENEMY.FIRE;
        if (n >= 3 && i === Math.floor(base / 2)) type = ENEMY.BOSS;
        q.push(type);
    }
    return q;
}
function startWave() {
    if (phase !== PHASE.BUILD || gameOver) return;
    waveNum++;
    phase = PHASE.WAVE;
    waveQueue = buildWave(waveNum);
    waveAlive = waveQueue.length;
    waveSpawnT = 0;
    updateHUD();
    spawnFloatText(`Wave ${waveNum}!`, W / 2, H / 2 - 80, 0xff8844);
}
function onGroundClick(wx, wy) {
    if (gameOver) return;
    if (!canPlaceTower(wx, wy)) {
        spawnFloatText("Can't build here!", wx, wy - 30, 0xff4444);
        return;
    }
    const def = TDEFS[selectedType];
    if (gold < def.cost) {
        spawnFloatText('Not enough gold!', wx, wy - 30, 0xff4444);
        return;
    }
    gold -= def.cost;
    updateHUD();
    new Tower(wx, wy, selectedType);
    spawnFloatText(`-${def.cost}g`, wx, wy - 30, 0xffdd44);
    ghostGfx.clear();
}

// ── Aim visuals (shared between slingshot + towers) ────────────
const aimRing = new PIXI.Graphics();
aimRing.visible = false;
aimLayer.addChild(aimRing);

const aimLine = new PIXI.Graphics(); // pull line for towers
aimLayer.addChild(aimLine);

const rubberBand = new PIXI.Graphics();
aimLayer.addChild(rubberBand);

const TDOT_N = 34;
const trajDots = [];
for (let i = 0; i < TDOT_N; i++) {
    const d = new PIXI.Graphics();
    d.beginFill(0xffffff, 0.82 - i * 0.022);
    d.drawCircle(0, 0, Math.max(5 - i * 0.1, 1.5));
    d.endFill();
    d.visible = false;
    aimLayer.addChild(d);
    trajDots.push(d);
}
const pwrBg = new PIXI.Graphics();
const pwrFill = new PIXI.Graphics();
pwrBg.visible = false;
pwrFill.visible = false;
aimLayer.addChild(pwrBg, pwrFill);

// Simulate with small fixed steps (matches real physics) then downsample to dotCount
function computeTraj(x, y, vx, vy, dotCount) {
    const DT = 0.016; // same step as real physics — no drift
    const MAX = 250; // max simulation steps (~4s)
    const raw = [];
    let cx = x,
        cy = y,
        cvx = vx,
        cvy = vy;
    for (let i = 0; i < MAX; i++) {
        cvy += GRAVITY * DT;
        cx += cvx * DT;
        cy += cvy * DT;
        raw.push({ x: cx, y: cy });
        if (cy > H - SHOP_H) break;
    }
    // Downsample evenly to dotCount
    const pts = [];
    const stride = Math.max(1, Math.floor(raw.length / dotCount));
    for (let i = 0; i < raw.length && pts.length < dotCount; i += stride) pts.push(raw[i]);
    return pts;
}

// Convert screen (pointer) coords → worldLayer local coords
function toWorld(sx, sy) {
    return { x: (sx - WL_CX) / ZOOM + WL_CX, y: (sy - WL_CY) / ZOOM + WL_CY };
}

function distToPath(px, py) {
    let min = Infinity;
    for (let i = 0; i < PATH_PTS.length - 1; i++) {
        const ax = PATH_PTS[i].x,
            ay = PATH_PTS[i].y;
        const bx = PATH_PTS[i + 1].x,
            by = PATH_PTS[i + 1].y;
        const abx = bx - ax,
            aby = by - ay,
            len2 = abx * abx + aby * aby;
        const t =
            len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
        const d = Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
        if (d < min) min = d;
    }
    return min;
}

function canPlaceTower(px, py) {
    if (distToPath(px, py) < MIN_TOWER_PATH_DIST) return false;
    if (py > H - SHOP_H - 20 || py < 20) return false;
    for (const t of towers) {
        if (Math.hypot(px - t.x, py - t.y) < MIN_TOWER_TOWER_DIST) return false;
    }
    return true;
}

// Returns current aim anchor position
function aimAnchor() {
    return activeShooter ? { x: activeShooter.x, y: activeShooter.fy } : SL_ANCHOR;
}

// ── Input ─────────────────────────────────────────────────────
function startAim(shooter) {
    // shooter: null = slingshot, Tower = that tower
    if (isAiming) return;
    if (shooter instanceof Tower && !shooter.isReady()) {
        spawnFloatText('Recharging…', shooter.x, shooter.y - 50, 0xff6644);
        return;
    }
    activeShooter = shooter;
    isAiming = true;
    timeScale = SLOW_SCALE;
    slowOverlay.style.opacity = '1';
    pwrBg.visible = true;
    pwrFill.visible = true;
    aimRing.visible = true;
    playAimTick(0);
}

function onTowerDown(tower) {
    if (gameOver) return;
    AC.resume();
    startAim(tower);
}

// Stage pointerdown — towers intercept their own pointerdown for aiming
app.stage.on('pointerdown', () => {
    if (gameOver || isAiming) return;
    AC.resume();
    /* SLINGSHOT DISABLED — restore by uncommenting
    const p = toWorld(e.global.x, e.global.y);
    const dx = p.x - SL_ANCHOR.x, dy = p.y - SL_ANCHOR.y;
    if (Math.sqrt(dx * dx + dy * dy) < 72) startAim(null);
    else dragPos = p;
    */
});
app.stage.on('pointermove', (e) => {
    const p = toWorld(e.global.x, e.global.y);
    if (isAiming) dragPos = p;
    if (isDragging) updateDragIcon(selectedType, e.global.x, e.global.y);
    updateGhost(p.x, p.y);
    // Collect coins by dragging/hovering over them
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (c.collected) continue;
        const dx = p.x - c.x,
            dy = p.y - c.y;
        if (dx * dx + dy * dy < 30 * 30) c.collect();
    }
});
app.stage.on('pointerup', (e) => onUp(e));
app.stage.on('pointerupoutside', (e) => onUp(e));

function onUp(e) {
    // ── Drag-and-drop tower placement ──
    if (isDragging) {
        isDragging = false;
        ghostGfx.clear();
        dragIcon.visible = false;
        if (e && !gameOver) {
            const p = toWorld(e.global.x, e.global.y);
            onGroundClick(p.x, p.y);
        }
        return;
    }
    if (!isAiming) return;
    isAiming = false;
    timeScale = 1;
    slowOverlay.style.opacity = '0';
    aimRing.visible = false;
    pwrBg.visible = false;
    pwrFill.visible = false;
    rubberBand.clear();
    aimLine.clear();
    trajDots.forEach((d) => (d.visible = false));

    if (!dragPos) {
        activeShooter = null;
        return;
    }

    const anchor = aimAnchor();
    const pdx = dragPos.x - anchor.x,
        pdy = dragPos.y - anchor.y;
    const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pdist < 8) {
        dragPos = null;
        activeShooter = null;
        return;
    }

    // Fire in the direction opposite to the pull (angle-compressed)
    const clampedDist = Math.min(pdist, MAX_PULL);
    const fd = compressAimDir(-pdx / pdist, -pdy / pdist);
    const tx = anchor.x + fd.x * clampedDist * 3;
    const ty = anchor.y + fd.y * clampedDist * 3;

    if (activeShooter) {
        activeShooter.fire(tx, ty);
    }
    /* SLINGSHOT DISABLED — restore by uncommenting
    else {
        // slingshot fire
    }
    */

    dragPos = null;
    activeShooter = null;
    lastAimPow = -1;
}

// Touch
app.view.addEventListener(
    'touchstart',
    (e) => {
        e.preventDefault();
    },
    { passive: false },
);
app.view.addEventListener(
    'touchmove',
    (e) => {
        e.preventDefault();
    },
    { passive: false },
);
app.view.addEventListener(
    'touchend',
    (e) => {
        e.preventDefault();
    },
    { passive: false },
);

// ── Screen shake ──────────────────────────────────────────────
function triggerShake(amt) {
    shakeAmt = Math.max(shakeAmt, amt);
}

// ── Game over ─────────────────────────────────────────────────
let _goShown = false;
function triggerGameOver() {
    if (_goShown) return;
    _goShown = true;
    gameOver = true;
    showEndMsg('GAME OVER', 0xff3322);
}

// ── Main loop ─────────────────────────────────────────────────
let lastTs = 0;
app.ticker.add(() => {
    const now = performance.now();
    const rawDt = Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;
    const dt = rawDt * timeScale;

    // Screen shake — offset from the pivot-anchored base position
    if (shakeAmt > 0.3) {
        worldLayer.x = WL_CX + (Math.random() - 0.5) * shakeAmt * 2;
        worldLayer.y = WL_CY + (Math.random() - 0.5) * shakeAmt * 2;
        shakeAmt *= 0.8;
    } else {
        worldLayer.x = WL_CX;
        worldLayer.y = WL_CY;
        shakeAmt = 0;
    }

    slShotCD = Math.max(0, slShotCD - rawDt);

    // Wave spawn
    if (phase === PHASE.WAVE && waveQueue.length > 0) {
        waveSpawnT -= rawDt;
        if (waveSpawnT <= 0) {
            new Enemy(waveQueue.shift());
            waveSpawnT = Math.max(0.35, 1.1 - waveNum * 0.07);
        }
    }
    if (
        phase === PHASE.WAVE &&
        waveQueue.length === 0 &&
        waveAlive <= 0 &&
        enemies.length === 0 &&
        !gameOver
    ) {
        phase = PHASE.BUILD;
        const bonus = waveNum * 20;
        gold += bonus;
        updateHUD();
        spawnFloatText(`Wave ${waveNum} Clear!  +${bonus}g`, W / 2, H / 2 - 60, 0x44ff88);
    }

    // Updates
    for (let i = enemies.length - 1; i >= 0; i--) {
        enemies[i].update(dt);
        if (!enemies[i].alive) enemies.splice(i, 1);
    }
    towers.forEach((t) => t.update(dt));
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (!projectiles[i].update(dt)) projectiles.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        if (!particles[i].update(dt)) particles.splice(i, 1);
    }
    for (let i = coins.length - 1; i >= 0; i--) {
        if (!coins[i].update(dt)) coins.splice(i, 1);
    }

    // ── Aim visuals ──────────────────────────────────────────────
    if (isAiming && dragPos) {
        const anchor = aimAnchor();
        // Pull vector: dragPos is BEHIND the tower, fire direction is opposite
        const pdx = dragPos.x - anchor.x,
            pdy = dragPos.y - anchor.y;
        let pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        const clampedDist = Math.min(pdist, MAX_PULL);
        const pwr = clampedDist / MAX_PULL;
        if (Math.abs(pwr - lastAimPow) > 0.06) {
            playAimTick(pwr);
            lastAimPow = pwr;
        }

        // Fire direction = opposite of pull (angle-compressed)
        const rawFdx = pdist > 0 ? -pdx / pdist : 0;
        const rawFdy = pdist > 0 ? -pdy / pdist : -1;
        const { x: fdx, y: fdy } = compressAimDir(rawFdx, rawFdy);
        const range = clampedDist * 3;
        const tx = anchor.x + fdx * range;
        const ty = anchor.y + fdy * range;

        // Power bar above anchor
        pwrBg.clear();
        pwrBg.beginFill(0x000000, 0.5);
        pwrBg.drawRoundedRect(anchor.x - 50, anchor.y - 60, 100, 12, 6);
        pwrBg.endFill();
        pwrFill.clear();
        pwrFill.beginFill(pwr < 0.4 ? 0x44dd44 : pwr < 0.72 ? 0xffaa00 : 0xff2200);
        pwrFill.drawRoundedRect(anchor.x - 48, anchor.y - 58, 96 * pwr, 8, 4);
        pwrFill.endFill();
        pwrBg.visible = true;
        pwrFill.visible = true;

        // Rubber band: line from anchor back to dragPos (the pull)
        rubberBand.clear();
        rubberBand.lineStyle(3, 0xe8b840, 0.9);
        rubberBand.moveTo(anchor.x, anchor.y);
        rubberBand.lineTo(dragPos.x, dragPos.y);

        // Trajectory dots projected FORWARD from anchor toward target
        aimLine.clear();
        trajDots.forEach((d, i) => {
            const t = (i + 1) / TDOT_N;
            d.x = anchor.x + fdx * range * t;
            d.y = anchor.y + fdy * range * t;
            d.alpha = (1 - t) * 0.85;
            d.visible = true;
        });

        // Target reticle at computed target
        const def = activeShooter ? activeShooter.def : { pColor: 0xff3311, aoe: 30 };
        const reticleR = Math.max(def.aoe || 0, 18) * 0.9;
        aimRing.clear();
        aimRing.lineStyle(2, def.pColor || 0xff3311, 0.85);
        aimRing.drawCircle(tx, ty, reticleR);
        aimRing.lineStyle(1.5, 0xffffff, 0.55);
        const cr = reticleR * 0.35;
        aimRing.moveTo(tx - reticleR - 8, ty);
        aimRing.lineTo(tx - cr, ty);
        aimRing.moveTo(tx + cr, ty);
        aimRing.lineTo(tx + reticleR + 8, ty);
        aimRing.moveTo(tx, ty - reticleR - 8);
        aimRing.lineTo(tx, ty - cr);
        aimRing.moveTo(tx, ty + cr);
        aimRing.lineTo(tx, ty + reticleR + 8);
        aimRing.lineStyle(0);
        aimRing.beginFill(def.pColor || 0xff3311, 0.4 + Math.sin(now * 0.008) * 0.25);
        aimRing.drawCircle(tx, ty, 4);
        aimRing.endFill();
        aimRing.visible = true;
    } else {
        rubberBand.clear();
        aimLine.clear();
        trajDots.forEach((d) => (d.visible = false));
    }
});

// ── End screen ────────────────────────────────────────────────
function showEndMsg(text, color) {
    const st = new PIXI.TextStyle({
        fontFamily: 'Arial Black,Arial',
        fontSize: 82,
        fontWeight: 'bold',
        fill: color,
        stroke: 0x000000,
        strokeThickness: 8,
        dropShadow: true,
        dropShadowBlur: 16,
        dropShadowColor: 0x000000,
        dropShadowDistance: 5,
    });
    const msg = new PIXI.Text(text, st);
    msg.anchor.set(0.5);
    msg.x = W / 2;
    msg.y = H / 2;
    msg.alpha = 0;
    msg.scale.set(0.3);
    uiLayer.addChild(msg);
    const sub = new PIXI.Text(`Score: ${totalScore}  •  Wave ${waveNum}`, {
        fontFamily: 'Arial,sans-serif',
        fontSize: 26,
        fill: 0xffffff,
        dropShadow: true,
        dropShadowBlur: 6,
    });
    sub.anchor.set(0.5);
    sub.x = W / 2;
    sub.y = H / 2 + 68;
    sub.alpha = 0;
    uiLayer.addChild(sub);
    let t = 0;
    const anim = () => {
        t += 0.045;
        msg.alpha = Math.min(t * 1.6, 1);
        msg.scale.set(Math.min(0.3 + t * 0.75, 1.05));
        sub.alpha = Math.max(0, (t - 0.35) * 2.5);
        if (t < 1.2) {
            requestAnimationFrame(anim);
            return;
        }
        const r = new PIXI.Text('Click to Play Again', {
            fontFamily: 'Arial,sans-serif',
            fontSize: 22,
            fill: 0xffffff,
        });
        r.anchor.set(0.5);
        r.x = W / 2;
        r.y = H / 2 + 118;
        uiLayer.addChild(r);
        app.view.addEventListener('click', () => location.reload(), { once: true });
    };
    anim();
}
