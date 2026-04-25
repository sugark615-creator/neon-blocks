import { Board } from './board.js';
import { COLS, ROWS, BLOCK_SIZE, COLORS, rotate } from './tetrominoes.js';
import { startMusic, stopMusic, toggleMute, isMutedNow } from './audio.js';

// ===== Canvases =====
const canvas = document.getElementById('gameBoard');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('nextPieceBoard');
const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;
const nextCanvasMobile = document.getElementById('nextPieceMobile');
const nextCtxMobile = nextCanvasMobile ? nextCanvasMobile.getContext('2d') : null;
const MOBILE_NEXT_BLOCK = 10;

// ===== DOM helpers =====
function $(id) { return document.getElementById(id); }
function setText(id, val) { const el = $(id); if (el) el.textContent = val; }

// ===== Game state =====
const STATE = {
  HOME: 'home',
  PLAYING: 'playing',
  PAUSED: 'paused',
  CLEARING: 'clearing',
  GAME_OVER: 'gameOver',
  MODAL: 'modal',
};

let board;
let requestId;
let time = { start: 0, elapsed: 0, level: 1000 };
let score = 0;
let lines = 0;
let level = 1;
let highScore = parseInt(localStorage.getItem('neonBlocksHighScore') || '0', 10);
let gameState = STATE.HOME;
let modalReturnState = STATE.HOME; // where to go after closing a modal

// Line clear & drop flash animation states
let clearAnim = null; // { rows, count, startTime, removed }
let dropFlash = null; // { blocks, startTime, color }
const CLEAR_FLASH_MS = 250;
const CLEAR_TOTAL_MS = 700;

// Saved-game persistence (recovers from mobile-Safari background page reload)
const SAVED_GAME_KEY = 'neonBlocksSavedGame';
const SAVED_GAME_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Points: 0, 1, 2, 3, 4 lines
const POINTS = [0, 100, 300, 500, 800];
const LINE_LABELS = ['', '1 LINE', '2 LINES', '3 LINES', 'EXCELLENT!'];

// ===== Initialization =====
function init() {
  board = new Board();
  setText('bestScore', highScore);
  setText('bestScore-d', highScore);
  setText('homeBestScore', highScore);
  setText('modalBestScore', highScore);

  syncMuteLabels();
  wireMenus();
  setupTouchControls();
  setupSwipeControls();

  // Always show home on page load. If a recent paused game is in storage,
  // expose a CONTINUE button so the user explicitly decides whether to resume.
  refreshContinueButton();

  draw();
  drawNext();
  setState(STATE.HOME);
}

function refreshContinueButton() {
  const btn = $('homeContinueBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', !peekSavedGame());
}

// ===== Saved-game persistence =====
function saveGameState() {
  if (!board || !board.piece) return;
  try {
    localStorage.setItem(SAVED_GAME_KEY, JSON.stringify({
      grid: board.grid,
      piece: board.piece,
      nextPiece: board.nextPiece,
      score, lines, level,
      timeLevel: time.level,
      savedAt: Date.now(),
    }));
  } catch (_) { /* quota or disabled — ignore */ }
}

function clearSavedGame() {
  try { localStorage.removeItem(SAVED_GAME_KEY); } catch (_) {}
}

function peekSavedGame() {
  let raw;
  try { raw = localStorage.getItem(SAVED_GAME_KEY); } catch (_) { return false; }
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s || !s.savedAt || Date.now() - s.savedAt > SAVED_GAME_TTL_MS) {
      clearSavedGame();
      return false;
    }
    return true;
  } catch (_) {
    clearSavedGame();
    return false;
  }
}

function loadSavedGame() {
  let raw;
  try { raw = localStorage.getItem(SAVED_GAME_KEY); } catch (_) { return false; }
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s || !s.savedAt || Date.now() - s.savedAt > SAVED_GAME_TTL_MS) {
      clearSavedGame();
      return false;
    }
    board.grid = s.grid;
    board.piece = s.piece;
    board.nextPiece = s.nextPiece;
    score = s.score;
    lines = s.lines;
    level = s.level;
    time.level = s.timeLevel;
    return true;
  } catch (_) {
    clearSavedGame();
    return false;
  }
}

