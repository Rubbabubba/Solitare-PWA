/* Solitaire PWA — Klondike (Draw 1 default)
   - Tap + drag
   - Undo
   - Hint (simple)
   - Save/restore (localStorage)
   - MLB random logo per card (asset-driven, fallback if missing)
*/

const LS_KEY = 'solitaire_pwa_v1_state';
const LS_SETTINGS = 'solitaire_pwa_v1_settings';

const SUITS = [
  { key: 'S', symbol: '♠', color: 'black' },
  { key: 'H', symbol: '♥', color: 'red' },
  { key: 'D', symbol: '♦', color: 'red' },
  { key: 'C', symbol: '♣', color: 'black' },
];

const RANKS = [
  { v: 1,  t: 'A' },
  { v: 2,  t: '2' },
  { v: 3,  t: '3' },
  { v: 4,  t: '4' },
  { v: 5,  t: '5' },
  { v: 6,  t: '6' },
  { v: 7,  t: '7' },
  { v: 8,  t: '8' },
  { v: 9,  t: '9' },
  { v: 10, t: '10' },
  { v: 11, t: 'J' },
  { v: 12, t: 'Q' },
  { v: 13, t: 'K' },
];

const els = {
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  moves: document.getElementById('moves'),
  stock: document.getElementById('stock'),
  waste: document.getElementById('waste'),
  stockCount: document.getElementById('stockCount'),
  dragLayer: document.getElementById('dragLayer'),

  f0: document.getElementById('f0'),
  f1: document.getElementById('f1'),
  f2: document.getElementById('f2'),
  f3: document.getElementById('f3'),

  t0: document.getElementById('t0'),
  t1: document.getElementById('t1'),
  t2: document.getElementById('t2'),
  t3: document.getElementById('t3'),
  t4: document.getElementById('t4'),
  t5: document.getElementById('t5'),
  t6: document.getElementById('t6'),

  btnSettings: document.getElementById('btnSettings'),
  btnNew: document.getElementById('btnNew'),
  btnHint: document.getElementById('btnHint'),
  btnUndo: document.getElementById('btnUndo'),

  modalBackdrop: document.getElementById('modalBackdrop'),
  btnCloseModal: document.getElementById('btnCloseModal'),
  drawMode: document.getElementById('drawMode'),
  optHints: document.getElementById('optHints'),
  optAutoFoundation: document.getElementById('optAutoFoundation'),
  deckStyle: document.getElementById('deckStyle'),
  btnResetStats: document.getElementById('btnResetStats'),
};

const PILE_IDS = ['stock','waste','f0','f1','f2','f3','t0','t1','t2','t3','t4','t5','t6'];

let settings = {
  draw: 1,
  hints: true,
  autoFoundation: false,
  deckStyle: 'mlb_random',
};

let state = null;
let timerHandle = null;

// MLB logos list (loaded from assets/mlb/mlb.json if present)
let mlbTeams = [];
let mlbLoaded = false;

function nowMs(){ return Date.now(); }
function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pileEl(pileId){
  return document.querySelector(`[data-pile="${pileId}"]`);
}

function isFoundation(p){ return p.startsWith('f'); }
function isTableau(p){ return p.startsWith('t'); }

function suitInfo(suitKey){
  return SUITS.find(s => s.key === suitKey);
}

function rankText(v){
  return RANKS.find(r => r.v === v)?.t ?? String(v);
}

function cardColor(card){
  return suitInfo(card.suit).color;
}

function makeDeck(){
  const deck = [];
  let id = 0;
  for (const s of SUITS){
    for (const r of RANKS){
      deck.push({
        id: String(id++),
        suit: s.key,
        rank: r.v,
        faceUp: false,
        logoKey: null,
      });
    }
  }
  return deck;
}

function randomLogoKey(){
  if (!mlbTeams.length) return null;
  const idx = Math.floor(Math.random() * mlbTeams.length);
  return mlbTeams[idx].key;
}

async function tryLoadMLB(){
  if (mlbLoaded) return;
  mlbLoaded = true;
  try{
    const res = await fetch('assets/mlb/mlb.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) {
      mlbTeams = data
        .filter(x => x && typeof x.file === 'string')
        .map(x => ({
          key: x.key || x.file,
          file: x.file,
          label: x.label || x.key || x.file,
        }));
    }
  }catch(_e){}
}

