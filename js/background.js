// ── Background ────────────────────────────────────────────────
(function drawBG() {
    // ── Solid background in bgLayer (un-zoomed, fills canvas) ──
    const g = new PIXI.Graphics();
    g.beginFill(0x0a1406);
    g.drawRect(0, 0, W, H);
    g.endFill();
    g.beginFill(0x1a4a0e);
    g.drawRect(0, 0, W, H - SHOP_H);
    g.endFill();
    for (let i = 0; i < 50; i++) {
        g.beginFill(0x155a0a, 0.4 + Math.random() * 0.3);
        g.drawEllipse(
            Math.random() * W,
            Math.random() * (H - SHOP_H),
            40 + Math.random() * 60,
            20 + Math.random() * 30,
        );
        g.endFill();
    }
    g.beginFill(0x08080f);
    g.drawRect(0, H - SHOP_H, W, SHOP_H);
    g.endFill();
    g.lineStyle(1, 0x333355, 0.8);
    g.moveTo(0, H - SHOP_H);
    g.lineTo(W, H - SHOP_H);
    bgLayer.addChild(g);

    // ── Path, trees, fort in terrainLayer (zooms with worldLayer) ──

    // Dirt path
    const drawPathLine = (width, color, alpha) => {
        const pg = new PIXI.Graphics();
        pg.lineStyle({ width, color, alpha, join: 'round', cap: 'round' });
        pg.moveTo(PATH_PTS[0].x, PATH_PTS[0].y);
        for (let i = 1; i < PATH_PTS.length; i++) pg.lineTo(PATH_PTS[i].x, PATH_PTS[i].y);
        terrainLayer.addChild(pg);
    };
    drawPathLine(60, 0x3a2008, 0.5);
    drawPathLine(48, 0x8a6420, 1.0);
    drawPathLine(18, 0xaa7e2a, 0.45);

    // Scattered trees — skip any too close to the path
    const treeXY = [
        [50, 70],
        [660, 80],
        [45, 280],
        [665, 310],
        [50, 490],
        [660, 530],
        [48, 710],
        [660, 740],
        [50, 930],
        [650, 900],
        [52, 1080],
        [645, 1050],
        [110, 160],
        [600, 190],
        [115, 590],
        [595, 620],
        [105, 820],
        [590, 790],
        [180, 380],
        [530, 400],
        [200, 980],
        [510, 960],
    ];
    treeXY.forEach(([tx, ty]) => {
        if (distToPath(tx, ty) < 100) return; // don't place on path
        const t = new PIXI.Graphics();
        t.beginFill(0x0a1a06, 0.5);
        t.drawCircle(4, 5, 22);
        t.endFill();
        t.beginFill(0x1e5010);
        t.drawCircle(0, 0, 20);
        t.endFill();
        t.beginFill(0x2a7018);
        t.drawCircle(-4, -4, 13);
        t.endFill();
        t.beginFill(0x3a8020);
        t.drawCircle(3, -6, 8);
        t.endFill();
        t.x = tx;
        t.y = ty;
        terrainLayer.addChild(t);
    });

    // Base fort at path end
    const ep = PATH_CTRL[PATH_CTRL.length - 1];
    const fort = new PIXI.Graphics();
    fort.beginFill(0x222233);
    fort.drawCircle(ep.x, ep.y, 42);
    fort.endFill();
    fort.lineStyle(4, 0x5566aa, 0.9);
    fort.drawCircle(ep.x, ep.y, 42);
    fort.beginFill(0x3a3a55);
    fort.drawCircle(ep.x, ep.y, 30);
    fort.endFill();
    fort.beginFill(0xee2222, 0.9);
    fort.drawCircle(ep.x, ep.y, 8);
    fort.endFill();
    for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        fort.beginFill(0x4a4a66);
        fort.drawCircle(ep.x + Math.cos(ang) * 42, ep.y + Math.sin(ang) * 42, 7);
        fort.endFill();
    }
    terrainLayer.addChild(fort);
})();
