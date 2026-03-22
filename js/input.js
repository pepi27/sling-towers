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
