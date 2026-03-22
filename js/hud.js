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
