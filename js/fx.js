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

// ── Coin textures — rendered once, reused as Sprites for batching ──
let _coinBodyTex = null;
let _coinGlowTex = null;
function _ensureCoinTextures() {
    if (_coinBodyTex) return;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xffdd00);
    bg.drawCircle(0, 0, 9);
    bg.endFill();
    bg.beginFill(0xffbb00);
    bg.drawCircle(1, -1, 5);
    bg.endFill();
    bg.lineStyle(2, 0xcc8800);
    bg.drawCircle(0, 0, 9);
    _coinBodyTex = app.renderer.generateTexture(bg, { resolution: 2 });
    bg.destroy();

    const gg = new PIXI.Graphics();
    gg.beginFill(0xffdd00, 1.0);
    gg.drawCircle(0, 0, 18);
    gg.endFill();
    _coinGlowTex = app.renderer.generateTexture(gg, { resolution: 1 });
    gg.destroy();
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

        _ensureCoinTextures();

        // Glow sprite (behind coin) — same texture, batched
        const glow = new PIXI.Sprite(_coinGlowTex);
        glow.anchor.set(0.5);
        glow.alpha = 0.35;
        this.glowGfx = glow;
        coinLayer.addChild(glow);

        // Coin body sprite — same texture, batched; hitArea for clicking
        const g = new PIXI.Sprite(_coinBodyTex);
        g.anchor.set(0.5);
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.hitArea = new PIXI.Circle(0, 0, 22);
        g.on('pointerdown', (e) => {
            e.stopPropagation();
            this.collect();
        });
        this.gfx = g;
        coinLayer.addChild(g);

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

        // Pulsing glow
        const p = (0.3 + Math.sin(this.age * 4 + this.id) * 0.25) * 0.35;
        this.glowGfx.alpha = p;

        return true; // stays until clicked
    }
}

// ── Particle textures — rendered once, reused with tinting for batching ──
let _particleCircleTex = null;
let _particleSquareTex = null;
function _ensureParticleTex() {
    if (_particleCircleTex) return;
    const gc = new PIXI.Graphics();
    gc.beginFill(0xffffff);
    gc.drawCircle(0, 0, 8);
    gc.endFill();
    _particleCircleTex = app.renderer.generateTexture(gc, { resolution: 1 });
    gc.destroy();
    const gs = new PIXI.Graphics();
    gs.beginFill(0xffffff);
    gs.drawRect(-8, -8, 16, 16);
    gs.endFill();
    _particleSquareTex = app.renderer.generateTexture(gs, { resolution: 1 });
    gs.destroy();
}

const MAX_PARTICLES = 220;

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

        _ensureParticleTex();
        // Sprite + tint: all particles share the same 2 textures → single batched draw call
        const g = new PIXI.Sprite(this.sq ? _particleSquareTex : _particleCircleTex);
        g.anchor.set(0.5);
        g.tint = color;
        g.scale.set(this.sz / 8);
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
    const budget = MAX_PARTICLES - particles.length;
    if (budget <= 0) return;
    const n = Math.min(count, budget);
    for (let i = 0; i < n; i++) new Particle(x, y, color, big);
    const nw = Math.min(big ? 10 : 4, MAX_PARTICLES - particles.length);
    for (let i = 0; i < nw; i++) new Particle(x, y, 0xffffff, big);
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
