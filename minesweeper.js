/* ============================================================
   TCS Real • Mayın Tarlası
   Tam kapsamlı Minesweeper: zorluk seviyeleri, ilk-tık güvenli,
   flood-fill, bayrak/chord, ipucu, en iyi süreler, ses, animasyonlu
   "videolu" arka plan ve zafer/patlama partikül efektleri.
   ============================================================ */
(() => {
  "use strict";

  /* ---------------- Sabitler ---------------- */
  const LEVELS = {
    beginner:     { w: 9,  h: 9,  mines: 10 },
    intermediate: { w: 16, h: 16, mines: 40 },
    expert:       { w: 30, h: 16, mines: 99 },
  };
  const STORE_KEY = "tcsreal_minesweeper_v1";

  /* ---------------- Durum ---------------- */
  const state = {
    level: "beginner",
    w: 9, h: 9, mines: 10,
    grid: [],            // {mine, adj, open, flag, el}
    started: false,
    over: false,
    won: false,
    flagsUsed: 0,
    revealed: 0,
    time: 0,
    timerId: null,
    flagMode: false,
    hints: 3,
    sound: true,
    theme: 0,
  };
  const THEMES = ["", "theme-aurora", "theme-sunset", "theme-mono"];
  const THEME_NAMES = ["Gece Mavisi", "Aurora", "Gün Batımı", "Mono"];

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const mineCountEl = $("mineCount");
  const timerEl = $("timer");
  const faceEmoji = $("faceEmoji");
  const overlay = $("overlay");

  /* ---------------- Yardımcılar ---------------- */
  const pad3 = (n) => String(Math.max(0, Math.min(999, n))).padStart(3, "0");
  const idx = (x, y) => y * state.w + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < state.w && y < state.h;

  function neighbors(x, y) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (inBounds(x + dx, y + dy)) out.push([x + dx, y + dy]);
      }
    return out;
  }

  /* ---------------- Ses (WebAudio) ---------------- */
  let audioCtx = null;
  function beep(freq, dur = 0.08, type = "sine", gain = 0.08) {
    if (!state.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (_) {}
  }
  const sfx = {
    reveal: () => beep(520, 0.05, "triangle", 0.05),
    flag:   () => beep(700, 0.06, "square", 0.05),
    boom:   () => { beep(90, 0.5, "sawtooth", 0.18); setTimeout(() => beep(60, 0.4, "sawtooth", 0.12), 60); },
    win:    () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, "triangle", 0.12), i * 120)),
    click:  () => beep(330, 0.04, "sine", 0.04),
  };

  /* ---------------- Kayıt / Skor ---------------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (_) { return {}; }
  }
  function saveBest(level, time) {
    const s = loadStore();
    s.best = s.best || {};
    if (!s.best[level] || time < s.best[level]) {
      s.best[level] = time;
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
      return true;
    }
    return false;
  }
  function saveSettings() {
    const s = loadStore();
    s.settings = { sound: state.sound, theme: state.theme, level: state.level };
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  function renderRecords() {
    const s = loadStore();
    const best = s.best || {};
    const list = $("recordList");
    const labels = { beginner: "🌱 Kolay", intermediate: "🔥 Orta", expert: "💀 Uzman" };
    list.innerHTML = "";
    for (const key of ["beginner", "intermediate", "expert"]) {
      const li = document.createElement("li");
      const t = best[key];
      li.innerHTML = `<span>${labels[key]}</span>` +
        (t != null ? `<span class="r-time">${t}s</span>` : `<span class="r-none">—</span>`);
      list.appendChild(li);
    }
  }

  /* ---------------- Tahta kurulumu ---------------- */
  function setLevel(level, custom) {
    state.level = level;
    if (level === "custom" && custom) {
      state.w = custom.w; state.h = custom.h; state.mines = custom.mines;
    } else if (LEVELS[level]) {
      Object.assign(state, LEVELS[level]);
    }
    newGame();
  }

  function newGame() {
    stopTimer();
    state.grid = [];
    state.started = false;
    state.over = false;
    state.won = false;
    state.flagsUsed = 0;
    state.revealed = 0;
    state.time = 0;
    state.hints = 3;
    faceEmoji.textContent = "🙂";
    overlay.hidden = true;
    timerEl.textContent = "000";
    $("hintState").textContent = "3 hak";

    for (let i = 0; i < state.w * state.h; i++) {
      state.grid.push({ mine: false, adj: 0, open: false, flag: false, el: null });
    }
    renderBoard();
    updateMineCount();
  }

  function renderBoard() {
    boardEl.style.gridTemplateColumns = `repeat(${state.w}, var(--cell-size))`;
    // hücre boyutunu ekrana sığacak şekilde ayarla
    const maxW = Math.min(window.innerWidth - 60, 720);
    const size = Math.max(22, Math.min(40, Math.floor(maxW / state.w) - 4));
    boardEl.style.setProperty("--cell-size", size + "px");

    boardEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const cell = state.grid[idx(x, y)];
        const el = document.createElement("button");
        el.className = "cell";
        el.dataset.x = x;
        el.dataset.y = y;
        el.setAttribute("aria-label", `Hücre ${x + 1},${y + 1}`);
        cell.el = el;
        frag.appendChild(el);
      }
    }
    boardEl.appendChild(frag);
  }

  /* Mayınları ilk tıklamadan SONRA yerleştir (ilk tık her zaman güvenli) */
  function placeMines(safeX, safeY) {
    const safe = new Set();
    safe.add(idx(safeX, safeY));
    for (const [nx, ny] of neighbors(safeX, safeY)) safe.add(idx(nx, ny));

    let placed = 0;
    const total = state.w * state.h;
    const maxMines = Math.min(state.mines, total - safe.size);
    while (placed < maxMines) {
      const i = Math.floor(Math.random() * total);
      if (safe.has(i) || state.grid[i].mine) continue;
      state.grid[i].mine = true;
      placed++;
    }
    state.mines = placed;

    // komşu sayılarını hesapla
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const c = state.grid[idx(x, y)];
        if (c.mine) continue;
        c.adj = neighbors(x, y).filter(([nx, ny]) => state.grid[idx(nx, ny)].mine).length;
      }
    }
  }

  /* ---------------- Oyun mantığı ---------------- */
  function startIfNeeded(x, y) {
    if (!state.started) {
      placeMines(x, y);
      state.started = true;
      startTimer();
    }
  }

  function reveal(x, y) {
    if (state.over) return;
    const c = state.grid[idx(x, y)];
    if (c.open || c.flag) return;

    startIfNeeded(x, y);

    if (c.mine) return loseGame(x, y);

    floodReveal(x, y);
    sfx.reveal();
    checkWin();
  }

  function floodReveal(x, y) {
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const c = state.grid[idx(cx, cy)];
      if (c.open || c.flag || c.mine) continue;
      c.open = true;
      state.revealed++;
      paintOpen(c, cx, cy);
      if (c.adj === 0) {
        for (const [nx, ny] of neighbors(cx, cy)) {
          const nc = state.grid[idx(nx, ny)];
          if (!nc.open && !nc.flag && !nc.mine) stack.push([nx, ny]);
        }
      }
    }
  }

  function paintOpen(c, x, y) {
    c.el.classList.add("open");
    c.el.classList.remove("flag", "hint");
    if (c.adj > 0) {
      c.el.textContent = c.adj;
      c.el.classList.add("n" + c.adj);
    } else {
      c.el.textContent = "";
    }
  }

  /* Chord: açık sayıya çift tık → bayrak sayısı eşitse komşuları aç */
  function chord(x, y) {
    const c = state.grid[idx(x, y)];
    if (!c.open || c.adj === 0) return;
    const nb = neighbors(x, y);
    const flags = nb.filter(([nx, ny]) => state.grid[idx(nx, ny)].flag).length;
    if (flags !== c.adj) return;
    for (const [nx, ny] of nb) {
      const nc = state.grid[idx(nx, ny)];
      if (!nc.flag && !nc.open) reveal(nx, ny);
    }
  }

  function toggleFlag(x, y) {
    if (state.over) return;
    const c = state.grid[idx(x, y)];
    if (c.open) return;
    c.flag = !c.flag;
    state.flagsUsed += c.flag ? 1 : -1;
    c.el.classList.toggle("flag", c.flag);
    updateMineCount();
    sfx.flag();
    checkWin();
  }

  function checkWin() {
    if (state.over) return;
    const total = state.w * state.h;
    if (state.revealed === total - state.mines) winGame();
  }

  function winGame() {
    state.over = true;
    state.won = true;
    stopTimer();
    faceEmoji.textContent = "😎";
    // kalan mayınlara bayrak
    for (let i = 0; i < state.grid.length; i++) {
      const c = state.grid[i];
      if (c.mine && !c.flag) { c.flag = true; c.el.classList.add("flag"); }
    }
    state.flagsUsed = state.mines;
    updateMineCount();
    sfx.win();

    const isRecord = state.level !== "custom" && saveBest(state.level, state.time);
    renderRecords();
    confettiBurst();
    showOverlay("win", isRecord);
  }

  function loseGame(bx, by) {
    state.over = true;
    state.won = false;
    stopTimer();
    faceEmoji.textContent = "😵";
    sfx.boom();
    // tüm mayınları göster
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const c = state.grid[idx(x, y)];
        if (c.mine && !c.flag) {
          c.el.classList.add("open", "mine");
          if (x === bx && y === by) c.el.classList.add("boom");
        } else if (c.flag && !c.mine) {
          c.el.classList.add("wrong");
        }
      }
    }
    explosionBurst(bx, by);
    showOverlay("lose", false);
  }

  function showOverlay(type, isRecord) {
    const emoji = $("overlayEmoji");
    const title = $("overlayTitle");
    const sub = $("overlaySub");
    const stats = $("overlayStats");
    if (type === "win") {
      emoji.textContent = isRecord ? "🏆" : "🎉";
      title.textContent = isRecord ? "Yeni Rekor!" : "Kazandın!";
      sub.textContent = isRecord ? "En iyi süreni geçtin!" : "Tüm mayınları temizledin.";
    } else {
      emoji.textContent = "💥";
      title.textContent = "Patladın!";
      sub.textContent = "Bir dahaki sefere daha dikkatli ol.";
    }
    stats.innerHTML =
      `<div>Süre<b>${state.time}s</b></div>` +
      `<div>Açılan<b>${state.revealed}</b></div>` +
      `<div>Bayrak<b>${state.flagsUsed}/${state.mines}</b></div>`;
    setTimeout(() => { overlay.hidden = false; }, type === "win" ? 300 : 700);
  }

  /* ---------------- İpucu ---------------- */
  function giveHint() {
    if (state.over || state.hints <= 0) return;
    // güvenli, kapalı, bayraksız bir hücre bul
    if (!state.started) { sfx.click(); return; }
    const candidates = [];
    for (let i = 0; i < state.grid.length; i++) {
      const c = state.grid[i];
      if (!c.mine && !c.open && !c.flag) candidates.push(i);
    }
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const el = state.grid[pick].el;
    el.classList.add("hint");
    state.hints--;
    $("hintState").textContent = state.hints + " hak";
    sfx.click();
    setTimeout(() => el.classList.remove("hint"), 2500);
  }

  /* ---------------- Zamanlayıcı / HUD ---------------- */
  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      state.time++;
      timerEl.textContent = pad3(state.time);
      if (state.time >= 999) stopTimer();
    }, 1000);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }
  function updateMineCount() {
    mineCountEl.textContent = pad3(state.mines - state.flagsUsed);
  }

  /* ---------------- Etkileşim ---------------- */
  let longPressTimer = null;
  let longPressed = false;

  boardEl.addEventListener("click", (e) => {
    const el = e.target.closest(".cell");
    if (!el || longPressed) { longPressed = false; return; }
    const x = +el.dataset.x, y = +el.dataset.y;
    const c = state.grid[idx(x, y)];
    if (state.flagMode) { toggleFlag(x, y); return; }
    if (c.open) chord(x, y);
    else reveal(x, y);
  });

  boardEl.addEventListener("contextmenu", (e) => {
    const el = e.target.closest(".cell");
    if (!el) return;
    e.preventDefault();
    toggleFlag(+el.dataset.x, +el.dataset.y);
  });

  // çift tık ile chord (masaüstü)
  boardEl.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".cell");
    if (!el) return;
    chord(+el.dataset.x, +el.dataset.y);
  });

  // mobil uzun basış → bayrak
  boardEl.addEventListener("touchstart", (e) => {
    const el = e.target.closest(".cell");
    if (!el) return;
    longPressed = false;
    longPressTimer = setTimeout(() => {
      longPressed = true;
      toggleFlag(+el.dataset.x, +el.dataset.y);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 380);
  }, { passive: true });
  const cancelLong = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
  boardEl.addEventListener("touchend", cancelLong, { passive: true });
  boardEl.addEventListener("touchmove", cancelLong, { passive: true });

  /* ---------------- Kontroller ---------------- */
  $("difficulty").addEventListener("click", (e) => {
    const btn = e.target.closest(".diff-btn");
    if (!btn) return;
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const level = btn.dataset.level;
    const panel = $("customPanel");
    if (level === "custom") {
      panel.hidden = false;
      applyCustom();
    } else {
      panel.hidden = true;
      setLevel(level);
      saveSettings();
    }
    sfx.click();
  });

  function applyCustom() {
    const w = clamp(+$("cw").value, 5, 40);
    const h = clamp(+$("ch").value, 5, 30);
    const maxMines = w * h - 10;
    const m = clamp(+$("cm").value, 1, maxMines);
    $("cw").value = w; $("ch").value = h; $("cm").value = m;
    setLevel("custom", { w, h, mines: m });
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n || lo));

  $("customPanel").addEventListener("submit", (e) => {
    e.preventDefault();
    applyCustom();
    sfx.click();
  });

  $("faceBtn").addEventListener("click", () => { newGame(); sfx.click(); });
  $("newGameBtn").addEventListener("click", () => { newGame(); sfx.click(); });
  $("overlayBtn").addEventListener("click", () => { newGame(); sfx.click(); });
  $("hintBtn").addEventListener("click", giveHint);

  $("flagModeBtn").addEventListener("click", () => {
    state.flagMode = !state.flagMode;
    $("flagModeBtn").classList.toggle("active", state.flagMode);
    $("flagModeState").textContent = state.flagMode ? "Açık" : "Kapalı";
    sfx.click();
  });

  $("soundBtn").addEventListener("click", () => {
    state.sound = !state.sound;
    $("soundBtn").textContent = state.sound ? "🔊" : "🔇";
    if (state.sound) sfx.click();
    saveSettings();
  });

  $("themeBtn").addEventListener("click", () => {
    state.theme = (state.theme + 1) % THEMES.length;
    document.body.className = THEMES[state.theme];
    saveSettings();
    sfx.click();
    toast("Tema: " + THEME_NAMES[state.theme]);
  });

  // yüzü "korkmuş" yap (basarken)
  boardEl.addEventListener("mousedown", () => {
    if (!state.over) faceEmoji.textContent = "😮";
  });
  document.addEventListener("mouseup", () => {
    if (!state.over) faceEmoji.textContent = "🙂";
  });

  // klavye: R yeni oyun, F bayrak modu
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") newGame();
    if (e.key === "f" || e.key === "F") $("flagModeBtn").click();
  });

  // pencere yeniden boyutlanınca hücreleri ölçekle
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const maxW = Math.min(window.innerWidth - 60, 720);
      const size = Math.max(22, Math.min(40, Math.floor(maxW / state.w) - 4));
      boardEl.style.setProperty("--cell-size", size + "px");
    }, 150);
  });

  /* ---------------- Toast ---------------- */
  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
        "background:rgba(20,27,56,.9);color:#eef2ff;padding:10px 18px;border-radius:12px;" +
        "z-index:200;font-size:14px;font-weight:700;border:1px solid rgba(140,160,255,.3);" +
        "backdrop-filter:blur(10px);transition:opacity .3s, transform .3s;pointer-events:none;";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translateX(-50%) translateY(10px)";
    }, 1600);
  }

  /* ============================================================
     ANİMASYONLU ARKA PLAN ("videolu" his) — yıldız/partikül akışı
     ============================================================ */
  const bg = $("bgCanvas");
  const bgx = bg.getContext("2d");
  let bgW, bgH, stars = [];
  function bgResize() {
    bgW = bg.width = window.innerWidth * devicePixelRatio;
    bgH = bg.height = window.innerHeight * devicePixelRatio;
    const count = Math.floor((window.innerWidth * window.innerHeight) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * bgW,
      y: Math.random() * bgH,
      z: Math.random() * 0.8 + 0.2,
      r: (Math.random() * 1.6 + 0.4) * devicePixelRatio,
      tw: Math.random() * Math.PI * 2,
    }));
  }
  function readVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || "#6c8cff";
  }
  function bgFrame(t) {
    bgx.clearRect(0, 0, bgW, bgH);
    const a = readVar("--accent");
    const a2 = readVar("--accent-2");
    // yumuşak hareketli ışık dalgaları
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y -= s.z * 0.4 * devicePixelRatio;
      s.tw += 0.02;
      if (s.y < -5) { s.y = bgH + 5; s.x = Math.random() * bgW; }
      const tw = (Math.sin(s.tw) + 1) / 2;
      bgx.globalAlpha = 0.25 + tw * 0.6 * s.z;
      bgx.fillStyle = i % 5 === 0 ? a2 : a;
      bgx.beginPath();
      bgx.arc(s.x, s.y, s.r * (0.7 + tw * 0.6), 0, Math.PI * 2);
      bgx.fill();
    }
    bgx.globalAlpha = 1;
    requestAnimationFrame(bgFrame);
  }

  /* ============================================================
     EFEKT KAPLAMASI — zafer konfeti + patlama
     ============================================================ */
  const fx = $("fxCanvas");
  const fxx = fx.getContext("2d");
  let fxParticles = [];
  let fxRunning = false;
  function fxResize() {
    fx.width = window.innerWidth * devicePixelRatio;
    fx.height = window.innerHeight * devicePixelRatio;
  }
  function fxLoop() {
    fxx.clearRect(0, 0, fx.width, fx.height);
    let alive = false;
    for (const p of fxParticles) {
      if (p.life <= 0) continue;
      alive = true;
      p.vy += p.g;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.99;
      p.life -= 0.012;
      p.rot += p.vr;
      fxx.save();
      fxx.globalAlpha = Math.max(0, p.life);
      fxx.translate(p.x, p.y);
      fxx.rotate(p.rot);
      fxx.fillStyle = p.color;
      if (p.shape === "rect") fxx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      else { fxx.beginPath(); fxx.arc(0, 0, p.s / 2, 0, Math.PI * 2); fxx.fill(); }
      fxx.restore();
    }
    if (alive) requestAnimationFrame(fxLoop);
    else { fxx.clearRect(0, 0, fx.width, fx.height); fxRunning = false; }
  }
  function startFx() { if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); } }

  function confettiBurst() {
    const colors = ["#6c8cff", "#b06cff", "#2dd4bf", "#ffd166", "#ff5a76", "#2dd47f"];
    const cx = fx.width / 2;
    for (let i = 0; i < 220; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (Math.random() * 14 + 4) * devicePixelRatio;
      fxParticles.push({
        x: cx, y: fx.height * 0.35,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 6 * devicePixelRatio,
        g: 0.25 * devicePixelRatio, life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        s: (Math.random() * 10 + 5) * devicePixelRatio,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() > 0.4 ? "rect" : "circle",
      });
    }
    startFx();
  }

  function explosionBurst(bx, by) {
    // patlayan hücrenin ekran konumunu al
    const c = state.grid[idx(bx, by)];
    let px = fx.width / 2, py = fx.height / 2;
    if (c && c.el) {
      const r = c.el.getBoundingClientRect();
      px = (r.left + r.width / 2) * devicePixelRatio;
      py = (r.top + r.height / 2) * devicePixelRatio;
    }
    const colors = ["#ffd166", "#ff9f43", "#ff5a76", "#ff3b3b", "#ffffff"];
    for (let i = 0; i < 140; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (Math.random() * 12 + 2) * devicePixelRatio;
      fxParticles.push({
        x: px, y: py,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        g: 0.18 * devicePixelRatio, life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5,
        s: (Math.random() * 8 + 3) * devicePixelRatio,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() > 0.5 ? "circle" : "rect",
      });
    }
    if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
    startFx();
  }

  /* ---------------- Başlangıç ---------------- */
  function init() {
    // ayarları yükle
    const s = loadStore();
    if (s.settings) {
      state.sound = s.settings.sound !== false;
      state.theme = s.settings.theme || 0;
      $("soundBtn").textContent = state.sound ? "🔊" : "🔇";
      document.body.className = THEMES[state.theme] || "";
    }
    bgResize(); fxResize();
    window.addEventListener("resize", () => { bgResize(); fxResize(); });
    requestAnimationFrame(bgFrame);

    renderRecords();
    setLevel("beginner");

    // ilk kullanıcı etkileşiminde audio context'i hazırla
    document.addEventListener("pointerdown", () => {
      if (!audioCtx && state.sound) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
      }
    }, { once: true });
  }

  init();
})();