function newGame(){
  const deck = shuffle(makeDeck());

  if (settings.deckStyle === 'mlb_random') {
    for (const c of deck) c.logoKey = randomLogoKey();
  } else {
    for (const c of deck) c.logoKey = null;
  }

  const piles = {};
  for (const pid of PILE_IDS) piles[pid] = [];

  let idx = 0;
  for (let col = 0; col < 7; col++){
    const pid = `t${col}`;
    const count = col + 1;
    for (let j = 0; j < count; j++){
      const card = deck[idx++];
      card.faceUp = (j === count - 1);
      piles[pid].push(card.id);
    }
  }
  for (; idx < deck.length; idx++){
    deck[idx].faceUp = false;
    piles.stock.push(deck[idx].id);
  }

  state = {
    version: 1,
    startedAt: nowMs(),
    elapsedSec: 0,
    score: 0,
    moves: 0,
    drawMode: settings.draw,
    deckStyle: settings.deckStyle,

    cards: Object.fromEntries(deck.map(c => [c.id, c])),
    piles,
    undo: [],
    lastHint: null,
    won: false,
  };

  startTimer();
  pushUndoSnapshot('start');
  renderAll();
  saveState();
}

function startTimer(){
  stopTimer();
  timerHandle = setInterval(() => {
    if (!state) return;
    state.elapsedSec += 1;
    updateTopbar();
    saveStateThrottled();
  }, 1000);
}

function stopTimer(){
  if (timerHandle){
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function fmtTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTopbar(){
  els.score.textContent = String(state?.score ?? 0);
  els.moves.textContent = String(state?.moves ?? 0);
  els.time.textContent = fmtTime(state?.elapsedSec ?? 0);

  const stockCount = state?.piles?.stock?.length ?? 0;
  els.stockCount.textContent = String(stockCount);
  els.stockCount.style.display = stockCount > 0 ? 'flex' : 'none';
}

function saveSettings(){
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

function loadSettings(){
  try{
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object'){
      settings = { ...settings, ...obj };
    }
  }catch(_e){}
}

function syncSettingsUI(){
  els.drawMode.value = String(settings.draw);
  els.optHints.checked = !!settings.hints;
  els.optAutoFoundation.checked = !!settings.autoFoundation;
  els.deckStyle.value = settings.deckStyle;
}

function applySettingsFromUI(){
  settings.draw = Number(els.drawMode.value) === 3 ? 3 : 1;
  settings.hints = !!els.optHints.checked;
  settings.autoFoundation = !!els.optAutoFoundation.checked;
  settings.deckStyle = els.deckStyle.value || 'mlb_random';
  saveSettings();

  if (state){
    state.drawMode = settings.draw;
  }
}

let saveTimer = null;
function saveStateThrottled(){
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, 500);
}

function saveState(){
  try{
    if (!state) return;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }catch(_e){}
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.cards || !obj.piles) return null;
    return obj;
  }catch(_e){
    return null;
  }
}

function clearSavedGame(){
  localStorage.removeItem(LS_KEY);
}

function pushUndoSnapshot(reason){
  if (!state) return;
  const snap = deepClone({
    cards: state.cards,
    piles: state.piles,
    score: state.score,
    moves: state.moves,
    elapsedSec: state.elapsedSec,
    won: state.won,
  });
  state.undo.push({ reason, snap });
  if (state.undo.length > 80) state.undo.shift();
}

function undo(){
  if (!state || !state.undo.length) return;
  state.undo.pop();
  const prev = state.undo[state.undo.length - 1];
  if (!prev) return;

  state.cards = deepClone(prev.snap.cards);
  state.piles = deepClone(prev.snap.piles);
  state.score = prev.snap.score;
  state.moves = prev.snap.moves;
  state.elapsedSec = prev.snap.elapsedSec;
  state.won = prev.snap.won;

  renderAll();
  saveState();
}

function getPileOfCard(cardId){
  for (const pid of PILE_IDS){
    const arr = state.piles[pid];
    const idx = arr.indexOf(cardId);
    if (idx !== -1) return { pid, idx };
  }
  return null;
}