function setState(next) {
  gameState = next;
  document.body.dataset.state = next;
}

// ===== Menu wiring =====
function wireMenus() {
  // Home menu
  $('homeContinueBtn').addEventListener('click', continueSavedGame);
  $('homeStartBtn').addEventListener('click', () => { closeAllModals(); startGame(); });
  $('homeHighScoreBtn').addEventListener('click', () => openModal('highScoreModal'));
  $('homeSettingsBtn').addEventListener('click', () => openModal('settingsModal'));
  $('homeControlsBtn').addEventListener('click', () => openModal('controlsModal'));

  // Pause button (one in mobile stats-bar, one in desktop side panel — same handler)
  document.querySelectorAll('.pause-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (gameState === STATE.PLAYING) pauseGame();
    });
  });

  // Pause menu
  $('resumeBtn').addEventListener('click', resumeGame);
  $('pauseRestartBtn').addEventListener('click', () => {
    $('pauseMenu').classList.add('hidden');
    startGame();
  });
  $('pauseMuteBtn').addEventListener('click', () => { toggleMute(); syncMuteLabels(); });
  $('pauseHomeBtn').addEventListener('click', returnToHome);

  // Settings
  $('settingsMuteBtn').addEventListener('click', () => { toggleMute(); syncMuteLabels(); });

  // Game over
  $('restartBtn').addEventListener('click', startGame);
  $('gameOverHomeBtn').addEventListener('click', returnToHome);

  // Modal back buttons (data-close="modalId")
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
}

function openModal(id) {
  modalReturnState = gameState;
  $(id).classList.remove('hidden');
  // Hide the underlying screen so user only sees the modal
  if (modalReturnState === STATE.HOME) $('homeScreen').classList.add('hidden');
  if (modalReturnState === STATE.PAUSED) $('pauseMenu').classList.add('hidden');
  setState(STATE.MODAL);
}

function closeModal(id) {
  $(id).classList.add('hidden');
  // Restore the underlying screen
  if (modalReturnState === STATE.HOME) $('homeScreen').classList.remove('hidden');
  if (modalReturnState === STATE.PAUSED) $('pauseMenu').classList.remove('hidden');
  setState(modalReturnState);
}

function closeAllModals() {
  ['highScoreModal', 'settingsModal', 'controlsModal', 'pauseMenu', 'gameOverScreen', 'homeScreen']
    .forEach(id => $(id).classList.add('hidden'));
}

function syncMuteLabels() {
  const muted = isMutedNow();
  const label = muted ? 'SOUND OFF' : 'SOUND ON';
  setText('pauseMuteBtn', label);
  setText('settingsMuteBtn', label);
}

// ===== Game flow =====
function startGame() {
  closeAllModals();
  clearSavedGame();
  board.reset();
  score = 0; lines = 0; level = 1;
  time.level = 1000;
  clearAnim = null;
  hideLineClearText();
  updateScore();
  drawNext();

  if (requestId) cancelAnimationFrame(requestId);
  if (!isMutedNow()) startMusic(); else startMusic(); // start scheduler regardless; mute is per-note

  setState(STATE.PLAYING);
  time.start = performance.now();
  animate();
}

function returnToHome() {
  cancelAnimationFrame(requestId);
  stopMusic();
  clearAnim = null;
  hideLineClearText();
  closeAllModals();
  $('homeScreen').classList.remove('hidden');
  setText('homeBestScore', highScore);
  refreshContinueButton();
  setState(STATE.HOME);
}

