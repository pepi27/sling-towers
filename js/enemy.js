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

// ── FPS counter (tap to toggle, or press F) ───────────────────
let fpsVisible = false;
let fpsFrames = 0, fpsAccum = 0, fpsDisplay = 0;
const fpsTxt = new PIXI.Text('', {
    fontFamily: 'monospace',
    fontSize: 13,
    fill: 0x00ff88,
    dropShadow: true, dropShadowBlur: 3, dropShadowColor: 0x000000, dropShadowDistance: 1,
});
fpsTxt.x = W - 60;
fpsTxt.y = 48;
fpsTxt.visible = fpsVisible;
fpsTxt.eventMode = 'static';
fpsTxt.cursor = 'pointer';
fpsTxt.on('pointerdown', (e) => { e.stopPropagation(); fpsVisible = false; fpsTxt.visible = false; });
uiLayer.addChild(fpsTxt);
window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
        fpsVisible = !fpsVisible;
        fpsTxt.visible = fpsVisible;
    }
});

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