function topCardId(pid){
  const arr = state.piles[pid];
  return arr.length ? arr[arr.length - 1] : null;
}

function canMoveToFoundation(card, foundationPid){
  const pile = state.piles[foundationPid];
  const topId = pile.length ? pile[pile.length - 1] : null;
  if (!topId){
    return card.rank === 1;
  }
  const top = state.cards[topId];
  return top.suit === card.suit && card.rank === top.rank + 1;
}

function canMoveToTableau(card, tableauPid){
  const pile = state.piles[tableauPid];
  const topId = pile.length ? pile[pile.length - 1] : null;
  if (!topId){
    return card.rank === 13;
  }
  const top = state.cards[topId];
  return cardColor(top) !== cardColor(card) && card.rank === top.rank - 1;
}

function isMovableStack(fromPid, startIndex){
  if (!isTableau(fromPid)) return false;
  const pile = state.piles[fromPid];
  for (let i = startIndex; i < pile.length; i++){
    const c = state.cards[pile[i]];
    if (!c.faceUp) return false;
    if (i > startIndex){
      const prev = state.cards[pile[i - 1]];
      if (!(cardColor(prev) !== cardColor(c) && prev.rank === c.rank + 1)) return false;
    }
  }
  return true;
}

function flipTopIfNeeded(pid){
  if (!isTableau(pid)) return;
  const pile = state.piles[pid];
  if (!pile.length) return;
  const top = state.cards[pile[pile.length - 1]];
  if (!top.faceUp){
    top.faceUp = true;
    state.score += 5;
  }
}

function incMove(){ state.moves += 1; }

function checkWin(){
  const totalInFoundations =
    state.piles.f0.length + state.piles.f1.length + state.piles.f2.length + state.piles.f3.length;
  if (totalInFoundations === 52){
    state.won = true;
    state.score += 100;
  }
}

function moveCards(cardIds, fromPid, toPid){
  const from = state.piles[fromPid];
  const to = state.piles[toPid];

  for (let i = 0; i < cardIds.length; i++){
    const expect = from[from.length - cardIds.length + i];
    if (expect !== cardIds[i]) return false;
  }
  from.splice(from.length - cardIds.length, cardIds.length);
  to.push(...cardIds);

  if (isFoundation(toPid)){
    state.score += 10;
  }
  incMove();
  flipTopIfNeeded(fromPid);
  checkWin();
  return true;
}

function autoMoveSingle(cardId){
  const card = state.cards[cardId];
  if (!card.faceUp) return false;

  for (const f of ['f0','f1','f2','f3']){
    if (canMoveToFoundation(card, f)){
      const loc = getPileOfCard(cardId);
      if (!loc) return false;
      pushUndoSnapshot('auto');
      const ok = moveCards([cardId], loc.pid, f);
      if (ok){
        renderAll();
        saveState();
      }
      return ok;
    }
  }

  for (let t = 0; t < 7; t++){
    const pid = `t${t}`;
    if (canMoveToTableau(card, pid)){
      const loc = getPileOfCard(cardId);
      if (!loc) return false;
      if (isTableau(loc.pid)){
        const pile = state.piles[loc.pid];
        if (loc.idx !== pile.length - 1) continue;
      }
      pushUndoSnapshot('auto');
      const ok = moveCards([cardId], loc.pid, pid);
      if (ok){
        renderAll();
        saveState();
      }
      return ok;
    }
  }

  return false;
}

function drawFromStock(){
  const stock = state.piles.stock;
  const waste = state.piles.waste;

  if (!stock.length){
    if (!waste.length) return;
    pushUndoSnapshot('recycle');
    while (waste.length){
      const id = waste.pop();
      state.cards[id].faceUp = false;
      stock.push(id);
    }
    incMove();
    renderAll();
    saveState();
    return;
  }

  pushUndoSnapshot('draw');

  const drawCount = state.drawMode === 3 ? 3 : 1;
  for (let i = 0; i < drawCount; i++){
    if (!stock.length) break;
    const id = stock.pop();
    state.cards[id].faceUp = true;
    waste.push(id);
  }
  incMove();
  renderAll();
  saveState();
}

function getCardRunFromTableau(pid, startIndex){
  const pile = state.piles[pid];
  return pile.slice(startIndex);
}

