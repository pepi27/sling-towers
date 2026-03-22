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
                else e.applyStatus(this.status);
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
