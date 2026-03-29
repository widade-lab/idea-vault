/* ============================================================
   THE VAULT — app.js  (v5 — UI redesign: category cards + bottom nav + todos)
   ============================================================ */

(() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════ */

  const STORAGE_KEY      = 'vault_ideas';
  const TODOS_KEY        = 'vault_todos';
  const IDB_NAME         = 'vault_audio_db';
  const IDB_STORE        = 'audio';
  const SWIPE_THRESHOLD  = 80;
  const SWIPE_AXIS_LOCK  = 6;

  const CATEGORY_META = {
    work:     { label: 'Work',     emoji: '💼', color: 'var(--cat-work)'     },
    personal: { label: 'Personal', emoji: '🏠', color: 'var(--cat-personal)' },
    creative: { label: 'Creative', emoji: '🎨', color: 'var(--cat-creative)' },
    money:    { label: 'Money',    emoji: '💰', color: 'var(--cat-money)'    },
  };

  const STATUS_META = {
    inbox:    { label: 'Inbox',    emoji: '📥' },
    pursuing: { label: 'Pursuing', emoji: '⚡' },
    done:     { label: 'Done',     emoji: '✅' },
    archived: { label: 'Archived', emoji: '🗄️' },
  };

  const STAR_HINTS = ['', 'Meh — keep it?', 'Mild interest', 'Pretty excited', 'Really excited', 'Drop everything! 🔥'];

  const CATEGORY_KEYWORDS = {
    work:     ['meeting','project','client','deadline','email','team','work','job','strategy','office','manager','boss','report','presentation','proposal','colleague','career','hire'],
    money:    ['invest','income','revenue','profit','earn','hustle','business','money','sell','buy','price','budget','savings','finance','payment','cash','fund','startup','brand'],
    creative: ['write','design','art','music','create','build','film','draw','idea','concept','story','creative','paint','photo','video','podcast','book','blog','content','make'],
    personal: ['health','family','home','travel','friend','exercise','habit','learn','life','food','cook','gym','vacation','relationship','self','personal','wellness','mental','fitness'],
  };

  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */

  const state = {
    ideas: [],
    todos: [],
    ui: {
      view:              'home',   // 'home' | 'category' | 'todos' | 'all' | 'motion'
      activeCategory:    null,     // 'work' | 'personal' | 'creative' | 'money'
      catFilter:         'all',    // 'all' | 'inbox' | 'pursuing' | 'done'
      todoFilter:        'all',    // 'all' | 'active' | 'done'
      filterTab:         'all',
      searchQuery:       '',

      // Recording
      recording:         false,
      mediaRecorder:     null,
      audioChunks:       [],
      mimeType:          '',
      recordSeconds:     0,
      recordTimerHandle: null,
      audioCtx:          null,
      analyserNode:      null,
      animFrameId:       null,
      speechRec:         null,
      finalTranscript:   '',
      interimTranscript: '',
      hasSpeechAPI:      false,

      // Review
      reviewOpen:        false,
      reviewIdeaId:      null,
      reviewExcitement:  1,

      // Detail
      detailOpen:        false,
      detailIdeaId:      null,
      detailDirty:       false,
      detailEditing:     false,
      detailExcitement:  3,

      confirmCallback:   null,
    },
  };

  /* ═══════════════════════════════════════════════════════════
     INDEXEDDB  (audio blob storage)
  ═══════════════════════════════════════════════════════════ */

  let _idb = null;

  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
      req.onsuccess  = e => { _idb = e.target.result; resolve(_idb); };
      req.onerror    = () => reject(req.error);
    });
  }

  async function saveAudio(id, blob, mimeType) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ id, blob, mimeType, createdAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function loadAudio(id) {
    if (!id) return null;
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  async function deleteAudio(id) {
    if (!id) return;
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     DATA LAYER — IDEAS
  ═══════════════════════════════════════════════════════════ */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.ideas = raw ? JSON.parse(raw) : [];
    } catch (_) { state.ideas = []; }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ideas)); }
    catch (e) { if (e.name === 'QuotaExceededError') showToast('Storage full'); }
  }

  function addIdea(data) {
    const now = new Date().toISOString();
    const transcript = (data.transcript || '').trim();
    const idea = {
      id:           uid(),
      title:        transcript.slice(0, 120) || 'Voice note',
      transcript:   transcript,
      category:     data.category || 'personal',
      excitement:   data.excitement || 0,
      notes:        (data.notes || '').trim(),
      nextStep:     (data.nextStep || '').trim(),
      status:       'inbox',
      audioId:      data.audioId  || null,
      duration:     data.duration || 0,
      revenueLog:   [],
      dateAdded:    now,
      dateModified: now,
    };
    state.ideas.unshift(idea);
    save();
    return idea;
  }

  function updateIdea(id, patch) {
    const i = state.ideas.findIndex(x => x.id === id);
    if (i === -1) return null;
    if (patch.transcript !== undefined && !patch.title) {
      patch.title = (patch.transcript || '').trim().slice(0, 120) || 'Voice note';
    }
    state.ideas[i] = { ...state.ideas[i], ...patch, id, dateModified: new Date().toISOString() };
    save();
    return state.ideas[i];
  }

  function removeIdea(id) {
    const idea = byId(id);
    if (idea && idea.audioId) deleteAudio(idea.audioId).catch(() => {});
    state.ideas = state.ideas.filter(x => x.id !== id);
    save();
  }

  function byId(id) { return state.ideas.find(x => x.id === id) || null; }

  function getFiltered() {
    let list = [...state.ideas];
    const f  = state.ui.filterTab;
    if      (f === 'inbox')    list = list.filter(x => x.status === 'inbox');
    else if (f === 'pursuing') list = list.filter(x => x.status === 'pursuing');
    else if (f === 'done')     list = list.filter(x => x.status === 'done' || x.status === 'archived');
    else if (f !== 'all')      list = list.filter(x => x.category === f);

    const q = state.ui.searchQuery.trim().toLowerCase();
    if (q) list = list.filter(x =>
      x.title.toLowerCase().includes(q) ||
      (x.transcript && x.transcript.toLowerCase().includes(q)) ||
      (x.notes && x.notes.toLowerCase().includes(q))
    );
    return list;
  }

  /* ═══════════════════════════════════════════════════════════
     DATA LAYER — TODOS
  ═══════════════════════════════════════════════════════════ */

  function loadTodos() {
    try {
      const raw = localStorage.getItem(TODOS_KEY);
      state.todos = raw ? JSON.parse(raw) : [];
    } catch (_) { state.todos = []; }
  }

  function saveTodos() {
    try { localStorage.setItem(TODOS_KEY, JSON.stringify(state.todos)); }
    catch (_) {}
  }

  function addTodo(text) {
    state.todos.unshift({ id: uid(), text, done: false, dateAdded: new Date().toISOString() });
    saveTodos();
    renderTodosView();
  }

  function toggleTodo(id) {
    const t = state.todos.find(x => x.id === id);
    if (t) { t.done = !t.done; saveTodos(); renderTodosView(); }
  }

  function removeTodo(id) {
    state.todos = state.todos.filter(x => x.id !== id);
    saveTodos();
    renderTodosView();
  }

  /* ═══════════════════════════════════════════════════════════
     AUTO-CATEGORIZATION
  ═══════════════════════════════════════════════════════════ */

  function autoCategory(text) {
    if (!text || text.trim().length < 3) return null;
    const lower = text.toLowerCase();
    let best = { cat: null, score: 0 };
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const hits  = keywords.filter(kw => lower.includes(kw)).length;
      const score = hits / keywords.length;
      if (score > best.score) best = { cat, score };
    }
    return best.score > 0.02 ? best.cat : null;
  }

  /* ═══════════════════════════════════════════════════════════
     DOM REFS
  ═══════════════════════════════════════════════════════════ */

  let dom = {};

  function refs() {
    dom = {
      // Views
      viewHome:     document.getElementById('view-home'),
      viewCategory: document.getElementById('view-category'),
      viewTodos:    document.getElementById('view-todos'),
      viewAll:      document.getElementById('view-all'),
      viewMotion:   document.getElementById('view-motion'),

      // Home view
      homeAlert:        document.getElementById('home-alert'),
      homeAlertText:    document.getElementById('home-alert-text'),
      homeAlertBtn:     document.getElementById('home-alert-btn'),
      categoryCards:    document.getElementById('category-cards'),
      motionTeaser:     document.getElementById('motion-teaser'),
      motionTeaserCount:document.getElementById('motion-teaser-count'),

      // Category view
      catBack:       document.getElementById('cat-back'),
      catEmoji:      document.getElementById('cat-emoji'),
      catTitle:      document.getElementById('cat-title'),
      catCount:      document.getElementById('cat-count'),
      catFilterBar:  document.getElementById('cat-filter-bar'),
      catCardGrid:   document.getElementById('cat-card-grid'),

      // All view
      searchInput: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      filterTabs:  document.querySelectorAll('.filter-tab'),
      allList:     document.getElementById('all-list'),

      // Motion view
      motionSub:      document.getElementById('motion-sub'),
      motionCardGrid: document.getElementById('motion-card-grid'),

      // Todos view
      todoInput:    document.getElementById('todo-input'),
      todoAddBtn:   document.getElementById('todo-add-btn'),
      todosBadge:   document.getElementById('todos-badge'),
      todosFilterBar: document.getElementById('todos-filter-bar'),
      todoList:     document.getElementById('todo-list'),

      // Bottom nav
      navHome:    document.getElementById('nav-home'),
      navAll:     document.getElementById('nav-all'),
      navRecord:  document.getElementById('nav-record'),
      navTodos:   document.getElementById('nav-todos'),
      navMotion:  document.getElementById('nav-motion'),
      navMicBtn:  document.getElementById('nav-mic-btn'),
      navMicIcon: document.querySelector('.nav-mic-icon'),
      navStopIcon:document.querySelector('.nav-stop-icon'),

      // Recording sheet
      recordSheet:       document.getElementById('record-sheet'),
      recordOverlay:     document.getElementById('record-overlay'),
      recordDot:         document.getElementById('record-dot'),
      recordStatusLbl:   document.getElementById('record-status-label'),
      recordTimer:       document.getElementById('record-timer'),
      recordWaveform:    document.getElementById('record-waveform'),
      recordFinal:       document.getElementById('record-final-text'),
      recordInterim:     document.getElementById('record-interim-text'),
      recordHint:        document.getElementById('record-transcript-hint'),
      recordIosFallback: document.getElementById('record-ios-fallback'),
      iosTitleInput:     document.getElementById('ios-title-input'),
      recordStop:        document.getElementById('record-stop'),

      // Review sheet
      reviewSheet:       document.getElementById('review-sheet'),
      reviewOverlay:     document.getElementById('review-overlay'),
      reviewClose:       document.getElementById('review-close'),
      reviewAudioWrap:   document.getElementById('review-audio-wrap'),
      reviewAudioPlayer: document.getElementById('review-audio-player'),
      reviewTranscript:  document.getElementById('review-transcript'),
      reviewStars:       document.getElementById('review-stars'),
      reviewHint:        document.getElementById('review-star-hint'),
      reviewNextStep:    document.getElementById('review-nextstep'),
      reviewTrash:       document.getElementById('review-trash'),
      reviewKeep:        document.getElementById('review-keep'),
      reviewPursue:      document.getElementById('review-pursue'),

      // Detail panel
      detailPanel:       document.getElementById('detail-panel'),
      detailBack:        document.getElementById('detail-back'),
      detailEditBtn:     document.getElementById('detail-edit-btn'),
      detailCategory:    document.getElementById('detail-category'),
      detailAudioWrap:   document.getElementById('detail-audio-wrap'),
      detailAudioPlayer: document.getElementById('detail-audio-player'),
      detailTitle:       document.getElementById('detail-title'),
      detailDate:        document.getElementById('detail-date'),
      detailStars:       document.getElementById('detail-stars'),
      detailStatus:      document.getElementById('detail-status'),
      detailNotes:       document.getElementById('detail-notes'),
      detailNextStep:    document.getElementById('detail-nextstep'),
      detailDeleteBtn:   document.getElementById('detail-delete-btn'),

      // Revenue
      detailRevenueBadge: document.getElementById('detail-revenue-badge'),
      detailRevenueLog:   document.getElementById('detail-revenue-log'),
      revenueMonthInput:  document.getElementById('revenue-month-input'),
      revenueAmountInput: document.getElementById('revenue-amount-input'),
      revenueLogBtn:      document.getElementById('revenue-log-btn'),

      // Confirm
      confirmDialog: document.getElementById('confirm-dialog'),
      confirmTitle:  document.getElementById('confirm-title'),
      confirmBody:   document.getElementById('confirm-body'),
      confirmOk:     document.getElementById('confirm-ok'),
      confirmCancel: document.getElementById('confirm-cancel'),

      toastContainer: document.getElementById('toast-container'),
    };
  }

  /* ═══════════════════════════════════════════════════════════
     VIEW ROUTING
  ═══════════════════════════════════════════════════════════ */

  const VIEW_IDS = ['home', 'category', 'todos', 'all', 'motion'];

  function switchView(v, extra = {}) {
    state.ui.view = v;
    if (v === 'category' && extra.category) {
      state.ui.activeCategory = extra.category;
      state.ui.catFilter = 'all';
    }

    // Show/hide views
    dom.viewHome.hidden     = v !== 'home';
    dom.viewCategory.hidden = v !== 'category';
    dom.viewTodos.hidden    = v !== 'todos';
    dom.viewAll.hidden      = v !== 'all';
    dom.viewMotion.hidden   = v !== 'motion';

    // Update bottom nav active state
    document.querySelectorAll('.bottom-nav__item[data-view]').forEach(btn => {
      btn.classList.toggle('bottom-nav__item--active', btn.dataset.view === v);
    });

    render();
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING
  ═══════════════════════════════════════════════════════════ */

  function render() {
    switch (state.ui.view) {
      case 'home':     renderHomeView();     break;
      case 'category': renderCategoryView(); break;
      case 'todos':    renderTodosView();    break;
      case 'all':      renderAllView();      break;
      case 'motion':   renderMotionView();   break;
    }
  }

  function renderHomeView() {
    const inboxCount  = state.ideas.filter(i => i.status === 'inbox').length;
    const motionCount = state.ideas.filter(i => i.status === 'pursuing').length;

    dom.homeAlert.hidden = inboxCount === 0;
    if (inboxCount > 0) {
      dom.homeAlertText.textContent = `${inboxCount} new idea${inboxCount > 1 ? 's' : ''} waiting`;
    }

    dom.motionTeaser.hidden = motionCount === 0;
    if (motionCount > 0) {
      dom.motionTeaserCount.textContent = `${motionCount} active`;
    }

    dom.categoryCards.innerHTML = ['work', 'personal', 'creative', 'money'].map(cat => {
      const meta   = CATEGORY_META[cat];
      const total  = state.ideas.filter(i => i.category === cat && i.status !== 'archived').length;
      const hasNew = state.ideas.some(i => i.category === cat && i.status === 'inbox');
      return `
        <button class="cat-card cat-card--${cat}" data-category="${cat}">
          <span class="cat-card__emoji">${meta.emoji}</span>
          <div class="cat-card__body">
            <div class="cat-card__name">${meta.label}</div>
            <div class="cat-card__count">${total} idea${total !== 1 ? 's' : ''}</div>
          </div>
          <span class="cat-card__dot${hasNew ? ' cat-card__dot--has-new' : ''}"></span>
        </button>`;
    }).join('');

    dom.categoryCards.querySelectorAll('.cat-card').forEach(btn => {
      btn.addEventListener('click', () => switchView('category', { category: btn.dataset.category }));
    });
  }

  function renderCategoryView() {
    const cat  = state.ui.activeCategory;
    const meta = CATEGORY_META[cat];
    if (!meta) return;

    dom.catEmoji.textContent = meta.emoji;
    dom.catTitle.textContent = meta.label;

    const statusFilterMap = { all: null, inbox: 'inbox', pursuing: 'pursuing', done: 'done' };
    const f = statusFilterMap[state.ui.catFilter];
    let ideas = state.ideas.filter(i => i.category === cat && i.status !== 'archived');
    if (f) ideas = ideas.filter(i => i.status === f);

    if (dom.catCount) dom.catCount.textContent = `${ideas.length} idea${ideas.length !== 1 ? 's' : ''}`;

    // Mini filter tabs
    const tabs = [
      { label: 'All',     filter: 'all'      },
      { label: '📥 New',  filter: 'inbox'    },
      { label: '⚡ Active',filter: 'pursuing' },
      { label: '✅ Done', filter: 'done'     },
    ];
    dom.catFilterBar.innerHTML = tabs.map(t =>
      `<button class="mini-tab${state.ui.catFilter === t.filter ? ' mini-tab--active' : ''}" data-filter="${t.filter}">${t.label}</button>`
    ).join('');
    dom.catFilterBar.querySelectorAll('.mini-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.ui.catFilter = btn.dataset.filter;
        renderCategoryView();
      });
    });

    if (ideas.length === 0) {
      dom.catCardGrid.innerHTML = `<p class="grid-empty" style="grid-column:1/-1">No ideas here yet.</p>`;
    } else {
      dom.catCardGrid.innerHTML = '';
      ideas.forEach((idea, i) => dom.catCardGrid.appendChild(buildCard(idea, i)));
      initSwipe(dom.catCardGrid);
    }
  }

  function renderMotionView() {
    const pursuing  = state.ideas.filter(i => i.status === 'pursuing');
    const monthTotal = getTotalMotionRevenue();
    dom.motionSub.textContent = monthTotal > 0
      ? `💰 $${monthTotal.toFixed(2)} this month`
      : `${pursuing.length} active`;

    if (pursuing.length === 0) {
      dom.motionCardGrid.innerHTML = `<p class="grid-empty" style="grid-column:1/-1">Nothing in motion yet. Pursue an idea to see it here.</p>`;
    } else {
      dom.motionCardGrid.innerHTML = '';
      pursuing.forEach((idea, i) => dom.motionCardGrid.appendChild(buildCard(idea, i)));
      initSwipe(dom.motionCardGrid);
    }
  }

  function renderAllView() {
    const list = getFiltered();
    dom.allList.innerHTML = '';
    if (list.length === 0) {
      dom.allList.innerHTML = `<div style="text-align:center;padding:50px 20px;color:var(--muted);font-size:14px;grid-column:1/-1">Nothing found.</div>`;
      return;
    }
    list.forEach((idea, i) => dom.allList.appendChild(buildCard(idea, i)));
    initSwipe(dom.allList);
  }

  function renderTodosView() {
    const f = state.ui.todoFilter;
    let todos = state.todos;
    if (f === 'active') todos = todos.filter(t => !t.done);
    if (f === 'done')   todos = todos.filter(t => t.done);

    const activeCount = state.todos.filter(t => !t.done).length;
    dom.todosBadge.textContent = activeCount || '';

    // Filter tabs
    const tabs = [
      { label: 'All',    filter: 'all'    },
      { label: 'Active', filter: 'active' },
      { label: 'Done',   filter: 'done'   },
    ];
    dom.todosFilterBar.innerHTML = tabs.map(t =>
      `<button class="mini-tab${state.ui.todoFilter === t.filter ? ' mini-tab--active' : ''}" data-filter="${t.filter}">${t.label}</button>`
    ).join('');
    dom.todosFilterBar.querySelectorAll('.mini-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.ui.todoFilter = btn.dataset.filter;
        renderTodosView();
      });
    });

    if (todos.length === 0) {
      dom.todoList.innerHTML = `<li class="grid-empty">${f === 'done' ? 'No completed tasks yet.' : 'All caught up!'}</li>`;
    } else {
      dom.todoList.innerHTML = todos.map(t => `
        <li class="todo-item${t.done ? ' todo-item--done' : ''}" data-id="${t.id}">
          <button class="todo-item__check${t.done ? ' todo-item__check--done' : ''}" data-action="toggle" aria-label="${t.done ? 'Mark incomplete' : 'Mark complete'}">
            ${t.done ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : ''}
          </button>
          <span class="todo-item__text">${esc(t.text)}</span>
          <button class="todo-item__delete" data-action="delete" aria-label="Delete task">×</button>
        </li>`).join('');
    }
  }

  /* ── Card builder ─────────────────────────────────────────── */
  function buildCard(idea, index) {
    const cat    = CATEGORY_META[idea.category] || CATEGORY_META.personal;
    const status = STATUS_META[idea.status]     || STATUS_META.inbox;
    const isInbox    = idea.status === 'inbox';
    const isPursuing = idea.status === 'pursuing';

    const card = document.createElement('article');
    card.className = `idea-card idea-card--${idea.status}`;
    card.dataset.id = idea.id;
    card.dataset.category = idea.category;
    card.style.setProperty('--card-index', Math.min(index, 8));

    const reviewBadge = isInbox
      ? `<div class="card-review-badge">⟳ Tap to review</div>`
      : '';

    const nextStepHtml = isPursuing && idea.nextStep
      ? `<span class="card-nextstep">→ ${esc(trunc(idea.nextStep, 35))}</span>`
      : '';

    const starsHtml = idea.excitement > 0
      ? `<div class="card-stars">${stars(idea.excitement)}</div>`
      : '';

    const thisMonthRev = isPursuing ? getMonthRevenue(idea, getCurrentMonth()) : 0;
    const revenueHtml  = thisMonthRev > 0
      ? `<span class="card-revenue">💰 $${thisMonthRev.toLocaleString()}</span>`
      : '';

    const displayText = idea.transcript
      ? trunc(idea.transcript, 120)
      : idea.title;

    const audioIndicator = idea.audioId
      ? `<span title="Has audio recording" style="font-size:13px">🎙</span>`
      : '';

    card.innerHTML = `
      <div class="card-swipe-bg card-swipe-bg--left"  aria-hidden="true"><span>🗑 Delete</span></div>
      <div class="card-swipe-bg card-swipe-bg--right" aria-hidden="true"><span>⚡ Pursue</span></div>
      <div class="idea-card__body" role="button" tabindex="0" aria-label="${esc(idea.title)}">
        ${reviewBadge}
        <div class="card-top">
          <span class="card-badge" style="--badge-color:${cat.color}">${cat.emoji} ${cat.label}</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${audioIndicator}
            <span class="card-status" title="${status.label}">${status.emoji}</span>
          </div>
        </div>
        <p class="card-notes">${esc(displayText) || '<em style="color:var(--muted)">No description — tap to add one</em>'}</p>
        <div class="card-footer">
          ${starsHtml}
          <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
            ${nextStepHtml}
            ${revenueHtml}
            <span class="card-date">${relDate(idea.dateAdded)}</span>
          </div>
        </div>
        ${idea.audioId ? `<div class="card-player" data-audio-id="${idea.audioId}"></div>` : ''}
      </div>
    `;

    const body = card.querySelector('.idea-card__body');
    body.addEventListener('click', e => {
      if (e.target.closest('.card-player')) return;
      if (isInbox) openReview(idea.id);
      else         openDetail(idea.id);
    });
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isInbox) openReview(idea.id);
        else         openDetail(idea.id);
      }
    });

    if (idea.audioId) {
      const playerEl = buildAudioPlayerEl();
      card.querySelector('.card-player').appendChild(playerEl);
      hydratePlayer(playerEl, idea.audioId).catch(() => {});
    }

    return card;
  }

  /* ═══════════════════════════════════════════════════════════
     RECORDING
  ═══════════════════════════════════════════════════════════ */

  async function openRecord() {
    if (state.ui.recording) { stopRecording(); return; }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      showToast('Microphone access needed — check browser settings');
      return;
    }

    state.ui.recording         = true;
    state.ui.audioChunks       = [];
    state.ui.finalTranscript   = '';
    state.ui.interimTranscript = '';
    dom.iosTitleInput.value    = '';
    dom.recordFinal.textContent   = '';
    dom.recordInterim.textContent = '';
    dom.recordTimer.textContent   = '0:00';
    dom.recordDot.classList.add('record-dot--live');
    dom.recordStatusLbl.textContent = 'Recording…';

    dom.recordSheet.setAttribute('aria-hidden', 'false');
    dom.recordSheet.classList.add('sheet--open');
    document.body.classList.add('sheet-open');
    dom.navMicBtn.classList.add('nav-mic-btn--recording');
    dom.navMicIcon.classList.add('hidden');
    dom.navStopIcon.classList.remove('hidden');

    const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
    state.ui.mimeType = mimeType;

    const mr = new MediaRecorder(stream, { mimeType });
    state.ui.mediaRecorder = mr;
    mr.ondataavailable = e => { if (e.data.size > 0) state.ui.audioChunks.push(e.data); };
    mr.start(250);

    state.ui.recordSeconds = 0;
    state.ui.recordTimerHandle = setInterval(() => {
      state.ui.recordSeconds++;
      dom.recordTimer.textContent = fmtDuration(state.ui.recordSeconds);
    }, 1000);

    startVisualization(stream);

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      state.ui.hasSpeechAPI = true;
      dom.recordHint.textContent = 'Listening…';
      dom.recordIosFallback.classList.add('hidden');

      const rec = new SpeechRec();
      rec.continuous     = true;
      rec.interimResults = true;
      rec.lang           = 'en-US';
      rec.onresult = e => {
        let fin = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) fin    += e.results[i][0].transcript + ' ';
          else                      interim += e.results[i][0].transcript;
        }
        state.ui.finalTranscript   = fin.trim();
        state.ui.interimTranscript = interim;
        dom.recordFinal.textContent   = fin;
        dom.recordInterim.textContent = interim;
      };
      rec.onerror = () => {
        state.ui.hasSpeechAPI = false;
        showIosFallback();
      };
      try { rec.start(); state.ui.speechRec = rec; }
      catch (_) { state.ui.hasSpeechAPI = false; showIosFallback(); }
    } else {
      state.ui.hasSpeechAPI = false;
      showIosFallback();
    }
  }

  function showIosFallback() {
    dom.recordHint.textContent = 'Tap Done when finished.';
    dom.recordIosFallback.classList.remove('hidden');
    setTimeout(() => dom.iosTitleInput.focus(), 420);
  }

  function stopRecording() {
    if (!state.ui.recording) return;
    state.ui.recording = false;

    clearInterval(state.ui.recordTimerHandle);
    stopVisualization();

    if (state.ui.speechRec) {
      try { state.ui.speechRec.stop(); } catch (_) {}
      state.ui.speechRec = null;
    }

    const mr = state.ui.mediaRecorder;
    if (mr && mr.state !== 'inactive') {
      mr.onstop = () => handleFinish(state.ui.audioChunks, state.ui.mimeType, state.ui.recordSeconds);
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    }

    closeRecordSheet();
  }

  function closeRecordSheet() {
    dom.recordSheet.classList.remove('sheet--open');
    document.body.classList.remove('sheet-open');
    dom.navMicBtn.classList.remove('nav-mic-btn--recording');
    dom.navMicIcon.classList.remove('hidden');
    dom.navStopIcon.classList.add('hidden');
    dom.recordDot.classList.remove('record-dot--live');
    dom.recordStatusLbl.textContent = 'Starting…';
    setTimeout(() => dom.recordSheet.setAttribute('aria-hidden', 'true'), 360);
  }

  async function handleFinish(chunks, mimeType, duration) {
    if (!chunks || chunks.length === 0) return;

    const blob    = new Blob(chunks, { type: mimeType });
    const audioId = 'audio_' + uid();

    let transcript = '';
    if (state.ui.hasSpeechAPI) {
      transcript = (state.ui.finalTranscript + ' ' + state.ui.interimTranscript).trim();
    } else {
      transcript = (dom.iosTitleInput.value || '').trim();
    }

    try {
      await saveAudio(audioId, blob, mimeType);
    } catch (_) {
      showToast('Couldn\'t save audio — storage full?');
    }

    const detectedCat = autoCategory(transcript) || 'personal';
    const idea = addIdea({ transcript, audioId, duration, category: detectedCat });
    render();
    showToast('🎙 Captured!');

    if (!transcript) {
      setTimeout(() => openReview(idea.id), 350);
    }
  }

  /* ── Waveform visualisation ─────────────────────────────── */
  function startVisualization(stream) {
    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      state.ui.audioCtx     = ctx;
      state.ui.analyserNode = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const bars = dom.recordWaveform.querySelectorAll('.waveform-bar');
      dom.recordWaveform.classList.add('waveform--live');

      function draw() {
        state.ui.animFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          const idx = Math.floor(i * data.length / bars.length);
          const h   = Math.max(3, (data[idx] / 255) * 48);
          bar.style.height = h + 'px';
        });
      }
      draw();
    } catch (_) {}
  }

  function stopVisualization() {
    if (state.ui.animFrameId) {
      cancelAnimationFrame(state.ui.animFrameId);
      state.ui.animFrameId = null;
    }
    if (state.ui.audioCtx) {
      state.ui.audioCtx.close().catch(() => {});
      state.ui.audioCtx     = null;
      state.ui.analyserNode = null;
    }
    dom.recordWaveform.classList.remove('waveform--live');
    dom.recordWaveform.querySelectorAll('.waveform-bar').forEach(b => { b.style.height = ''; });
  }

  /* ═══════════════════════════════════════════════════════════
     AUDIO PLAYER COMPONENT
  ═══════════════════════════════════════════════════════════ */

  const PLAY_ICON  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  const PAUSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  function buildAudioPlayerEl() {
    const el = document.createElement('div');
    el.className = 'audio-player';
    el.innerHTML = `
      <button class="audio-player__play" type="button" aria-label="Play">${PLAY_ICON}</button>
      <div class="audio-player__track" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="audio-player__fill"></div>
      </div>
      <span class="audio-player__time">-:--</span>
    `;
    return el;
  }

  async function hydratePlayer(el, audioId) {
    const entry = await loadAudio(audioId);
    if (!entry) { el.querySelector('.audio-player__time').textContent = '—'; return; }

    const url     = URL.createObjectURL(entry.blob);
    const audio   = new Audio(url);
    const playBtn = el.querySelector('.audio-player__play');
    const fill    = el.querySelector('.audio-player__fill');
    const timeEl  = el.querySelector('.audio-player__time');
    const track   = el.querySelector('.audio-player__track');

    audio.addEventListener('loadedmetadata', () => {
      timeEl.textContent = fmtDuration(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      fill.style.width    = pct + '%';
      timeEl.textContent  = fmtDuration(audio.currentTime);
    });
    audio.addEventListener('ended', () => {
      playBtn.innerHTML  = PLAY_ICON;
      fill.style.width   = '0%';
      timeEl.textContent = fmtDuration(audio.duration);
    });

    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (audio.paused) { audio.play(); playBtn.innerHTML = PAUSE_ICON; }
      else              { audio.pause(); playBtn.innerHTML = PLAY_ICON; }
    });

    track.addEventListener('click', e => {
      e.stopPropagation();
      const rect = track.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (audio.duration) audio.currentTime = pct * audio.duration;
    });

    el._audio = audio;
  }

  /* ═══════════════════════════════════════════════════════════
     REVIEW SHEET
  ═══════════════════════════════════════════════════════════ */

  function openReview(id) {
    const idea = byId(id);
    if (!idea) return;
    state.ui.reviewOpen       = true;
    state.ui.reviewIdeaId     = id;
    state.ui.reviewExcitement = idea.excitement || 1;

    dom.reviewTranscript.value = idea.transcript || '';

    const catRadio = dom.reviewSheet.querySelector(`input[name="review-cat"][value="${idea.category || 'personal'}"]`);
    if (catRadio) catRadio.checked = true;

    buildReviewStars(state.ui.reviewExcitement);
    dom.reviewNextStep.value = idea.nextStep || '';

    if (idea.audioId) {
      dom.reviewAudioWrap.classList.remove('hidden');
      dom.reviewAudioPlayer.innerHTML = '';
      const playerEl = buildAudioPlayerEl();
      dom.reviewAudioPlayer.appendChild(playerEl);
      hydratePlayer(playerEl, idea.audioId).catch(() => {});
    } else {
      dom.reviewAudioWrap.classList.add('hidden');
    }

    dom.reviewSheet.setAttribute('aria-hidden', 'false');
    dom.reviewSheet.classList.add('sheet--open');
    document.body.classList.add('sheet-open');

    if (!idea.transcript) {
      setTimeout(() => dom.reviewTranscript.focus(), 360);
    }
  }

  function closeReview() {
    if (!state.ui.reviewOpen) return;
    state.ui.reviewOpen   = false;
    state.ui.reviewIdeaId = null;

    const a = dom.reviewAudioPlayer.querySelector('.audio-player') &&
              dom.reviewAudioPlayer.querySelector('.audio-player')._audio;
    if (a) a.pause();

    dom.reviewSheet.classList.remove('sheet--open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => dom.reviewSheet.setAttribute('aria-hidden', 'true'), 360);
  }

  function buildReviewStars(selected) {
    dom.reviewStars.innerHTML = Array.from({ length: 5 }, (_, i) => `
      <button type="button" class="star ${i < selected ? 'star--filled' : ''}"
        data-value="${i + 1}" aria-label="${i + 1} star${i ? 's' : ''}"
        aria-pressed="${i < selected ? 'true' : 'false'}">★</button>
    `).join('');
    dom.reviewStars.querySelectorAll('.star').forEach(s => {
      s.addEventListener('click', () => {
        const v = parseInt(s.dataset.value, 10);
        state.ui.reviewExcitement = v;
        buildReviewStars(v);
      });
    });
    dom.reviewHint.textContent = STAR_HINTS[selected] || '';
  }

  function getReviewCategory() {
    const checked = dom.reviewSheet.querySelector('input[name="review-cat"]:checked');
    return checked ? checked.value : 'personal';
  }

  function doReviewKeep() {
    const id         = state.ui.reviewIdeaId;
    const transcript = dom.reviewTranscript.value.trim();
    updateIdea(id, {
      transcript,
      status:     'inbox',
      category:   getReviewCategory(),
      excitement: state.ui.reviewExcitement,
      nextStep:   dom.reviewNextStep.value.trim(),
    });
    closeReview();
    render();
    showToast('Kept — it\'ll wait for you');
  }

  function doReviewTrash() {
    const id   = state.ui.reviewIdeaId;
    const idea = byId(id);
    if (!idea) return;
    showConfirm('Not for you?', 'This idea will be archived.', () => {
      updateIdea(id, { status: 'archived' });
      closeReview();
      render();
      showToast('Archived');
    });
  }

  function doReviewPursue() {
    const id         = state.ui.reviewIdeaId;
    const transcript = dom.reviewTranscript.value.trim();
    updateIdea(id, {
      transcript,
      status:     'pursuing',
      category:   getReviewCategory(),
      excitement: state.ui.reviewExcitement,
      nextStep:   dom.reviewNextStep.value.trim(),
    });
    closeReview();
    render();
    showToast('⚡ In motion!');
  }

  /* ═══════════════════════════════════════════════════════════
     DETAIL PANEL
  ═══════════════════════════════════════════════════════════ */

  function openDetail(id) {
    const idea = byId(id);
    if (!idea) return;

    state.ui.detailIdeaId     = id;
    state.ui.detailOpen       = true;
    state.ui.detailDirty      = false;
    state.ui.detailEditing    = false;
    state.ui.detailExcitement = idea.excitement;

    const cat = CATEGORY_META[idea.category] || CATEGORY_META.personal;
    dom.detailCategory.innerHTML = `<span class="card-badge" style="--badge-color:${cat.color}">${cat.emoji} ${cat.label}</span>`;
    dom.detailTitle.textContent  = idea.transcript || idea.title || 'Voice note';
    dom.detailTitle.setAttribute('contenteditable', 'false');
    dom.detailDate.textContent   = fmtDate(idea.dateAdded);
    dom.detailNotes.value        = idea.notes    || '';
    dom.detailNotes.readOnly     = true;
    dom.detailNextStep.value     = idea.nextStep || '';
    dom.detailNextStep.readOnly  = true;
    dom.detailEditBtn.textContent = 'Edit';

    buildDetailStars(idea.excitement, false);
    setChips(idea.status, true);
    renderRevenueSection(idea);

    if (idea.audioId) {
      dom.detailAudioWrap.classList.remove('hidden');
      dom.detailAudioPlayer.innerHTML = '';
      const playerEl = buildAudioPlayerEl();
      dom.detailAudioPlayer.appendChild(playerEl);
      hydratePlayer(playerEl, idea.audioId).catch(() => {});
    } else {
      dom.detailAudioWrap.classList.add('hidden');
    }

    dom.detailPanel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => requestAnimationFrame(() =>
      dom.detailPanel.classList.add('detail-panel--open')
    ));
    setTimeout(() => dom.detailBack.focus(), 350);
  }

  function closeDetail() {
    if (state.ui.detailDirty && state.ui.detailEditing) saveDetail();

    const a = dom.detailAudioPlayer._audio;
    if (a) a.pause();

    state.ui.detailOpen    = false;
    state.ui.detailIdeaId  = null;
    state.ui.detailEditing = false;
    dom.detailPanel.classList.remove('detail-panel--open');
    setTimeout(() => dom.detailPanel.setAttribute('aria-hidden', 'true'), 350);
    render();
  }

  function enableEdit() {
    state.ui.detailEditing = true;
    dom.detailTitle.setAttribute('contenteditable', 'true');
    dom.detailNotes.readOnly    = false;
    dom.detailNextStep.readOnly = false;
    dom.detailEditBtn.textContent = 'Done';
    buildDetailStars(state.ui.detailExcitement, true);
    const cur = dom.detailStatus.querySelector('.status-chip[aria-pressed="true"]')?.dataset.status || 'inbox';
    setChips(cur, false);
    setTimeout(() => dom.detailTitle.focus(), 40);
  }

  function disableEdit() {
    state.ui.detailEditing = false;
    dom.detailTitle.setAttribute('contenteditable', 'false');
    dom.detailNotes.readOnly    = true;
    dom.detailNextStep.readOnly = true;
    dom.detailEditBtn.textContent = 'Edit';
    buildDetailStars(state.ui.detailExcitement, false);
    const cur = dom.detailStatus.querySelector('.status-chip[aria-pressed="true"]')?.dataset.status || 'inbox';
    setChips(cur, true);
    if (state.ui.detailDirty) saveDetail();
  }

  function saveDetail() {
    const id         = state.ui.detailIdeaId;
    const transcript = dom.detailTitle.textContent.trim();
    if (!id || !transcript) return;
    const chip = dom.detailStatus.querySelector('.status-chip[aria-pressed="true"]');
    updateIdea(id, {
      transcript,
      notes:      dom.detailNotes.value,
      nextStep:   dom.detailNextStep.value,
      status:     chip?.dataset.status || 'inbox',
      excitement: state.ui.detailExcitement,
    });
    state.ui.detailDirty = false;
    showToast('Saved');
  }

  function buildDetailStars(val, interactive) {
    dom.detailStars.innerHTML = Array.from({ length: 5 }, (_, i) => `
      <button type="button" class="star ${i < val ? 'star--filled' : ''}"
        data-value="${i + 1}" aria-label="${i + 1} star${i ? 's' : ''}"
        aria-pressed="${i < val ? 'true' : 'false'}"
        ${interactive ? '' : 'disabled'}>★</button>
    `).join('');
    if (interactive) {
      dom.detailStars.querySelectorAll('.star').forEach(s => {
        s.addEventListener('click', () => {
          const v = parseInt(s.dataset.value, 10);
          state.ui.detailExcitement = v;
          buildDetailStars(v, true);
          state.ui.detailDirty = true;
        });
      });
    }
  }

  function setChips(active, readonly) {
    dom.detailStatus.querySelectorAll('.status-chip').forEach(c => {
      c.setAttribute('aria-pressed', c.dataset.status === active ? 'true' : 'false');
      c.disabled = readonly;
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SWIPE GESTURES
  ═══════════════════════════════════════════════════════════ */

  function initSwipe(container) {
    container.querySelectorAll('.idea-card').forEach(card => {
      let sx = 0, sy = 0, cx = 0, horiz = null, on = false;
      const body = card.querySelector('.idea-card__body');

      function start(e) {
        if (e.target.closest('.audio-player')) return;
        const p = e.touches ? e.touches[0] : e;
        sx = p.clientX; sy = p.clientY; cx = 0; horiz = null; on = true;
      }
      function move(e) {
        if (!on) return;
        const p  = e.touches ? e.touches[0] : e;
        const dx = p.clientX - sx, dy = p.clientY - sy;
        if (horiz === null) {
          if (Math.abs(dx) > SWIPE_AXIS_LOCK || Math.abs(dy) > SWIPE_AXIS_LOCK)
            horiz = Math.abs(dx) > Math.abs(dy);
          return;
        }
        if (!horiz) return;
        if (e.cancelable) e.preventDefault();
        cx = dx;
        body.style.transition = 'none';
        body.style.transform  = `translateX(${cx}px)`;
        card.classList.toggle('idea-card--swiping-left',  cx < -20);
        card.classList.toggle('idea-card--swiping-right', cx > 20);
      }
      function end() {
        if (!on) return; on = false;
        body.style.transition = '';
        body.style.transform  = '';
        card.classList.remove('idea-card--swiping-left', 'idea-card--swiping-right');
        if (!horiz) return;
        if (cx < -SWIPE_THRESHOLD) {
          const idea = byId(card.dataset.id);
          if (!idea) return;
          showConfirm('Delete idea?', 'This recording will be permanently removed.', () => {
            removeIdea(card.dataset.id); render(); showToast('Deleted');
          });
        } else if (cx > SWIPE_THRESHOLD) {
          const idea = byId(card.dataset.id);
          if (!idea) return;
          if (idea.status === 'pursuing') { showToast('Already in motion!'); return; }
          updateIdea(card.dataset.id, { status: 'pursuing', excitement: idea.excitement || 3 });
          render(); showToast('⚡ In motion!');
        }
      }
      function cancel() {
        on = false;
        body.style.transition = '';
        body.style.transform  = '';
        card.classList.remove('idea-card--swiping-left', 'idea-card--swiping-right');
      }

      card.addEventListener('touchstart',  start,  { passive: true });
      card.addEventListener('touchmove',   move,   { passive: false });
      card.addEventListener('touchend',    end);
      card.addEventListener('touchcancel', cancel);
      card.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') start(e); });
      card.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') move(e);  });
      card.addEventListener('pointerup',   e => { if (e.pointerType === 'mouse') end();    });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     REVENUE
  ═══════════════════════════════════════════════════════════ */

  function getCurrentMonth() { return new Date().toISOString().slice(0, 7); }

  function fmtMonth(yyyyMM) {
    const [y, m] = yyyyMM.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function getMonthRevenue(idea, month) {
    return (idea.revenueLog || []).find(e => e.month === month)?.amount || 0;
  }

  function getTotalMotionRevenue() {
    const m = getCurrentMonth();
    return state.ideas
      .filter(x => x.status === 'pursuing')
      .reduce((sum, idea) => sum + getMonthRevenue(idea, m), 0);
  }

  function logRevenue(id, month, amount) {
    const idea = byId(id);
    if (!idea) return;
    const log = [...(idea.revenueLog || [])];
    const i = log.findIndex(e => e.month === month);
    if (i >= 0) log[i] = { month, amount };
    else log.push({ month, amount });
    log.sort((a, b) => b.month.localeCompare(a.month));
    updateIdea(id, { revenueLog: log });
  }

  function removeRevenue(id, month) {
    const idea = byId(id);
    if (!idea) return;
    updateIdea(id, { revenueLog: (idea.revenueLog || []).filter(e => e.month !== month) });
  }

  function renderRevenueSection(idea) {
    if (!idea) return;
    const thisMonth = getCurrentMonth();
    const log       = idea.revenueLog || [];
    const thisAmt   = getMonthRevenue(idea, thisMonth);

    dom.detailRevenueBadge.textContent = thisAmt > 0
      ? `$${thisAmt.toLocaleString()} this month` : '';

    dom.detailRevenueLog.innerHTML = '';
    log.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'revenue-entry';
      row.innerHTML = `
        <span class="revenue-entry__month">${fmtMonth(entry.month)}</span>
        <div style="display:flex;align-items:center">
          <span class="revenue-entry__amount">$${Number(entry.amount).toLocaleString()}</span>
          <button class="revenue-entry__del" data-month="${entry.month}" aria-label="Remove entry">✕</button>
        </div>
      `;
      row.querySelector('.revenue-entry__del').addEventListener('click', () => {
        removeRevenue(idea.id, entry.month);
        renderRevenueSection(byId(idea.id));
        render();
      });
      dom.detailRevenueLog.appendChild(row);
    });

    if (!dom.revenueMonthInput.value) {
      dom.revenueMonthInput.value = thisMonth;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════ */

  function showToast(msg) {
    const t = document.createElement('div');
    t.className   = 'toast';
    t.textContent = msg;
    dom.toastContainer.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('toast--visible')));
    setTimeout(() => { t.classList.remove('toast--visible'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  function showConfirm(title, body, cb) {
    dom.confirmTitle.textContent = title;
    dom.confirmBody.textContent  = body;
    state.ui.confirmCallback     = cb;
    dom.confirmDialog.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() =>
      dom.confirmDialog.classList.add('confirm-dialog--open')
    ));
    setTimeout(() => dom.confirmOk.focus(), 100);
  }

  function closeConfirm() {
    dom.confirmDialog.classList.remove('confirm-dialog--open');
    setTimeout(() => { dom.confirmDialog.classList.add('hidden'); state.ui.confirmCallback = null; }, 240);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

  function stars(n) {
    return Array.from({ length: 5 }, (_, i) =>
      `<span class="star-display ${i < n ? 'star-display--filled' : ''}">★</span>`
    ).join('');
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function relDate(iso) {
    const d = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (d < 60)     return 'just now';
    if (d < 3600)   return `${Math.floor(d/60)}m ago`;
    if (d < 86400)  return `${Math.floor(d/3600)}h ago`;
    if (d < 604800) return `${Math.floor(d/86400)}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtDuration(seconds) {
    const s = Math.floor(seconds || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ═══════════════════════════════════════════════════════════
     EVENTS
  ═══════════════════════════════════════════════════════════ */

  function events() {
    // Bottom nav
    dom.navHome.addEventListener('click',   () => switchView('home'));
    dom.navAll.addEventListener('click',    () => switchView('all'));
    dom.navRecord.addEventListener('click', () => {
      if (state.ui.recording) stopRecording();
      else openRecord();
    });
    dom.navTodos.addEventListener('click',  () => switchView('todos'));
    dom.navMotion.addEventListener('click', () => switchView('motion'));

    // Category view back button
    dom.catBack.addEventListener('click', () => switchView('home'));

    // Home alert "Review →" → all view filtered to inbox
    dom.homeAlertBtn.addEventListener('click', () => {
      state.ui.filterTab = 'inbox';
      switchView('all');
      // Sync the filter tab UI
      document.querySelectorAll('.filter-tab').forEach(t => {
        const active = t.dataset.filter === 'inbox';
        t.classList.toggle('filter-tab--active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });

    // Recording sheet
    dom.recordStop.addEventListener('click', stopRecording);
    dom.recordOverlay.addEventListener('click', stopRecording);

    // Review sheet
    dom.reviewClose.addEventListener('click',  closeReview);
    dom.reviewOverlay.addEventListener('click', closeReview);
    dom.reviewTrash.addEventListener('click',  doReviewTrash);
    dom.reviewKeep.addEventListener('click',   doReviewKeep);
    dom.reviewPursue.addEventListener('click', doReviewPursue);

    // Detail panel
    dom.detailBack.addEventListener('click', closeDetail);
    dom.detailEditBtn.addEventListener('click', () =>
      state.ui.detailEditing ? disableEdit() : enableEdit()
    );
    dom.detailDeleteBtn.addEventListener('click', () => {
      const idea = byId(state.ui.detailIdeaId);
      if (!idea) return;
      showConfirm('Delete idea?', 'This recording will be permanently removed.', () => {
        closeDetail();
        setTimeout(() => { removeIdea(idea.id); render(); showToast('Deleted'); }, 360);
      });
    });

    dom.detailStatus.querySelectorAll('.status-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.disabled) return;
        dom.detailStatus.querySelectorAll('.status-chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
        chip.setAttribute('aria-pressed', 'true');
        state.ui.detailDirty = true;
      });
    });

    dom.detailNotes.addEventListener('input',    () => { state.ui.detailDirty = true; });
    dom.detailNextStep.addEventListener('input', () => { state.ui.detailDirty = true; });
    dom.detailTitle.addEventListener('input',    () => { state.ui.detailDirty = true; });
    dom.detailTitle.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); dom.detailNotes.focus(); }
    });

    // Revenue
    dom.revenueLogBtn.addEventListener('click', () => {
      const id     = state.ui.detailIdeaId;
      const month  = dom.revenueMonthInput.value;
      const amount = parseFloat(dom.revenueAmountInput.value);
      if (!id || !month || isNaN(amount) || amount < 0) {
        dom.revenueAmountInput.classList.add('form-input--error');
        setTimeout(() => dom.revenueAmountInput.classList.remove('form-input--error'), 600);
        return;
      }
      logRevenue(id, month, Math.round(amount * 100) / 100);
      dom.revenueAmountInput.value = '';
      renderRevenueSection(byId(id));
      render();
      showToast(`💰 $${amount.toLocaleString()} logged`);
    });

    // Confirm dialog
    dom.confirmOk.addEventListener('click', () => {
      const cb = state.ui.confirmCallback; closeConfirm();
      if (typeof cb === 'function') cb();
    });
    dom.confirmCancel.addEventListener('click', closeConfirm);

    // Search
    dom.searchInput.addEventListener('input', () => {
      state.ui.searchQuery = dom.searchInput.value;
      dom.searchClear.classList.toggle('hidden', !dom.searchInput.value);
      renderAllView();
    });
    dom.searchClear.addEventListener('click', () => {
      dom.searchInput.value = ''; state.ui.searchQuery = '';
      dom.searchClear.classList.add('hidden');
      dom.searchInput.focus(); renderAllView();
    });

    // Filter tabs (all-view)
    dom.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        dom.filterTabs.forEach(t => {
          t.classList.remove('filter-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('filter-tab--active');
        tab.setAttribute('aria-selected', 'true');
        state.ui.filterTab = tab.dataset.filter;
        renderAllView();
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    });

    // Todos: add task
    dom.todoAddBtn.addEventListener('click', () => {
      const text = dom.todoInput.value.trim();
      if (!text) return;
      addTodo(text);
      dom.todoInput.value = '';
    });
    dom.todoInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') dom.todoAddBtn.click();
    });

    // Todos: toggle / delete (event delegation)
    dom.todoList.addEventListener('click', e => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle') toggleTodo(item.dataset.id);
      if (action === 'delete') removeTodo(item.dataset.id);
    });

    // Sheet drag-to-dismiss (review sheet)
    (() => {
      const panel = document.querySelector('#review-sheet .sheet__panel');
      const hdl   = document.querySelector('#review-sheet .sheet__handle');
      let sy = 0, cy = 0, drag = false;
      hdl.addEventListener('touchstart', e => { sy = e.touches[0].clientY; cy = 0; drag = true; panel.style.transition = 'none'; }, { passive: true });
      hdl.addEventListener('touchmove',  e => { if (!drag) return; cy = Math.max(0, e.touches[0].clientY - sy); panel.style.transform = `translateY(${cy}px)`; }, { passive: true });
      hdl.addEventListener('touchend',   () => { if (!drag) return; drag = false; panel.style.transition = ''; if (cy > 80) { panel.style.transform = ''; closeReview(); } else { panel.style.transform = ''; } });
    })();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!dom.confirmDialog.classList.contains('hidden')) closeConfirm();
      else if (state.ui.detailOpen)  closeDetail();
      else if (state.ui.reviewOpen)  closeReview();
      else if (state.ui.recording)   stopRecording();
    });

    // Multi-tab sync
    window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) { load(); render(); } });

    // PWA
    window.addEventListener('beforeinstallprompt', e => e.preventDefault());
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
  }

  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */

  function init() {
    refs();
    load();
    loadTodos();
    events();
    openIDB().catch(() => {});

    // Set header date
    const dateEl = document.getElementById('header-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    // Initial view
    switchView('home');
    console.log(`[Vault] v5 ready — ${state.ideas.length} ideas, ${state.todos.length} todos`);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
