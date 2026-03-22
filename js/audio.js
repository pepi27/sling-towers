// ── Audio ─────────────────────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();
const _sfx = (fn) => {
    try {
        fn();
    } catch (e) {}
};

function playLaunch(big) {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = big ? 'square' : 'sawtooth';
        o.frequency.setValueAtTime(big ? 220 : 360, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(big ? 40 : 75, AC.currentTime + 0.35);
        g.gain.setValueAtTime(big ? 0.55 : 0.4, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.35);
        o.start();
        o.stop(AC.currentTime + 0.35);
    });
}

function playHit(big) {
    _sfx(() => {
        const len = big ? 0.34 : 0.17;
        const buf = AC.createBuffer(1, ~~(AC.sampleRate * len), AC.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = AC.createBufferSource();
        src.buffer = buf;
        const flt = AC.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = big ? 550 : 260;
        const g = AC.createGain();
        g.gain.setValueAtTime(big ? 0.9 : 0.45, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
        src.connect(flt);
        flt.connect(g);
        g.connect(AC.destination);
        src.start();
        src.stop(AC.currentTime + len);
        if (big) {
            const o2 = AC.createOscillator(),
                g2 = AC.createGain();
            o2.connect(g2);
            g2.connect(AC.destination);
            o2.type = 'sine';
            o2.frequency.setValueAtTime(85, AC.currentTime);
            o2.frequency.exponentialRampToValueAtTime(22, AC.currentTime + 0.4);
            g2.gain.setValueAtTime(0.55, AC.currentTime);
            g2.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.4);
            o2.start();
            o2.stop(AC.currentTime + 0.4);
        }
    });
}

function playCoin() {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(960, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(1350, AC.currentTime + 0.09);
        g.gain.setValueAtTime(0.13, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.14);
        o.start();
        o.stop(AC.currentTime + 0.14);
    });
}

function playAimTick(p) {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.frequency.value = 190 + p * 560;
        g.gain.setValueAtTime(0.07, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.06);
        o.start();
        o.stop(AC.currentTime + 0.06);
    });
}

function playTowerReady() {
    _sfx(() => {
        const o = AC.createOscillator(),
            g = AC.createGain();
        o.connect(g);
        g.connect(AC.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(440, AC.currentTime);
        o.frequency.exponentialRampToValueAtTime(880, AC.currentTime + 0.12);
        g.gain.setValueAtTime(0.1, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.18);
        o.start();
        o.stop(AC.currentTime + 0.18);
    });
}
