// 侵略者だ！ — Space-Invaders-style shooter (vanilla JS, canvas)
(() => {
  'use strict';

  const W = 360, H = 480;
  const ROWS = 5, COLS = 10;
  const INV_W = 22, INV_H = 16, INV_GAP_X = 8, INV_GAP_Y = 10;
  const PLAYER_Y = H - 40;
  const PLAYER_SPEED = 3.4;
  const BULLET_SPEED = 6;
  const ENEMY_BULLET_SPEED = 2.6;
  const FORMATION_W = COLS * (INV_W + INV_GAP_X) - INV_GAP_X;

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = $('score'), waveEl = $('wave'), livesEl = $('lives');
  const banner = $('banner'), bannerText = $('banner-text');
  const startOv = $('start-overlay'), endOv = $('end-overlay');
  const endTitle = $('end-title'), endScore = $('end-score'), endWave = $('end-wave');
  const btnStart = $('btn-start'), btnAgain = $('btn-again'), btnRestart = $('btn-restart'), btnMute = $('btn-mute');

  // dpr scaling
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---------- Audio ----------
  const Sound = (() => {
    let ac = null, muted = localStorage.getItem('inv_muted') === '1';
    const en = () => { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
    const beep = (f, d, t = 'square', g = 0.12) => {
      if (muted) return;
      const a = en(); const o = a.createOscillator(); const gn = a.createGain();
      o.type = t; o.frequency.value = f; gn.gain.value = g;
      gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + d);
    };
    const slide = (f1, f2, d, t = 'sawtooth', g = 0.15) => {
      if (muted) return;
      const a = en(); const o = a.createOscillator(); const gn = a.createGain();
      o.type = t; o.frequency.setValueAtTime(f1, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + d);
      gn.gain.value = g; gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + d);
    };
    return {
      prime: en,
      shoot: () => slide(880, 220, 0.12, 'square', 0.13),
      hit:   () => beep(180, 0.1, 'sawtooth', 0.18),
      kill:  () => slide(440, 100, 0.18, 'square', 0.16),
      die:   () => [400, 320, 240, 160].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sawtooth', 0.18), i * 110)),
      win:   () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.18), i * 90)),
      step:  (lo) => beep(lo ? 110 : 130, 0.04, 'square', 0.06),
      ufo:   () => beep(1200, 0.08, 'triangle', 0.1),
      toggle: () => { muted = !muted; localStorage.setItem('inv_muted', muted ? '1' : '0'); return muted; },
      isMuted: () => muted
    };
  })();
  btnMute.textContent = Sound.isMuted() ? 'MUTE' : 'SE';

  // ---------- State ----------
  const state = {
    player: { x: W / 2, y: PLAYER_Y, alive: true, blink: 0 },
    bullet: null,                    // single player bullet
    enemyBullets: [],
    invaders: [],                    // {x,y,col,row,kind,alive}
    invDir: 1,                       // 1 = right, -1 = left
    invDx: 0.4,                      // current step horizontal speed (pixels per "tick")
    invStepTimer: 0,                 // frames between formation movement
    invStepInterval: 28,             // initial; decreases as fewer alive
    stepLowToggle: false,
    ufo: null,                       // {x, y, dir}
    score: 0, best: +(localStorage.getItem('inv_best') || 0),
    wave: 1, lives: 3,
    over: false, paused: true,
    readyUntil: 0, dyingUntil: 0,
    keys: { left: false, right: false, fire: false }
  };

  function spawnWave() {
    state.invaders = [];
    const startX = (W - FORMATION_W) / 2 + INV_W / 2;
    const startY = 50;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // top row = 30pt, middle 2 = 20pt, bottom 2 = 10pt (classic-ish)
        const kind = r === 0 ? 'top' : r < 3 ? 'mid' : 'bot';
        state.invaders.push({
          x: startX + c * (INV_W + INV_GAP_X),
          y: startY + r * (INV_H + INV_GAP_Y),
          col: c, row: r, kind,
          alive: true,
          points: kind === 'top' ? 30 : kind === 'mid' ? 20 : 10
        });
      }
    }
    state.invDir = 1;
    state.invDx = 0.6;
    state.invStepTimer = 0;
    state.invStepInterval = Math.max(8, 28 - state.wave * 2);
    state.enemyBullets = [];
    state.bullet = null;
    state.ufo = null;
    state.player.x = W / 2;
    state.player.alive = true;
    state.readyUntil = performance.now() + 1200;
    state.paused = false;
    showBanner('READY', '');
  }

  function resetGame() {
    state.score = 0;
    state.wave = 1;
    state.lives = 3;
    state.over = false;
    spawnWave();
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = state.score;
    waveEl.textContent = state.wave;
    livesEl.textContent = state.lives;
  }

  function showBanner(txt, cls) {
    bannerText.textContent = txt;
    banner.classList.remove('go', 'win');
    if (cls) banner.classList.add(cls);
    banner.classList.add('show');
  }
  function hideBanner() { banner.classList.remove('show'); }

  // ---------- Update ----------
  function update() {
    const now = performance.now();
    if (state.paused || state.over) return;
    if (now < state.readyUntil) return;
    if (state.dyingUntil && now < state.dyingUntil) return;
    if (state.dyingUntil && now >= state.dyingUntil) {
      state.dyingUntil = 0;
      if (state.lives <= 0) { gameOver(); return; }
      hideBanner();
    }

    // Player movement
    if (state.player.alive) {
      if (state.keys.left)  state.player.x -= PLAYER_SPEED;
      if (state.keys.right) state.player.x += PLAYER_SPEED;
      state.player.x = Math.max(16, Math.min(W - 16, state.player.x));
    }

    // Player bullet
    if (state.bullet) {
      state.bullet.y -= BULLET_SPEED;
      if (state.bullet.y < -10) state.bullet = null;
    }

    // Invader formation step
    state.invStepTimer++;
    const aliveCount = state.invaders.filter((i) => i.alive).length;
    const interval = Math.max(4, state.invStepInterval - Math.floor((COLS * ROWS - aliveCount) * 0.4));
    if (state.invStepTimer >= interval) {
      state.invStepTimer = 0;
      stepInvaders();
      Sound.step(state.stepLowToggle);
      state.stepLowToggle = !state.stepLowToggle;
    }

    // Enemies fire occasionally — pick a random alive invader from the bottom of each column
    if (Math.random() < 0.02 + state.wave * 0.005) {
      const shooters = bottomShooters();
      if (shooters.length > 0) {
        const s = shooters[Math.floor(Math.random() * shooters.length)];
        state.enemyBullets.push({ x: s.x, y: s.y + INV_H / 2 });
      }
    }
    // Move enemy bullets
    for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
      const b = state.enemyBullets[i];
      b.y += ENEMY_BULLET_SPEED;
      if (b.y > H) state.enemyBullets.splice(i, 1);
    }

    // UFO occasionally
    if (!state.ufo && Math.random() < 0.0015) {
      const left = Math.random() < 0.5;
      state.ufo = { x: left ? -20 : W + 20, y: 24, dir: left ? 1 : -1 };
      Sound.ufo();
    }
    if (state.ufo) {
      state.ufo.x += state.ufo.dir * 1.2;
      if (state.ufo.x < -30 || state.ufo.x > W + 30) state.ufo = null;
    }

    // Collisions: player bullet vs invaders / ufo
    if (state.bullet) {
      const bx = state.bullet.x, by = state.bullet.y;
      for (const inv of state.invaders) {
        if (!inv.alive) continue;
        if (Math.abs(bx - inv.x) < INV_W / 2 && Math.abs(by - inv.y) < INV_H / 2) {
          inv.alive = false;
          state.score += inv.points;
          Sound.kill();
          state.bullet = null;
          break;
        }
      }
      if (state.bullet && state.ufo) {
        if (Math.abs(bx - state.ufo.x) < 18 && Math.abs(by - state.ufo.y) < 8) {
          state.score += 100 + Math.floor(Math.random() * 4) * 50; // 100/150/200/250
          state.ufo = null;
          state.bullet = null;
          Sound.win();
        }
      }
    }

    // Enemy bullets vs player
    for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
      const b = state.enemyBullets[i];
      if (state.player.alive && Math.abs(b.x - state.player.x) < 14 && Math.abs(b.y - state.player.y) < 8) {
        state.enemyBullets.splice(i, 1);
        playerHit();
        break;
      }
    }

    // Win condition
    if (state.invaders.every((i) => !i.alive)) {
      state.paused = true;
      Sound.win();
      showBanner('CLEAR!', 'win');
      setTimeout(() => {
        hideBanner();
        state.wave++;
        state.score += 100;
        spawnWave();
        updateHud();
      }, 1400);
    }

    // Lose if invaders reach the player line
    if (state.invaders.some((i) => i.alive && i.y + INV_H / 2 >= PLAYER_Y - 8)) {
      gameOver();
    }
  }

  function bottomShooters() {
    const byCol = new Map();
    for (const inv of state.invaders) {
      if (!inv.alive) continue;
      const cur = byCol.get(inv.col);
      if (!cur || inv.y > cur.y) byCol.set(inv.col, inv);
    }
    return Array.from(byCol.values());
  }

  function stepInvaders() {
    let minX = Infinity, maxX = -Infinity;
    for (const inv of state.invaders) {
      if (!inv.alive) continue;
      if (inv.x < minX) minX = inv.x;
      if (inv.x > maxX) maxX = inv.x;
    }
    let stepDown = false;
    if (state.invDir > 0 && maxX + state.invDx + INV_W / 2 > W - 6) stepDown = true;
    if (state.invDir < 0 && minX - state.invDx - INV_W / 2 < 6) stepDown = true;
    if (stepDown) {
      for (const inv of state.invaders) inv.y += 6;
      state.invDir *= -1;
      state.invDx = Math.min(2.4, state.invDx + 0.05);
    } else {
      const dx = state.invDir * state.invDx;
      for (const inv of state.invaders) inv.x += dx;
    }
  }

  function fire() {
    if (state.over || !state.player.alive || state.bullet) return;
    if (performance.now() < state.readyUntil) return;
    state.bullet = { x: state.player.x, y: state.player.y - 14 };
    Sound.shoot();
  }

  function playerHit() {
    if (!state.player.alive || state.dyingUntil) return;
    state.player.alive = false;
    state.lives--;
    Sound.die();
    showBanner('やられた…', 'go');
    state.dyingUntil = performance.now() + 1200;
    setTimeout(() => {
      state.player.alive = true;
      state.player.x = W / 2;
      hideBanner();
      updateHud();
    }, 1200);
  }

  function gameOver() {
    state.over = true;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('inv_best', String(state.best));
    }
    endTitle.textContent = 'GAME OVER';
    endScore.textContent = state.score;
    endWave.textContent = state.wave;
    endOv.classList.add('show');
  }

  // ---------- Render ----------
  // 8x6 pixel sprites for each invader kind, two-frame animation
  const SPRITES = {
    top: [
      // frame 0
      [
        '..XXXX..',
        '.XXXXXX.',
        'XX.XX.XX',
        'XXXXXXXX',
        '.X.XX.X.',
        'X.X..X.X'
      ],
      // frame 1
      [
        '..XXXX..',
        '.XXXXXX.',
        'XX.XX.XX',
        'XXXXXXXX',
        '..X..X..',
        '.X.XX.X.'
      ]
    ],
    mid: [
      [
        '.X....X.',
        'X.X..X.X',
        'X.XXXX.X',
        'XX.XX.XX',
        'XXXXXXXX',
        '.X.XX.X.'
      ],
      [
        '.X....X.',
        '.XX..XX.',
        '.XXXXXX.',
        'XX.XX.XX',
        'XXXXXXXX',
        'X.X..X.X'
      ]
    ],
    bot: [
      [
        '...XX...',
        '..XXXX..',
        '.XXXXXX.',
        'XX.XX.XX',
        'XXXXXXXX',
        '.X.XX.X.'
      ],
      [
        '...XX...',
        '..XXXX..',
        '.XXXXXX.',
        'XX.XX.XX',
        'XXXXXXXX',
        'X......X'
      ]
    ]
  };

  function drawSprite(rows, cx, cy, color, scale = 2.5) {
    ctx.fillStyle = color;
    const w = rows[0].length, h = rows.length;
    const sx = cx - (w * scale) / 2;
    const sy = cy - (h * scale) / 2;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (rows[r][c] === 'X') {
          ctx.fillRect(sx + c * scale, sy + r * scale, scale, scale);
        }
      }
    }
  }

  function drawPlayer(x, y) {
    if (!state.player.alive) {
      // Explosion particles
      ctx.fillStyle = '#ff8';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(x + Math.cos(a) * 12 - 1, y + Math.sin(a) * 12 - 1, 3, 3);
      }
      return;
    }
    ctx.fillStyle = '#0f0';
    // Cannon: tank shape
    ctx.fillRect(x - 14, y + 2, 28, 6);   // base
    ctx.fillRect(x - 10, y - 4, 20, 6);   // mid
    ctx.fillRect(x - 2, y - 10, 4, 6);    // barrel
  }

  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Stars (static-ish)
    ctx.fillStyle = 'rgba(0,255,0,0.25)';
    for (let i = 0; i < 30; i++) {
      const x = (i * 53) % W;
      const y = (i * 97 + ((performance.now() / 60) | 0) * 0.3) % H;
      ctx.fillRect(x, y, 1, 1);
    }

    // Ground line
    ctx.strokeStyle = '#0f0';
    ctx.beginPath();
    ctx.moveTo(0, PLAYER_Y + 14);
    ctx.lineTo(W, PLAYER_Y + 14);
    ctx.stroke();

    // Invaders
    const frame = Math.floor(performance.now() / 350) % 2;
    for (const inv of state.invaders) {
      if (!inv.alive) continue;
      const color = inv.kind === 'top' ? '#0ff' : inv.kind === 'mid' ? '#0f0' : '#fc0';
      drawSprite(SPRITES[inv.kind][frame], inv.x, inv.y, color, 2.4);
    }

    // UFO
    if (state.ufo) {
      ctx.fillStyle = '#f44';
      ctx.fillRect(state.ufo.x - 12, state.ufo.y - 3, 24, 6);
      ctx.fillRect(state.ufo.x - 7, state.ufo.y - 7, 14, 4);
      ctx.fillStyle = '#ff8';
      ctx.fillRect(state.ufo.x - 9, state.ufo.y + 4, 2, 2);
      ctx.fillRect(state.ufo.x + 7, state.ufo.y + 4, 2, 2);
    }

    // Bullets
    if (state.bullet) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(state.bullet.x - 1, state.bullet.y - 5, 2, 10);
    }
    ctx.fillStyle = '#f44';
    for (const b of state.enemyBullets) {
      ctx.fillRect(b.x - 1, b.y - 4, 2, 8);
    }

    // Player
    drawPlayer(state.player.x, state.player.y);
  }

  // ---------- Loop ----------
  function loop() {
    update();
    render();
    updateHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Input ----------
  const press = (act, on) => {
    if (act === 'left')  state.keys.left  = on;
    if (act === 'right') state.keys.right = on;
    if (act === 'fire' && on) fire();
  };
  document.querySelectorAll('.pad-btn').forEach((b) => {
    const act = b.dataset.act;
    const on = (e) => { e.preventDefault(); press(act, true); Sound.prime(); };
    const off = (e) => { e.preventDefault(); press(act, false); };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off, { passive: false });
    b.addEventListener('touchcancel', off);
    b.addEventListener('mousedown', on);
    b.addEventListener('mouseup', off);
    b.addEventListener('mouseleave', off);
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { state.keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { state.keys.right = true; e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar') { fire(); e.preventDefault(); Sound.prime(); }
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') state.keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') state.keys.right = false;
  });

  // Start / restart
  btnStart.addEventListener('click', () => { Sound.prime(); startOv.classList.remove('show'); resetGame(); });
  btnAgain.addEventListener('click', () => { Sound.prime(); endOv.classList.remove('show'); resetGame(); });
  btnRestart.addEventListener('click', () => {
    if (!confirm('リスタートしますか？')) return;
    endOv.classList.remove('show');
    resetGame();
  });
  btnMute.addEventListener('click', () => {
    const m = Sound.toggle();
    btnMute.textContent = m ? 'MUTE' : 'SE';
  });

  // Initial render so the canvas isn't blank behind the start overlay
  spawnWave();
  state.paused = true;
  updateHud();
})();
