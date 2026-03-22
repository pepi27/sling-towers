// ============================================================
//  TOWER SIEGE — Tower Defense + Skill Shot  (Pixi.js v7)
// ============================================================
const W = 1280,
    H = 720;
const GRAVITY = 820;
const SHOP_H = 80;

const ZOOM   = 1.18;                        // gameplay zoom factor
const WL_CX  = W / 2;                       // worldLayer pivot x
const WL_CY  = (H - SHOP_H) / 2;           // worldLayer pivot y (centre of play area)

// Curved enemy path — control points for Catmull-Rom spline
const PATH_CTRL = [
    { x: 1340, y: 330 },
    { x: 1080, y: 170 },
    { x:  820, y: 400 },
    { x:  580, y: 170 },
    { x:  340, y: 400 },
    { x:  160, y: 265 },
    { x:   90, y: 355 },
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
            const t = s / segs, t2 = t * t, t3 = t2 * t;
            out.push({
                x: 0.5 * (2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
                y: 0.5 * (2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
            });
        }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
}
const PATH_PTS = buildPathPts(PATH_CTRL, 20); // ~120 smooth points
const PATH_WIDTH = 54;          // visual half-width of road
const MIN_TOWER_PATH_DIST = 80; // can't place this close to path center
const MIN_TOWER_TOWER_DIST = 65;// can't place this close to another tower

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
const SL_ANCHOR = { x: 190, y: 498 };
const SL_FORK_L = { x: 168, y: 455 };
const SL_FORK_R = { x: 212, y: 455 };
const MAX_PULL = 88;
const LAUNCH_SPD = 1100;
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
        aoe: 90,
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
    ],
    [TOWER.CANNON]: [
        { cost: 100, dmg: 7, aoe: 115, recharge: 2.6, label: 'Lv2: +dmg +blast' },
        { cost: 170, dmg: 12, aoe: 150, recharge: 2.0, label: 'Lv3: mega blast' },
    ],
    [TOWER.RAPID]: [
        { cost: 55, dmg: 0.8, recharge: 0.45, pSize: 9, label: 'Lv2: +dmg faster' },
        { cost: 100, dmg: 1.3, recharge: 0.28, pSize: 10, label: 'Lv3: bullet storm' },
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
    ],
};
const MAX_TOWER_LEVEL = 3;

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
const slotLayer = new PIXI.Container();
const towerLayer = new PIXI.Container();
const enemyLayer = new PIXI.Container();
const coinLayer = new PIXI.Container();
const projLayer = new PIXI.Container();
const fxLayer = new PIXI.Container();
const aimLayer = new PIXI.Container();
const uiLayer = new PIXI.Container();