// Restore a saved paused game and jump straight to the pause menu so the
// user can hit RESUME to start playing.
function continueSavedGame() {
  if (!loadSavedGame()) {
    refreshContinueButton();
    return;
  }
  closeAllModals();
  updateScore();
  drawNext();
  draw();
  syncMuteLabels();
  $('pauseMenu').classList.remove('hidden');
  setState(STATE.PAUSED);
}

function pauseGame() {
  if (gameState !== STATE.PLAYING) return;
  cancelAnimationFrame(requestId);
  stopMusic();
  syncMuteLabels();
  saveGameState();
  $('pauseMenu').classList.remove('hidden');
  setState(STATE.PAUSED);
}

function resumeGame() {
  if (gameState !== STATE.PAUSED) return;
  clearSavedGame();
  $('pauseMenu').classList.add('hidden');
  setState(STATE.PLAYING);
  startMusic();
  time.start = performance.now();
  animate();
}

function gameOver() {
  cancelAnimationFrame(requestId);
  stopMusic();
  clearSavedGame();
  setText('finalScore', score);

  if (score > highScore) {
    highScore = score;
    localStorage.setItem('neonBlocksHighScore', highScore);
    setText('bestScore', highScore);
    setText('bestScore-d', highScore);
    setText('homeBestScore', highScore);
    setText('modalBestScore', highScore);
    $('newBestMsg').classList.remove('hidden');
  } else {
    $('newBestMsg').classList.add('hidden');
  }

  $('gameOverScreen').classList.remove('hidden');
  setState(STATE.GAME_OVER);
}

// ===== Animation loop =====
function animate(now = 0) {
  if (gameState !== STATE.PLAYING && gameState !== STATE.CLEARING) return;

  if (gameState === STATE.CLEARING) {
    advanceClearAnim(now);
    requestId = requestAnimationFrame(animate);
    return;
  }

  time.elapsed = now - time.start;
  if (time.elapsed > time.level) {
    time.start = now;
    if (!drop()) { gameOver(); return; }
  }

  draw();
  requestId = requestAnimationFrame(animate);
}

// ===== Drawing =====
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      if (board.grid[y][x] > 0) drawBlock(ctx, x, y, board.grid[y][x]);
    }
  }

  // Ghost piece (where the active piece will land)
  if (board.piece && gameState === STATE.PLAYING) {
    let ghostY = board.piece.y;
    while (board.valid({ ...board.piece, y: ghostY + 1 })) ghostY++;
    if (ghostY !== board.piece.y) {
      for (let y = 0; y < board.piece.shape.length; y++) {
        for (let x = 0; x < board.piece.shape[y].length; x++) {
          if (board.piece.shape[y][x] > 0) {
            const gy = ghostY + y;
            if (gy >= 0) drawGhostBlock(ctx, board.piece.x + x, gy, board.piece.shape[y][x]);
          }
        }
      }
    }
  }

  // Active piece
  if (board.piece) {
    for (let y = 0; y < board.piece.shape.length; y++) {
      for (let x = 0; x < board.piece.shape[y].length; x++) {
        if (board.piece.shape[y][x] > 0) {
          drawBlock(ctx, board.piece.x + x, board.piece.y + y, board.piece.shape[y][x]);
        }
      }
    }
  }
  
  drawDropFlash();
}