function cardElement(cardId){
  return document.querySelector(`.card[data-id="${cardId}"]`);
}

function clearPileDom(pid){
  const el = pileEl(pid);
  if (isFoundation(pid)){
    const ph = el.querySelector('.placeholder');
    el.innerHTML = '';
    if (ph) el.appendChild(ph);
    else {
      const p = document.createElement('div');
      p.className = 'placeholder';
      p.textContent = 'A';
      el.appendChild(p);
    }
    return;
  }
  el.innerHTML = '';
}

/* ✅ Card DOM uses .corner.top and .corner.bottom */
function makeCardDom(card){
  const div = document.createElement('div');
  div.className = `card ${cardColor(card)}`;
  div.dataset.id = card.id;

  if (!card.faceUp){
    div.classList.add('faceDown');
    return div;
  }

  const s = suitInfo(card.suit);

  const inner = document.createElement('div');
  inner.className = 'cardInner';

  const top = document.createElement('div');
  top.className = 'corner top';
  top.innerHTML = `<span class="rank">${rankText(card.rank)}</span><span class="suit">${s.symbol}</span>`;

  const center = document.createElement('div');
  center.className = 'centerLogo';

  if (state.deckStyle === 'mlb_random' && card.logoKey){
    const team = mlbTeams.find(t => t.key === card.logoKey) || null;
    if (team && team.file){
      const img = document.createElement('img');
      img.className = 'logoImg';
      img.alt = team.label || card.logoKey;
      img.src = `assets/mlb/${team.file}`;
      img.onerror = () => {
        img.remove();
        center.appendChild(makeLogoFallback(team.label || card.logoKey));
      };
      center.appendChild(img);
    } else {
      center.appendChild(makeLogoFallback(card.logoKey));
    }
  } else {
    const fb = document.createElement('div');
    fb.className = 'logoFallback';
    fb.textContent = s.symbol;
    fb.style.fontSize = '44px';
    center.appendChild(fb);
  }

  const bottom = document.createElement('div');
  bottom.className = 'corner bottom';
  bottom.innerHTML = `<span class="rank">${rankText(card.rank)}</span><span class="suit">${s.symbol}</span>`;

  inner.appendChild(top);
  inner.appendChild(center);
  inner.appendChild(bottom);
  div.appendChild(inner);

  return div;
}

function makeLogoFallback(label){
  const fb = document.createElement('div');
  fb.className = 'logoFallback';
  const text = String(label || '').replace(/\.[a-z0-9]+$/i,'').trim();
  const short = text.length > 10 ? text.slice(0,10) : text;
  fb.textContent = short || 'MLB';
  return fb;
}

function renderPile(pid){
  clearPileDom(pid);

  const el = pileEl(pid);
  const pile = state.piles[pid];

  if (pid === 'stock'){
    if (pile.length){
      const topId = pile[pile.length - 1];
      const c = state.cards[topId];
      const fake = { ...c, faceUp: false };
      const dom = makeCardDom(fake);
      dom.dataset.id = topId;
      dom.style.pointerEvents = 'none';
      el.appendChild(dom);
    }
    return;
  }

  if (pid === 'waste'){
    const show = pile.slice(-3);
    show.forEach((id, i) => {
      const dom = makeCardDom(state.cards[id]);
      if (i === 1) dom.classList.add('fan1');
      if (i === 2) dom.classList.add('fan2');
      el.appendChild(dom);
    });
    return;
  }

  if (isFoundation(pid)){
    if (!pile.length) return;
    const topId = pile[pile.length - 1];
    el.appendChild(makeCardDom(state.cards[topId]));
    return;
  }

  if (isTableau(pid)){
    let y = 8;
    for (let i = 0; i < pile.length; i++){
      const id = pile[i];
      const c = state.cards[id];
      const dom = makeCardDom(c);
      dom.style.top = `${y}px`;
      y += c.faceUp ? 26 : 14;
      el.appendChild(dom);
    }
    return;
  }
}

function renderAll(){
  updateTopbar();
  for (const pid of PILE_IDS){
    renderPile(pid);
  }
  if (settings.autoFoundation) {
    autoFoundationPass();
  }
}

let drag = null;

