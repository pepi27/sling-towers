// ── Wave system ───────────────────────────────────────────────
function buildWave(n) {
    const q = [],
        base = 7 + n * 4;
    for (let i = 0; i < base; i++) {
        let type = ENEMY.GRUNT;
        if (n >= 2 && i % 3 === 1) type = ENEMY.ARMORED;
        if (n >= 2 && i % 5 === 2) type = ENEMY.FAST;
        if (n >= 2 && i % 6 === 3) type = ENEMY.ICE;
        if (n >= 3 && i % 6 === 4) type = ENEMY.FIRE;
        if (n >= 3 && i === Math.floor(base / 2)) type = ENEMY.BOSS;
        q.push(type);
    }
    return q;
}
function startWave() {
    if (phase !== PHASE.BUILD || gameOver) return;
    waveNum++;
    phase = PHASE.WAVE;
    waveQueue = buildWave(waveNum);
    waveAlive = waveQueue.length;
    waveSpawnT = 0;
    updateHUD();
    spawnFloatText(`Wave ${waveNum}!`, W / 2, H / 2 - 80, 0xff8844);
}
function onGroundClick(wx, wy) {
    if (gameOver) return;
    if (!canPlaceTower(wx, wy)) {
        spawnFloatText("Can't build here!", wx, wy - 30, 0xff4444);
        return;
    }
    const def = TDEFS[selectedType];
    if (gold < def.cost) {
        spawnFloatText('Not enough gold!', wx, wy - 30, 0xff4444);
        return;
    }
    gold -= def.cost;
    updateHUD();
    new Tower(wx, wy, selectedType);
    spawnFloatText(`-${def.cost}g`, wx, wy - 30, 0xffdd44);
    ghostGfx.clear();
}