function drawClearingFrame(progress) {
  // Draw the board normally first
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      if (board.grid[y][x] > 0) drawBlock(ctx, x, y, board.grid[y][x]);
    }
  }
  // White flash overlay on cleared rows
  if (!clearAnim) return;
  const intensity = Math.max(0, 1 - progress); // fade 1 → 0 over flash window
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * intensity})`;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 25 * intensity;
  for (const row of clearAnim.rows) {
    ctx.fillRect(0, row * BLOCK_SIZE, COLS * BLOCK_SIZE, BLOCK_SIZE);
  }
  ctx.restore();
  
  drawDropFlash();
}

function drawDropFlash() {
  if (!dropFlash) return;
  const elapsed = performance.now() - dropFlash.startTime;
  if (elapsed >= 250) {
    dropFlash = null;
    return;
  }
  const progress = 1 - (elapsed / 250); // linear fade
  ctx.save();
  
  // High intensity white center with cyan neon glow
  ctx.fillStyle = `rgba(255, 255, 255, ${progress})`;
  ctx.shadowColor = '#0ff';
  ctx.shadowBlur = 30 * progress;
  
  for (const pt of dropFlash.impacts) {
    if (pt.y >= 0) {
      // The contact surface is at the bottom edge of the block
      const surfaceY = (pt.y + 1) * BLOCK_SIZE;
      const centerX = (pt.x + 0.5) * BLOCK_SIZE;
      
      // Expanding horizontal shockwave
      const width = BLOCK_SIZE * 1.5 + (1 - progress) * BLOCK_SIZE * 2;
      const height = 6 * progress;
      
      ctx.fillRect(centerX - width / 2, surfaceY - height / 2, width, height);
      
      // Draw a second pass for a brighter core
      ctx.shadowBlur = 10 * progress;
      ctx.fillRect(centerX - (width * 0.5) / 2, surfaceY - 2 * progress, width * 0.5, 4 * progress);
    }
  }
  ctx.restore();
}

function drawBlock(context, x, y, typeId, offsetX = 0, offsetY = 0, size = BLOCK_SIZE) {
  const color = COLORS[typeId];
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = size > 16 ? 10 : 4;
  context.fillRect(offsetX + x * size + 1, offsetY + y * size + 1, size - 2, size - 2);
  const hl = Math.max(1, Math.floor(size / 7));
  context.fillStyle = 'rgba(255, 255, 255, 0.3)';
  context.shadowBlur = 0;
  context.fillRect(offsetX + x * size + 1, offsetY + y * size + 1, size - 2, hl);
  context.fillRect(offsetX + x * size + 1, offsetY + y * size + 1, hl, size - 2);
}

function drawGhostBlock(context, x, y, typeId) {
  const color = COLORS[typeId];
  context.save();
  context.globalAlpha = 0.18;
  context.fillStyle = color;
  context.fillRect(x * BLOCK_SIZE + 1, y * BLOCK_SIZE + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
  context.globalAlpha = 0.5;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.strokeRect(x * BLOCK_SIZE + 2, y * BLOCK_SIZE + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4);
  context.restore();
}

function drawNext() {
  if (nextCtx) renderNext(nextCtx, nextCanvas, BLOCK_SIZE);
  if (nextCtxMobile) renderNext(nextCtxMobile, nextCanvasMobile, MOBILE_NEXT_BLOCK);
}

function renderNext(context, targetCanvas, size) {
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  if (!board.nextPiece) return;
  const piece = board.nextPiece;
  const pWidth = piece.shape[0].length * size;
  const pHeight = piece.shape.length * size;
  const offsetX = (targetCanvas.width - pWidth) / 2;
  const offsetY = (targetCanvas.height - pHeight) / 2;
  for (let y = 0; y < piece.shape.length; y++) {
    for (let x = 0; x < piece.shape[y].length; x++) {
      if (piece.shape[y][x] > 0) {
        drawBlock(context, x, y, piece.shape[y][x], offsetX, offsetY, size);
      }
    }
  }
}

// ===== Line clear animation =====
function startClearAnim(rows, now) {
  clearAnim = { rows, count: rows.length, startTime: now, removed: false };
  setState(STATE.CLEARING);
  showLineClearText(rows.length);
}

function advanceClearAnim(now) {
  const elapsed = now - clearAnim.startTime;
  const flashProgress = Math.min(1, elapsed / CLEAR_FLASH_MS);

  drawClearingFrame(flashProgress);

  // Once flash window passes, actually remove and apply scoring
  if (!clearAnim.removed && elapsed >= CLEAR_FLASH_MS) {
    const cleared = board.clearLines();
    lines += cleared;
    score += POINTS[cleared] * level;
    level = Math.floor(lines / 10) + 1;
    time.level = Math.max(100, 1000 - (level - 1) * 100);
    updateScore();
    clearAnim.removed = true;
  }

  // After total animation time, spawn next piece and resume
  if (elapsed >= CLEAR_TOTAL_MS) {
    clearAnim = null;
    if (!board.spawnNextPiece()) { gameOver(); return; }
    drawNext();
    setState(STATE.PLAYING);
    time.start = performance.now();
  }
}

function showLineClearText(count) {
  const el = $('lineClearText');
  el.textContent = LINE_LABELS[count] || `${count} LINES`;
  el.classList.toggle('excellent', count >= 4);
  el.classList.remove('show');
  void el.offsetWidth; // restart animation
  el.classList.add('show');
}

function hideLineClearText() {
  const el = $('lineClearText');
  el.classList.remove('show');
}

// ===== Drop logic =====
function drop() {
  let p = { ...board.piece, y: board.piece.y + 1 };
  if (board.valid(p)) {
    board.piece.y += 1;
    return true;
  }

  // Lock the piece
  if (!board.freeze()) return false;

  // Detect lines to clear (animation handles removal + spawn + score)
  const fullRows = board.findFullLines();
  if (fullRows.length > 0) {
    startClearAnim(fullRows, performance.now());
    return true; // animation owns the next-piece spawn
  }

  // No clears — spawn next piece immediately
  if (!board.spawnNextPiece()) return false;
  drawNext();
  return true;
}

function updateScore() {
  setText('score', score);   setText('score-d', score);
  setText('level', level);   setText('level-d', level);
  setText('lines', lines);   setText('lines-d', lines);
  setText('bestScore', highScore); setText('bestScore-d', highScore);

  const el = $('score');
  if (el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}

// ===== Player actions =====
function canAct() {
  return gameState === STATE.PLAYING && board && board.piece;
}

function actionLeft() {
  if (!canAct()) return;
  const p = { ...board.piece, x: board.piece.x - 1 };
  if (board.valid(p)) { board.piece.x -= 1; draw(); }
}

function actionRight() {
  if (!canAct()) return;
  const p = { ...board.piece, x: board.piece.x + 1 };
  if (board.valid(p)) { board.piece.x += 1; draw(); }
}

function actionRotate() {
  if (!canAct()) return;
  const p = { ...board.piece, shape: rotate(board.piece.shape) };
  if (board.valid(p)) { board.piece.shape = p.shape; draw(); return; }
  for (const kick of [-1, 1, -2, 2]) {
    p.x = board.piece.x + kick;
    if (board.valid(p)) {
      board.piece.shape = p.shape;
      board.piece.x = p.x;
      draw();
      return;
    }
  }
}

function actionSoftDrop() {
  if (!canAct()) return;
  if (drop()) {
    time.start = performance.now();
    draw();
  } else {
    gameOver();
  }
}

function actionHardDrop() {
  if (!canAct()) return;
  while (board.valid({ ...board.piece, y: board.piece.y + 1 })) board.piece.y += 1;
  
  dropFlash = {
    impacts: [],
    startTime: performance.now(),
  };
  
  let absoluteBottomY = -1;
  const tempImpacts = [];

  // Find the bottom-most block in each column
  for (let x = 0; x < board.piece.shape[0].length; x++) {
    let bottomY = -1;
    for (let y = board.piece.shape.length - 1; y >= 0; y--) {
      if (board.piece.shape[y][x] > 0) {
        bottomY = y;
        break;
      }
    }
    if (bottomY !== -1) {
      const boardY = board.piece.y + bottomY;
      tempImpacts.push({ x: board.piece.x + x, y: boardY });
      if (boardY > absoluteBottomY) {
        absoluteBottomY = boardY;
      }
    }
  }

  // Only keep the impacts that are at the absolute lowest level of the piece
  dropFlash.impacts = tempImpacts.filter(pt => pt.y === absoluteBottomY);

  if (!drop()) { gameOver(); return; }
  draw();
}

// ===== Keyboard =====
const KEY_ACTIONS = {
  ArrowLeft: actionLeft,  a: actionLeft,
  ArrowRight: actionRight, d: actionRight,
  ArrowDown: actionSoftDrop, s: actionSoftDrop,
  ArrowUp: actionRotate,  w: actionRotate,
  ' ': actionHardDrop,
};

document.addEventListener('keydown', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // P toggles pause whenever a game is in progress
  if (key === 'p') {
    if (gameState === STATE.PLAYING) { event.preventDefault(); pauseGame(); return; }
    if (gameState === STATE.PAUSED)  { event.preventDefault(); resumeGame(); return; }
    return;
  }

  if (gameState !== STATE.PLAYING) return;

  const action = KEY_ACTIONS[key];
  if (!action) return;
  event.preventDefault();
  action();
});

// ===== Touch controls =====
function bindTouchHold(selector, action, initialDelay = 180, repeatDelay = 70) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  let timer = null, interval = null;
  const start = (e) => {
    e.preventDefault();
    action();
    timer = setTimeout(() => { interval = setInterval(action, repeatDelay); }, initialDelay);
  };
  const stop = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (interval) { clearInterval(interval); interval = null; }
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

function bindTouchTap(selector, action) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); action(); });
}

function setupTouchControls() {
  bindTouchHold('.touch-left', actionLeft);
  bindTouchHold('.touch-right', actionRight);
  bindTouchHold('.touch-down', actionSoftDrop);
  bindTouchTap('.touch-rotate', actionRotate);
  bindTouchTap('.touch-hard', actionHardDrop);
}

function setupSwipeControls() {
  const panel = document;
  
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let hasMoved = false;
  const SWIPE_THRESHOLD = 30; // pixels before triggering a move
  const TAP_THRESHOLD = 10;   // max pixels allowed to be considered a tap

  panel.addEventListener('touchstart', (e) => {
    if (gameState !== STATE.PLAYING) return;
    if (e.target.closest('button')) return; // Ignore touches on buttons
    // Don't prevent default here if we want to allow scrolling elsewhere, 
    // but typically for game boards we want to stop scroll.
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastX = startX;
    lastY = startY;
    hasMoved = false;
  }, { passive: false });

  panel.addEventListener('touchmove', (e) => {
    if (gameState !== STATE.PLAYING) return;
    if (e.target.closest('button')) return;

    e.preventDefault(); // Stop page scrolling while swiping on the game board

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    
    // Check total movement to disqualify as a tap
    if (Math.abs(currentX - startX) > TAP_THRESHOLD || Math.abs(currentY - startY) > TAP_THRESHOLD) {
      hasMoved = true;
    }

    const deltaX = currentX - lastX;
    const deltaY = currentY - lastY;

    // Check primary swipe direction to avoid diagonal cross-talk
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.5;
    const isVerticalDrop = deltaY > Math.abs(deltaX) * 2.5; // Strict downward swipe

    if (isHorizontal && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        actionRight();
      } else {
        actionLeft();
      }
      lastX = currentX; // Reset origin for continuous swipe
      lastY = currentY; // Update Y too so it doesn't build up diagonal drop
    }

    if (isVerticalDrop && deltaY > SWIPE_THRESHOLD) {
      actionHardDrop();
      lastY = Infinity; // Prevent multiple hard drops
    }
  }, { passive: false });

  panel.addEventListener('touchend', (e) => {
    if (gameState !== STATE.PLAYING) return;
    if (e.target.closest('button')) return;

    if (!hasMoved) {
      // It was a tap!
      e.preventDefault();
      actionRotate();
    }
  }, { passive: false });
}

// Auto-pause when the tab is hidden (user switched apps / locked phone / changed tab).
// Standard behaviour for browser games: pause silently, never auto-resume.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && gameState === STATE.PLAYING) {
    pauseGame();
  }
});

// ===== Boot =====
init();
