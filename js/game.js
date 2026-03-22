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

    // FPS counter
    if (fpsVisible) {
        fpsAccum += rawDt;
        fpsFrames++;
        if (fpsAccum >= 0.5) {
            fpsDisplay = Math.round(fpsFrames / fpsAccum);
            fpsFrames = 0; fpsAccum = 0;
        }
        fpsTxt.text = `${fpsDisplay} fps`;
    }

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