// bgLayer is NOT inside worldLayer — keeps background full-size and un-zoomed
app.stage.addChild(bgLayer);
app.stage.addChild(worldLayer);
[slotLayer, towerLayer, enemyLayer, coinLayer, projLayer, fxLayer, aimLayer].forEach((l) =>
    worldLayer.addChild(l),
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
    // Sky + ground fill
    const g = new PIXI.Graphics();
    g.beginFill(0x0a1406); g.drawRect(0, 0, W, H); g.endFill();
    g.beginFill(0x163a0c); g.drawRect(0, 140, W, H - 140 - SHOP_H); g.endFill();
    g.beginFill(0x08080f); g.drawRect(0, H - SHOP_H, W, SHOP_H); g.endFill();
    g.lineStyle(1, 0x333355, 0.8); g.moveTo(0, H - SHOP_H); g.lineTo(W, H - SHOP_H);
    bgLayer.addChild(g);

    // Stars
    for (let i = 0; i < 90; i++) {
        const s = new PIXI.Graphics();
        s.beginFill(0xffffff, Math.random() * 0.55 + 0.15);
        s.drawCircle(0, 0, Math.random() * 1.1 + 0.3); s.endFill();
        s.x = Math.random() * W; s.y = Math.random() * 160;
        bgLayer.addChild(s);
    }

    // Curved dirt path — shadow, body, highlight
    const drawPathLine = (width, color, alpha) => {
        const pg = new PIXI.Graphics();
        pg.lineStyle({ width, color, alpha, join: 'round', cap: 'round' });
        pg.moveTo(PATH_PTS[0].x, PATH_PTS[0].y);
        for (let i = 1; i < PATH_PTS.length; i++) pg.lineTo(PATH_PTS[i].x, PATH_PTS[i].y);
        bgLayer.addChild(pg);
    };
    drawPathLine(PATH_WIDTH + 14, 0x3a2008, 0.5);  // shadow
    drawPathLine(PATH_WIDTH,      0x8a6420, 1.0);  // main road
    drawPathLine(PATH_WIDTH * 0.35, 0xaa7e2a, 0.55); // centre highlight

    // Scatter trees (not drawn on path — random positions in grassland)
    const treePositions = [
        [220,110],[420,90],[650,100],[880,95],[1100,105],
        [180,480],[380,490],[620,470],[860,485],[1080,475],
        [280,200],[750,185],[1000,210],[460,430],[950,450],
    ];
    treePositions.forEach(([tx, ty]) => {
        const t = new PIXI.Graphics();
        t.beginFill(0x1e5010); t.drawPolygon([0,-38,22,0,-22,0]); t.endFill();
        t.beginFill(0x164010); t.drawPolygon([0,-60,16,-18,-16,-18]); t.endFill();
        t.beginFill(0x3c2010); t.drawRect(-5,0,10,18); t.endFill();
        t.x = tx; t.y = ty;
        bgLayer.addChild(t);
    });

    // Castle at path end
    const bx = PATH_CTRL[PATH_CTRL.length - 1].x;
    const by = PATH_CTRL[PATH_CTRL.length - 1].y;
    const c = new PIXI.Graphics();
    c.beginFill(0x3a3a55); c.drawRect(bx - 44, by - 95, 88, 138); c.endFill();
    for (let i = 0; i < 5; i++) {
        c.beginFill(0x4a4a66); c.drawRect(bx - 44 + i * 18, by - 113, 12, 22); c.endFill();
    }
    c.beginFill(0x1a1a28); c.drawRect(bx - 14, by + 5, 28, 38); c.endFill();
    c.beginFill(0x5577aa, 0.7); c.drawRect(bx - 8, by + 11, 10, 10); c.endFill();
    const flag = new PIXI.Graphics();
    flag.beginFill(0xee2222); flag.drawPolygon([0,0,22,-14,0,-28]); flag.endFill();
    flag.lineStyle(2, 0x888888); flag.moveTo(0,0); flag.lineTo(0,-34);
    flag.x = bx - 44; flag.y = by - 113;
    bgLayer.addChild(c); bgLayer.addChild(flag);
})();

// ── Placement ghost preview ────────────────────────────────────
const ghostGfx = new PIXI.Graphics();
slotLayer.addChild(ghostGfx);
let ghostPos = null; // world coords of current hover position