function pidFromPoint(x, y){
  const nodes = document.querySelectorAll('[data-pile]');
  for (const n of nodes){
    const rect = n.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom){
      return n.dataset.pile;
    }
  }
  return null;
}

function cardRunIsFaceUp(ids){
  for (const id of ids){
    if (!state.cards[id].faceUp) return false;
  }
  return true;
}

function onPointerDown(e){
  if (!state || state.won) return;

  const target = e.target.closest('.card');
  const pileNode = e.target.closest('[data-pile]');
  if (!pileNode) return;

  const pid = pileNode.dataset.pile;

  if (pid === 'stock'){
    e.preventDefault();
    drawFromStock();
    return;
  }

  if (!target) return;

  const cardId = target.dataset.id;
  const loc = getPileOfCard(cardId);
  if (!loc) return;

  if (pid === 'waste'){
    if (cardId !== topCardId('waste')) return;
  }

  if (isFoundation(pid)){
    if (cardId !== topCardId(pid)) return;
  }

  let movingIds = [cardId];
  if (isTableau(pid)){
    if (!isMovableStack(pid, loc.idx)) return;
    movingIds = getCardRunFromTableau(pid, loc.idx);
  }

  const card = state.cards[cardId];
  if (isTableau(pid) && cardId === topCardId(pid) && !card.faceUp){
    pushUndoSnapshot('flip');
    card.faceUp = true;
    state.score += 5;
    incMove();
    renderAll();
    saveState();
    return;
  }

  if (!cardRunIsFaceUp(movingIds)) return;

  e.preventDefault();

  const rect = target.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  drag = {
    pointerId: e.pointerId,
    fromPid: pid,
    movingIds,
    offsetX,
    offsetY,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    ghostEls: [],
  };

  const originals = movingIds.map(id => cardElement(id)).filter(Boolean);
  originals.forEach(el => { el.style.visibility = 'hidden'; });

  const layer = els.dragLayer;
  layer.innerHTML = '';
  layer.style.pointerEvents = 'none';

  let baseY = e.clientY - offsetY;
  for (let i = 0; i < movingIds.length; i++){
    const id = movingIds[i];
    const c = state.cards[id];
    const ghost = makeCardDom(c);
    ghost.style.position = 'fixed';
    ghost.style.left = `${e.clientX - offsetX}px`;
    ghost.style.top = `${baseY + (i * 26)}px`;
    ghost.style.zIndex = String(1000 + i);
    ghost.style.transform = 'none';
    ghost.dataset.id = id;
    layer.appendChild(ghost);
    drag.ghostEls.push(ghost);
  }

  target.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e){
  if (!drag || e.pointerId !== drag.pointerId) return;

  const dx = Math.abs(e.clientX - drag.startX);
  const dy = Math.abs(e.clientY - drag.startY);
  if (dx + dy > 6) drag.moved = true;

  const x = e.clientX - drag.offsetX;
  const y = e.clientY - drag.offsetY;

  for (let i = 0; i < drag.ghostEls.length; i++){
    const g = drag.ghostEls[i];
    g.style.left = `${x}px`;
    g.style.top = `${y + (i * 26)}px`;
  }
}

function flashHint(cardId){
  const el = cardElement(cardId);
  if (!el) return;
  el.animate(
    [
      { filter: 'brightness(1)' },
      { filter: 'brightness(1.25)' },
      { filter: 'brightness(1)' },
    ],
    { duration: 420, iterations: 1, easing: 'ease-out' }
  );
}

function hint(){
  if (!state) return;

  const candidates = [];
  const w = topCardId('waste');
  if (w) candidates.push(w);

  for (let t = 0; t < 7; t++){
    const pid = `t${t}`;
    const top = topCardId(pid);
    if (top) candidates.push(top);
  }

  for (const id of candidates){
    const c = state.cards[id];
    if (!c.faceUp) continue;

    for (const f of ['f0','f1','f2','f3']){
      if (canMoveToFoundation(c, f)){
        flashHint(id);
        return;
      }
    }
    for (let t = 0; t < 7; t++){
      const pid = `t${t}`;
      const loc = getPileOfCard(id);
      if (loc && loc.pid === pid) continue;
      if (canMoveToTableau(c, pid)){
        flashHint(id);
        return;
      }
    }
  }

  els.stock.animate(
    [{ transform:'scale(1)' }, { transform:'scale(1.04)' }, { transform:'scale(1)' }],
    { duration: 360, easing:'ease-out' }
  );
}

