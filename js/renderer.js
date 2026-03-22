// ── Pixi init ─────────────────────────────────────────────────
const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundColor: 0x060e04,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
});
document.getElementById('game-container').appendChild(app.view);
app.view.style.display = 'block';
const slowOverlay = document.getElementById('slow-overlay');

// Layers
const worldLayer = new PIXI.Container();
const bgLayer = new PIXI.Container();
const terrainLayer = new PIXI.Container(); // path, trees, fort — zooms with worldLayer
const slotLayer = new PIXI.Container();
const towerLayer = new PIXI.Container();
const enemyLayer = new PIXI.Container();
const coinLayer = new PIXI.Container();
const projLayer = new PIXI.Container();
const fxLayer = new PIXI.Container();
const aimLayer = new PIXI.Container();
const uiLayer = new PIXI.Container();

// bgLayer holds only solid background — un-zoomed, no edge gaps
app.stage.addChild(bgLayer);
app.stage.addChild(worldLayer);
[terrainLayer, slotLayer, towerLayer, enemyLayer, coinLayer, projLayer, fxLayer, aimLayer].forEach(
    (l) => worldLayer.addChild(l),
);
app.stage.addChild(uiLayer);

// Zoom: scale worldLayer around the centre of the play area
worldLayer.pivot.set(WL_CX, WL_CY);
worldLayer.position.set(WL_CX, WL_CY);
worldLayer.scale.set(ZOOM);

// Use Pixi event system on stage (so coins/towers can stopPropagation)
app.stage.eventMode = 'static';
app.stage.hitArea = new PIXI.Rectangle(0, 0, W, H);