function updateGhost(wx, wy) {
    ghostGfx.clear();
    if (phase !== PHASE.BUILD || isAiming || gameOver) { ghostPos = null; return; }
    ghostPos = { x: wx, y: wy };
    const valid = canPlaceTower(wx, wy);
    const canAfford = gold >= TDEFS[selectedType].cost;
    const ok = valid && canAfford;
    ghostGfx.lineStyle(2, ok ? 0x88ff44 : 0xff3322, 0.9);
    ghostGfx.beginFill(ok ? 0x44aa22 : 0xff2200, 0.22);
    ghostGfx.drawCircle(wx, wy, 28); ghostGfx.endFill();
    if (!valid) {
        ghostGfx.lineStyle(2.5, 0xff3322, 0.9);
        ghostGfx.moveTo(wx - 12, wy - 12); ghostGfx.lineTo(wx + 12, wy + 12);
        ghostGfx.moveTo(wx + 12, wy - 12); ghostGfx.lineTo(wx - 12, wy + 12);
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
livesTxt.x = 200;
livesTxt.y = 10;
waveTxt.x = 380;
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
waveBtn.x = W - 120;
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

const SHOP_TYPES = Object.keys(TDEFS);
const shopBtns = [];
SHOP_TYPES.forEach((type, i) => {
    const def = TDEFS[type];
    const btn = new PIXI.Container();
    btn.x = 20 + i * 175;
    btn.y = H - SHOP_H + 8;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointerdown', (e) => {
        e.stopPropagation();
        selectedType = type;
        refreshShop();
    });
    btn.on('pointerover', () => {
        if (selectedType !== type) drawShopBtn(btn, type, false, true);
    });
    btn.on('pointerout', () => drawShopBtn(btn, type, selectedType === type, false));
    const bg = new PIXI.Graphics();
    btn.addChild(bg);
    const sw = new PIXI.Graphics();
    sw.beginFill(def.color);
    sw.drawRoundedRect(0, 0, 24, 24, 4);
    sw.endFill();
    sw.x = 8;
    sw.y = 9;
    btn.addChild(sw);
    const lbl = new PIXI.Text(`${def.name}\n${def.label}`, {
        fontFamily: 'Arial,sans-serif',
        fontSize: 11,
        fill: 0xffffff,
        lineHeight: 15,
    });
    lbl.x = 40;
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
    bg.drawRoundedRect(0, 0, 165, 60, 7);
    bg.endFill();
    if (!canAfford) {
        bg.beginFill(0x000000, 0.45);
        bg.drawRoundedRect(0, 0, 165, 60, 7);
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
        color: 0xffcc22,
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
scoreTxt.x = W / 2 - 60;
scoreTxt.y = 10;
uiLayer.addChild(scoreTxt);

class Enemy {
    constructor(type) {
        const d = ENEMY_DEFS[type];
        this.type = type;
        this.x = PATH_PTS[0].x;
        this.y = PATH_PTS[0].y;
        this.wpIdx = 0; // current path waypoint index
        this.hp = d.hp;
        this.maxHp = d.hp;
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
        const hw = this.w / 2,
            hh = this.h;
        g.beginFill(0x000000, 0.2);
        g.drawEllipse(0, 2, hw + 2, 5);
        g.endFill();
        g.lineStyle(1.5, 0x000000, 0.4);
        g.beginFill(c);
        g.drawRoundedRect(-hw, -hh, this.w, this.h * 0.65, 4);
        g.endFill();
        g.beginFill(ac);
        g.drawCircle(0, -hh - 4, this.w * 0.38);
        g.endFill();
        g.beginFill(c);
        g.drawRoundedRect(-hw * 0.7, -hh - this.w * 0.38 - 4, this.w * 0.7 * 2, 8, 3);
        g.endFill();
        g.lineStyle(0);
        g.beginFill(0x110000);
        g.drawCircle(-4, -hh - 6, 2.5);
        g.drawCircle(4, -hh - 6, 2.5);
        g.endFill();
        const lsw = Math.sin(this.walkCycle) * 5;
        g.lineStyle(3.5, c, 1);
        g.moveTo(-5, -hh + this.h * 0.65);
        g.lineTo(-5 + lsw, -hh + this.h);
        g.moveTo(5, -hh + this.h * 0.65);
        g.lineTo(5 - lsw, -hh + this.h);
        // Type-specific visual badge
        if (this.type === ENEMY.ICE) {
            // Snowflake badge above head
            g.lineStyle(1.5, 0xaaffff, 0.9);
            const cx = 0,
                cy = -hh - 10;
            for (let a = 0; a < 3; a++) {
                const ang = (a / 3) * Math.PI;
                g.moveTo(cx + Math.cos(ang) * 7, cy + Math.sin(ang) * 7);
                g.lineTo(cx - Math.cos(ang) * 7, cy - Math.sin(ang) * 7);
            }
            g.lineStyle(0);
            g.beginFill(0xaaffff, 0.6);
            g.drawCircle(cx, cy, 3);
            g.endFill();
        } else if (this.type === ENEMY.FIRE) {
            // Flame spikes above head
            g.lineStyle(0);
            const fx = 0,
                fy = -hh - 6;
            for (let s = -1; s <= 1; s++) {
                g.beginFill(0xff8800, 0.9);
                g.drawPolygon([fx + s * 5 - 4, fy + 2, fx + s * 5 + 4, fy + 2, fx + s * 5, fy - 9]);
                g.endFill();
                g.beginFill(0xffee00, 0.85);
                g.drawPolygon([fx + s * 5 - 2, fy + 2, fx + s * 5 + 2, fy + 2, fx + s * 5, fy - 5]);
                g.endFill();
            }
        }
        if (this.hp < this.maxHp) {
            g.lineStyle(0);
            g.beginFill(0x222222);
            g.drawRect(-hw, -hh - 22, this.w, 6);
            g.endFill();
            const r = this.hp / this.maxHp;
            g.beginFill(r > 0.6 ? 0x44dd44 : r > 0.3 ? 0xffaa00 : 0xff2200);
            g.drawRect(-hw, -hh - 22, this.w * r, 6);
            g.endFill();
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
            const dx = target.x - this.x, dy = target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (remaining >= dist) {
                this.x = target.x; this.y = target.y;
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
        this.fy = y - 25;
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

    fire(vx, vy) {
        this.cooldown = this.def.recharge;
        this.barrelAngle = Math.atan2(vy, vx);
        this._drawBarrel();
        new SkillProjectile(
            this.x,
            this.fy,
            vx,
            vy,
            this.def.dmg,
            this.def.pColor,
            this.def.pSize,
            this.def.aoe,
            this.def.status,
        );
        playLaunch(this.type === TOWER.CANNON);
        triggerShake(this.type === TOWER.CANNON ? 7 : 3);
    }

    _drawBody() {
        const g = this.bodyGfx,
            d = this.def;
        g.clear();
        // At higher levels the body gets a gold border
        const borderColor = this.level === 3 ? 0xffcc00 : this.level === 2 ? 0xaaddff : 0x111122;
        const borderAlpha = this.level > 1 ? 1.0 : 0.6;
        // Shadow
        g.beginFill(0x000000, 0.25);
        g.drawEllipse(0, 5, 25, 10);
        g.endFill();
        // Base
        g.lineStyle(2, borderColor, borderAlpha);
        g.beginFill(0x222233);
        g.drawRoundedRect(-22, -48, 44, 48, 6);
        g.endFill();
        g.beginFill(d.color);
        g.drawRoundedRect(-17, -43, 34, 38, 5);
        g.endFill();
        g.beginFill(d.accent, 0.7);
        g.drawRoundedRect(-12, -43, 24, 12, 3);
        g.endFill();
        // Emblem
        g.lineStyle(0);
        g.beginFill(0xffffff, 0.5);
        g.drawCircle(0, -25, 6);
        g.endFill();
        g.beginFill(d.accent);
        g.drawCircle(0, -25, 4);
        g.endFill();
        // Level pips (small dots at the bottom of the body)
        for (let i = 0; i < this.level; i++) {
            const pipColor = i === 0 ? 0xffffff : i === 1 ? 0xffee44 : 0xff8800;
            g.beginFill(pipColor, 0.9);
            g.drawCircle(-6 + i * 6, -8, 3.5);
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
        const isAbove = this.y < 150; // near top → button goes below, else goes above
        const btnY = isAbove ? 60 : -60;

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
        g.lineStyle(this.type === TOWER.CANNON ? 8 : 5, d.accent, 0.95);
        const len = this.type === TOWER.CANNON ? 32 : 25;
        g.moveTo(0, -25);
        g.lineTo(Math.cos(this.barrelAngle) * len, -25 + Math.sin(this.barrelAngle) * len);
    }

    _drawCooldown() {
        const g = this.cdGfx,
            d = this.def;
        g.clear();
        const ratio = this.cooldown / d.recharge;
        if (ratio <= 0) {
            // Ready — green ring
            g.lineStyle(3, 0x44ff44, 0.9);
            g.drawCircle(0, -22, 25);
        } else {
            // Cooldown arc — red that fills back to green
            const startAng = -Math.PI / 2;
            const endAng = startAng + (1 - ratio) * Math.PI * 2;
            g.lineStyle(3, 0xff3322, 0.7);
            g.arc(0, -22, 25, startAng, startAng + Math.PI * 2); // full dim ring
            g.lineStyle(3, 0x44ff44, 0.9);
            if (endAng > startAng) g.arc(0, -22, 25, startAng, endAng); // filled portion
        }
        // Cooldown bar below tower
        if (ratio > 0) {
            g.lineStyle(0);
            g.beginFill(0x333333, 0.8);
            g.drawRect(-18, 4, 36, 5);
            g.endFill();
            const barColor = ratio > 0.6 ? 0xff3322 : ratio > 0.3 ? 0xffaa00 : 0x44ff44;
            g.beginFill(barColor);
            g.drawRect(-18, 4, 36 * (1 - ratio), 5);
            g.endFill();
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

// ── Unified skill projectile ───────────────────────────────────
class SkillProjectile {
    constructor(x, y, vx, vy, dmg = 1, color = 0xff3311, size = 14, aoe = 0, status = null) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.dmg = dmg;
        this.color = color;
        this.size = size;
        this.aoe = aoe;
        this.status = status;
        this.alive = true;
        this.age = 0;
        this.trail = [];

        this.ctr = new PIXI.Container();
        const glow = new PIXI.Graphics();
        glow.beginFill(color, 0.25);
        glow.drawCircle(0, 0, size * 2);
        glow.endFill();
        const core = new PIXI.Graphics();
        core.beginFill(color);
        core.drawCircle(0, 0, size);
        core.endFill();
        // Highlight
        const hi = new PIXI.Graphics();
        hi.beginFill(0xffffff, 0.4);
        hi.drawCircle(-size * 0.3, -size * 0.3, size * 0.35);
        hi.endFill();
        this.ctr.addChild(glow);
        this.ctr.addChild(core);
        this.ctr.addChild(hi);
        this.core = core;
        this.glow = glow;
        this.hi = hi;
        this.trailCtr = new PIXI.Container();
        projLayer.addChildAt(this.trailCtr, 0);
        projLayer.addChild(this.ctr);
        projectiles.push(this);
    }

    update(dt) {
        this.vy += GRAVITY * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.age += dt;
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 18) this.trail.shift();
        this.trailCtr.removeChildren();
        this.trail.forEach((t, i) => {
            const tg = new PIXI.Graphics();
            const a = (i / this.trail.length) * 0.45;
            const sz = (i / this.trail.length) * this.size * 0.85 + 1;
            tg.beginFill(this.color, a);
            tg.drawCircle(0, 0, sz);
            tg.endFill();
            tg.x = t.x;
            tg.y = t.y;
            this.trailCtr.addChild(tg);
        });
        this.ctr.x = this.x;
        this.ctr.y = this.y;
        this.core.rotation += 0.16;
        this.hi.rotation -= 0.09; // glare orbits opposite direction
        this.glow.scale.set(0.85 + Math.sin(this.age * 12) * 0.15);
        return this._checkHit();
    }

    _checkHit() {
        if (this.y > H - SHOP_H + 10 || this.x < -60 || this.x > W + 100) {
            if (this.aoe > 0) this._explode();
            else this._kill(false);
            return false;
        }
        for (const e of enemies) {
            if (!e.alive) continue;
            const dx = this.x - e.x,
                dy = this.y - (e.y - e.h / 2);
            if (Math.abs(dx) < e.w / 2 + this.size && Math.abs(dy) < e.h / 2 + this.size) {
                if (this.aoe > 0) {
                    this._explode();
                    return false;
                }
                const killed = e.hit(this.dmg, this.status);
                triggerShake(killed ? 20 : 7);
                burst(this.x, this.y, this.color, killed ? 20 : 8, killed);
                this._kill(true);
                return false;
            }
        }
        return true;
    }

    _explode() {
        // AoE — damage + status every enemy within blast radius
        let anyKill = false;
        for (const e of enemies) {
            if (!e.alive) continue;
            const dx = this.x - e.x,
                dy = this.y - (e.y - e.h / 2);
            if (Math.sqrt(dx * dx + dy * dy) < this.aoe + e.w / 2) {
                const killed = e.hit(this.dmg, this.status);
                if (killed) anyKill = true;
                e.applyStatus(this.status);
                e.shakeX = (Math.random() - 0.5) * 24;
                e.shakeY = (Math.random() - 0.5) * 14;
            }
        }
        triggerShake(anyKill ? 22 : 12);
        playHit(true);
        burst(this.x, this.y, this.color, 28, true);
        // Blast ring — colour reflects element
        const ringColor =
            this.status?.type === STATUS.SLOW
                ? 0x66eeff
                : this.status?.type === STATUS.BURN
                  ? 0xff5500
                  : 0xff8800;
        const blastRing = new PIXI.Graphics();
        blastRing.lineStyle(4, ringColor, 1);
        blastRing.drawCircle(0, 0, this.aoe);
        blastRing.x = this.x;
        blastRing.y = this.y;
        fxLayer.addChild(blastRing);
        let rf = 0;
        const go = () => {
            rf++;
            blastRing.scale.set(1 + rf * 0.06);
            blastRing.alpha = 1 - rf / 18;
            rf < 18 ? requestAnimationFrame(go) : blastRing.destroy();
        };
        go();
        this._kill(true);
    }
    _kill(hit) {
        this.alive = false;
        if (!hit) {
            playHit(false);
            burst(this.x, this.y, 0x888888, 5);
        }
        this.ctr.destroy();
        this.trailCtr.destroy();
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
    if (gameOver || phase !== PHASE.BUILD) return;
    if (!canPlaceTower(wx, wy)) {
        spawnFloatText('Can\'t build here!', wx, wy - 30, 0xff4444);
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
        const ax = PATH_PTS[i].x, ay = PATH_PTS[i].y;
        const bx = PATH_PTS[i+1].x, by = PATH_PTS[i+1].y;
        const abx = bx-ax, aby = by-ay, len2 = abx*abx + aby*aby;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px-ax)*abx + (py-ay)*aby) / len2)) : 0;
        const d = Math.hypot(px - (ax + t*abx), py - (ay + t*aby));
        if (d < min) min = d;
    }
    return min;
}

function canPlaceTower(px, py) {
    if (distToPath(px, py) < MIN_TOWER_PATH_DIST) return false;
    if (py > H - SHOP_H - 10) return false; // in shop area
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

// Stage pointerdown — slingshot disabled; towers intercept their own events
app.stage.on('pointerdown', (e) => {
    if (gameOver || isAiming) return;
    AC.resume();
    if (phase === PHASE.BUILD) {
        const p = toWorld(e.global.x, e.global.y);
        onGroundClick(p.x, p.y);
    }
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
app.stage.on('pointerup', () => onUp());
app.stage.on('pointerupoutside', () => onUp());

function onUp() {
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
    const dx = anchor.x - dragPos.x,
        dy = anchor.y - dragPos.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) {
        dragPos = null;
        activeShooter = null;
        return;
    }
    dist = Math.min(dist, MAX_PULL);
    const ang = Math.atan2(dy, dx);
    const vx = Math.cos(ang) * LAUNCH_SPD * (dist / MAX_PULL);
    const vy = Math.sin(ang) * LAUNCH_SPD * (dist / MAX_PULL);

    if (activeShooter instanceof Tower) {
        activeShooter.fire(vx, vy);
    } else {
        // Slingshot
        if (slShotCD > 0) {
            dragPos = null;
            activeShooter = null;
            return;
        }
        new SkillProjectile(SL_ANCHOR.x, SL_ANCHOR.y, vx, vy, 1, 0xff3311, 14);
        slShotCD = SL_SHOT_CD;
        playLaunch(false);
        triggerShake(4);
    }

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
        const rdx = dragPos.x - anchor.x,
            rdy = dragPos.y - anchor.y;
        let rdist = Math.sqrt(rdx * rdx + rdy * rdy);
        let cx = dragPos.x,
            cy = dragPos.y;
        if (rdist > MAX_PULL) {
            cx = anchor.x + (rdx / rdist) * MAX_PULL;
            cy = anchor.y + (rdy / rdist) * MAX_PULL;
            rdist = MAX_PULL;
        }
        const pwr = rdist / MAX_PULL;
        if (Math.abs(pwr - lastAimPow) > 0.06) {
            playAimTick(pwr);
            lastAimPow = pwr;
        }

        // Power bar — positioned above anchor
        pwrBg.clear();
        pwrBg.beginFill(0x000000, 0.5);
        pwrBg.drawRoundedRect(anchor.x - 50, anchor.y - 155, 100, 12, 6);
        pwrBg.endFill();
        pwrFill.clear();
        pwrFill.beginFill(pwr < 0.4 ? 0x44dd44 : pwr < 0.72 ? 0xffaa00 : 0xff2200);
        pwrFill.drawRoundedRect(anchor.x - 48, anchor.y - 153, 96 * pwr, 8, 4);
        pwrFill.endFill();

        // Aim ring around anchor
        aimRing.clear();
        aimRing.lineStyle(2, 0xffffff, 0.18 + Math.sin(now * 0.006) * 0.12);
        aimRing.drawCircle(anchor.x, anchor.y, MAX_PULL);
        aimRing.visible = true;

        if (!activeShooter) {
            // SLINGSHOT — rubber band visual
            rubberBand.clear();
            aimLine.clear();
            rubberBand.lineStyle(4, 0xe8b840, 0.95);
            rubberBand.moveTo(SL_FORK_L.x, SL_FORK_L.y);
            rubberBand.lineTo(cx, cy);
            rubberBand.moveTo(SL_FORK_R.x, SL_FORK_R.y);
            rubberBand.lineTo(cx, cy);
            rubberBand.lineStyle(0);
            rubberBand.beginFill(0x000000, 0.2);
            rubberBand.drawCircle(cx + 3, cy + 4, 14);
            rubberBand.endFill();
            rubberBand.beginFill(0xff3311);
            rubberBand.drawCircle(cx, cy, 14);
            rubberBand.endFill();
            rubberBand.beginFill(0xff8855);
            rubberBand.drawCircle(cx - 4, cy - 4, 5);
            rubberBand.endFill();
        } else {
            // TOWER — directional pull line
            rubberBand.clear();
            const def = activeShooter.def;
            aimLine.clear();
            aimLine.lineStyle(3, def.accent, 0.7);
            aimLine.moveTo(anchor.x, anchor.y);
            aimLine.lineTo(cx, cy);
            aimLine.lineStyle(0);
            aimLine.beginFill(0x000000, 0.2);
            aimLine.drawCircle(cx + 2, cy + 3, def.pSize);
            aimLine.endFill();
            aimLine.beginFill(def.pColor);
            aimLine.drawCircle(cx, cy, def.pSize);
            aimLine.endFill();
            aimLine.beginFill(0xffffff, 0.3);
            aimLine.drawCircle(cx - def.pSize * 0.3, cy - def.pSize * 0.3, def.pSize * 0.35);
            aimLine.endFill();
        }

        // Trajectory
        const ldx = anchor.x - cx,
            ldy = anchor.y - cy;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy);
        const la = Math.atan2(ldy, ldx);
        const spd = (ld / MAX_PULL) * LAUNCH_SPD;
        const pts = computeTraj(anchor.x, anchor.y, Math.cos(la) * spd, Math.sin(la) * spd, TDOT_N);
        for (let i = 0; i < TDOT_N; i++) {
            if (i < pts.length) {
                trajDots[i].x = pts[i].x;
                trajDots[i].y = pts[i].y;
                trajDots[i].visible = true;
                trajDots[i].alpha = (1 - i / pts.length) * 0.88;
                trajDots[i].scale.set(Math.max(1 - i * 0.022, 0.12));
            } else trajDots[i].visible = false;
        }
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
