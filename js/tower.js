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
