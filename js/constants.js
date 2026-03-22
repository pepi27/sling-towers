// ============================================================
//  TOWER SIEGE — Constants & Definitions
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

// ── Path utilities (needed early for background tree placement) ─
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
