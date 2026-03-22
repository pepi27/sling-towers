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