function autoFoundationPass(){
  const ids = [];
  const w = topCardId('waste');
  if (w) ids.push(w);
  for (let t = 0; t < 7; t++){
    const top = topCardId(`t${t}`);
    if (top) ids.push(top);
  }

  let movedAny = false;
  let tries = 0;

  for (const id of ids){
    if (tries++ > 8) break;
    const c = state.cards[id];
    if (!c.faceUp) continue;

    for (const f of ['f0','f1','f2','f3']){
      if (canMoveToFoundation(c, f)){
        const loc = getPileOfCard(id);
        if (!loc) continue;
        pushUndoSnapshot('autoF');
        const ok = moveCards([id], loc.pid, f);
        if (ok){
          movedAny = true;
          break;
        }
      }
    }
  }

  if (movedAny){
    renderAll();
    saveState();
  }
}

function onPointerUp(e){
  if (!drag || e.pointerId !== drag.pointerId) return;

  const originals = drag.movingIds.map(id => cardElement(id)).filter(Boolean);
  originals.forEach(el => { el.style.visibility = ''; });

  if (!drag.moved){
    els.dragLayer.innerHTML = '';
    const single = drag.movingIds[0];
    if (drag.movingIds.length === 1){
      const moved = autoMoveSingle(single);
      if (!moved && settings.hints){
        flashHint(single);
      }
    }
    drag = null;
    return;
  }

  const dropPid = pidFromPoint(e.clientX, e.clientY);
  els.dragLayer.innerHTML = '';

  if (!dropPid){
    drag = null;
    renderAll();
    return;
  }

  const fromPid = drag.fromPid;
  const movingIds = drag.movingIds;
  const leadCard = state.cards[movingIds[0]];

  let canDrop = false;
  if (isFoundation(dropPid)){
    if (movingIds.length === 1 && canMoveToFoundation(leadCard, dropPid)){
      canDrop = true;
    }
  } else if (isTableau(dropPid)){
    if (canMoveToTableau(leadCard, dropPid)){
      canDrop = true;
    }
  }

  if (canDrop){
    pushUndoSnapshot('move');
    const ok = moveCards(movingIds, fromPid, dropPid);
    if (ok){
      renderAll();
      saveState();
    } else {
      renderAll();
    }
  } else {
    renderAll();
  }

  drag = null;
}

function openSettings(){
  syncSettingsUI();
  els.modalBackdrop.classList.remove('hidden');
}

function closeSettings(){
  els.modalBackdrop.classList.add('hidden');
}

function wireUI(){
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp, { passive: false });
  document.addEventListener('pointercancel', onPointerUp, { passive: false });

  els.btnSettings.addEventListener('click', openSettings);
  els.btnCloseModal.addEventListener('click', closeSettings);
  els.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === els.modalBackdrop) closeSettings();
  });

  els.btnNew.addEventListener('click', () => {
    applySettingsFromUI();
    newGame();
  });

  els.btnHint.addEventListener('click', () => {
    if (!settings.hints) return;
    hint();
  });

  els.btnUndo.addEventListener('click', () => undo());

  els.drawMode.addEventListener('change', () => {
    applySettingsFromUI();
    if (state){
      state.drawMode = settings.draw;
      saveState();
    }
  });
  els.optHints.addEventListener('change', () => applySettingsFromUI());
  els.optAutoFoundation.addEventListener('change', () => applySettingsFromUI());
  els.deckStyle.addEventListener('change', () => applySettingsFromUI());

  els.btnResetStats.addEventListener('click', () => {
    clearSavedGame();
    closeSettings();
    newGame();
  });

  els.stock.addEventListener('click', (e) => {
    e.preventDefault();
    drawFromStock();
  });
}

async function init(){
  loadSettings();
  syncSettingsUI();
  await tryLoadMLB();

  wireUI();

  const saved = loadState();
  if (saved){
    state = saved;
    settings.draw = state.drawMode === 3 ? 3 : 1;
    settings.deckStyle = state.deckStyle || settings.deckStyle;

    startTimer();
    renderAll();
  } else {
    newGame();
  }
}

init();
