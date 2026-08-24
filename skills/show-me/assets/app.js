/* Isometric system map - interaction layer.
   Layout is baked in at build time; this file only handles view transform,
   selection, and flow playback. Data arrives as window.__SYSTEM_MAP__. */
(() => {
  const DATA = window.__SYSTEM_MAP__;
  if (!DATA) return;

  const { map, metrics, testAttribution = { reliable: true } } = DATA;
  const CHAPTERS = map.chapters || [];
  const CHAPTER_VIEWS = DATA.chapterViews || [];
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const flowById = new Map((map.flows || []).map((f) => [f.id, f]));

  const $ = (sel) => document.querySelector(sel);
  const scene = $('#scene');
  const viewport = $('#viewport');
  const flowLayer = scene.querySelector('.flow-layer');
  const panel = $('#panel');
  const tabs = [...document.querySelectorAll('.tab')];

  const buildings = new Map(
    [...scene.querySelectorAll('.bldg')].map((el) => [el.dataset.node, el]),
  );
  const edgeEls = [...scene.querySelectorAll('.edge')];
  const edgeLabelEls = new Map(
    [...scene.querySelectorAll('.edge-label')].map((el) => [el.dataset.edge, el]),
  );
  const districtEls = new Map(
    [...scene.querySelectorAll('.district')].map((el) => [el.dataset.group, el]),
  );
  const edgeByIndex = new Map(edgeEls.map((el) => [el.dataset.edge, el]));
  const edgeKey = (from, to) => `${from}>${to}`;
  const edgesByHop = new Map();
  for (const el of edgeEls) {
    const key = edgeKey(el.dataset.from, el.dataset.to);
    if (!edgesByHop.has(key)) edgesByHop.set(key, el);
  }

  const state = {
    subject: { type: 'overview' },
    tab: 0,
    flowId: null,
    stepIndex: -1,
    playing: false,
    // Last chapter by default: a reader who did not ask to be walked through
    // should still land on the finished system rather than on three boxes.
    chapter: CHAPTERS.length > 0 ? CHAPTERS.length - 1 : 0,
  };

  /* ---- view transform --------------------------------------------------- */
  const baseBox = scene.getAttribute('viewBox').split(' ').map(Number);
  const view = { scale: 1, x: 0, y: 0 };

  function applyView() {
    viewport.setAttribute(
      'transform',
      `translate(${view.x} ${view.y}) scale(${view.scale})`,
    );
  }

  function resetView() {
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    applyView();
  }

  /** Convert a client point into the SVG user space the viewport sits in. */
  function toUserSpace(clientX, clientY) {
    const rect = scene.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": one uniform scale, centred.
    const fit = Math.min(rect.width / baseBox[2], rect.height / baseBox[3]);
    return {
      x: baseBox[0] + (clientX - rect.left - (rect.width - baseBox[2] * fit) / 2) / fit,
      y: baseBox[1] + (clientY - rect.top - (rect.height - baseBox[3] * fit) / 2) / fit,
    };
  }

  function zoomAt(clientX, clientY, factor) {
    const next = Math.min(6, Math.max(0.4, view.scale * factor));
    const applied = next / view.scale;
    const p = toUserSpace(clientX, clientY);
    view.x = p.x - (p.x - view.x) * applied;
    view.y = p.y - (p.y - view.y) * applied;
    view.scale = next;
    applyView();
  }

  scene.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  let drag = null;
  scene.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.bldg')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    scene.classList.add('is-panning');
    scene.setPointerCapture(event.pointerId);
  });
  scene.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = scene.getBoundingClientRect();
    const fit = Math.min(rect.width / baseBox[2], rect.height / baseBox[3]);
    view.x += (event.clientX - drag.x) / fit;
    view.y += (event.clientY - drag.y) / fit;
    drag.x = event.clientX;
    drag.y = event.clientY;
    applyView();
  });
  const endDrag = () => { drag = null; scene.classList.remove('is-panning'); };
  scene.addEventListener('pointerup', endDrag);
  scene.addEventListener('pointercancel', endDrag);

  $('#zoom-in').addEventListener('click', () => {
    const r = scene.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25);
  });
  $('#zoom-out').addEventListener('click', () => {
    const r = scene.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
  });
  $('#reset-view').addEventListener('click', () => {
    resetView();
    selectOverview();
  });

  /* ---- highlighting ----------------------------------------------------- */
  /** Labels follow the highlight: showing all of them at once buries the map. */
  function syncEdgeLabels() {
    for (const [index, el] of edgeLabelEls) {
      const edge = edgeByIndex.get(index);
      const lit = !!edge && (edge.classList.contains('is-current')
        || (edge.classList.contains('is-active') && state.subject.type !== 'flow'));
      el.classList.toggle('is-shown', lit);
    }
  }

  function clearHighlight() {
    for (const el of buildings.values()) el.classList.remove('is-selected', 'is-dimmed');
    for (const el of edgeEls) el.classList.remove('is-active', 'is-dimmed', 'is-current');
    for (const el of districtEls.values()) el.classList.remove('is-active');
    syncEdgeLabels();
  }

  function highlightNode(id) {
    clearHighlight();
    const neighbours = new Set([id]);
    for (const el of edgeEls) {
      if (el.dataset.from === id || el.dataset.to === id) {
        el.classList.add('is-active');
        neighbours.add(el.dataset.from);
        neighbours.add(el.dataset.to);
      } else {
        el.classList.add('is-dimmed');
      }
    }
    for (const [nodeId, el] of buildings) {
      if (nodeId === id) el.classList.add('is-selected');
      else if (!neighbours.has(nodeId)) el.classList.add('is-dimmed');
    }
    districtEls.get(nodeById.get(id)?.group)?.classList.add('is-active');
    syncEdgeLabels();
  }

  function highlightFlow(flow) {
    clearHighlight();
    const touched = new Set();
    for (const step of flow.steps) {
      touched.add(step.from);
      touched.add(step.to);
      const el = edgesByHop.get(edgeKey(step.from, step.to));
      if (el) el.classList.add('is-active');
    }
    for (const el of edgeEls) if (!el.classList.contains('is-active')) el.classList.add('is-dimmed');
    for (const [nodeId, el] of buildings) if (!touched.has(nodeId)) el.classList.add('is-dimmed');
    for (const nodeId of touched) districtEls.get(nodeById.get(nodeId)?.group)?.classList.add('is-active');
    syncEdgeLabels();
  }

  /* ---- flow playback ----------------------------------------------------
     A flow is read, not watched. Pacing it by path length -- which is what
     geometry suggests -- makes a short hop with a long explanation flash past
     and a long hop with three words crawl. Each step is paced by how long its
     own note takes to read instead, and the panel follows the token so the
     sentence explaining a hop is on screen while that hop is lit. */
  const tokens = [];
  let raf = null;
  let clock = 0;
  let lastFrame = 0;

  const READING_WORDS_PER_SECOND = 3.2;   // unhurried prose, not skimming
  const MIN_DWELL = 1500;
  const MAX_DWELL = 4400;
  const MIN_TRAVEL = 700;
  const MAX_TRAVEL = 1900;
  const STEP_GAP = 220;                   // beat between steps

  function stepPaths(flow) {
    return flow.steps.map((step, stepIndex) => ({
      step,
      stepIndex,
      path: edgesByHop.get(edgeKey(step.from, step.to)) || null,
    }));
  }

  function clearTokens() {
    for (const token of tokens) token.el.remove();
    tokens.length = 0;
  }

  /** How long a reader needs with this step's note, in milliseconds. */
  function dwellFor(step) {
    const words = String(step.note || '').trim().split(/\s+/).filter(Boolean).length;
    const needed = (words / READING_WORDS_PER_SECOND) * 1000;
    return Math.min(MAX_DWELL, Math.max(MIN_DWELL, needed));
  }

  function buildTokens(flow) {
    clearTokens();
    let offset = 0;
    for (const { step, stepIndex, path } of stepPaths(flow)) {
      if (!path) continue;
      const length = path.getTotalLength();
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      el.setAttribute('r', step.branch ? 2.6 : 3.4);
      el.setAttribute('class', step.branch ? 'flow-token flow-token--branch' : 'flow-token');
      el.style.visibility = 'hidden';
      flowLayer.appendChild(el);
      const travel = Math.min(MAX_TRAVEL, Math.max(MIN_TRAVEL, length * 2.4));
      const dwell = dwellFor(step);
      tokens.push({
        el, path, length, stepIndex,
        start: offset, travel, dwell, total: travel + dwell,
        branch: !!step.branch,
      });
      offset += travel + dwell + STEP_GAP;
    }
    return offset;
  }

  let cycle = 1;
  let shownStep = -1;

  function frame(now) {
    if (!state.playing) return;
    if (lastFrame) clock += now - lastFrame;
    lastFrame = now;
    paintTokens(clock % cycle);
    raf = requestAnimationFrame(frame);
  }

  /**
   * Mark one step as the one being read: in the panel, on its edge, and on the
   * two structures it runs between. Attributes are mutated in place rather than
   * re-rendering the panel, which would throw away the reader's scroll position
   * on every step.
   */
  function syncActiveStep(stepIndex) {
    if (stepIndex === shownStep) return;
    shownStep = stepIndex;
    state.stepIndex = stepIndex;

    const flow = flowById.get(state.flowId);
    if (!flow) return;

    for (const el of panel.querySelectorAll('.step[data-step]')) {
      const isCurrent = Number(el.dataset.step) === stepIndex;
      el.setAttribute('aria-current', String(isCurrent));
      if (isCurrent) scrollStepIntoView(el);
    }

    const step = flow.steps[stepIndex];
    for (const el of edgeEls) el.classList.remove('is-current');
    for (const el of buildings.values()) el.classList.remove('is-selected');
    if (!step) return;
    edgesByHop.get(edgeKey(step.from, step.to))?.classList.add('is-current');
    buildings.get(step.from)?.classList.remove('is-dimmed');
    buildings.get(step.to)?.classList.remove('is-dimmed');
    buildings.get(step.to)?.classList.add('is-selected');
    syncEdgeLabels();
  }

  /**
   * Bring one step into view inside the panel. Setting the container's
   * scrollTop against a computed target rather than calling scrollIntoView
   * keeps the effect inside this panel -- scrollIntoView can scroll an
   * ancestor -- and leaves the result directly measurable. The smooth easing
   * comes from `scroll-behavior` on .panel, which the reduced-motion query
   * turns off.
   */
  function scrollStepIntoView(el) {
    const view = panel.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const margin = 28;
    if (box.top < view.top + margin) {
      panel.scrollTop += box.top - view.top - margin;
    } else if (box.bottom > view.bottom - margin) {
      panel.scrollTop += box.bottom - view.bottom + margin;
    }
  }

  function paintTokens(t) {
    let current = -1;
    for (const token of tokens) {
      const local = t - token.start;
      if (local < 0 || local > token.total) {
        token.el.style.visibility = 'hidden';
        continue;
      }
      current = token.stepIndex;
      // A branch is a side effect: it runs out and comes back, so it bounces
      // across the whole step rather than travelling one way.
      const progress = token.branch
        ? 1 - Math.abs(1 - (local / token.total) * 2)
        : Math.min(1, local / token.travel);
      const point = token.path.getPointAtLength(progress * token.length);
      token.el.setAttribute('cx', point.x);
      token.el.setAttribute('cy', point.y);
      token.el.style.visibility = 'visible';
    }
    if (current !== -1) syncActiveStep(current);
  }

  function setPlaying(next) {
    state.playing = next;
    const button = $('#toggle-flow');
    button.innerHTML = next ? '&#9646;&#9646; Pause flow' : '&#9654; Play flow';
    button.setAttribute('aria-pressed', String(next));
    // Always cancel before rescheduling. Treating the rAF handle as an
    // "is running" flag deadlocks: a pause taken while the frame callback is
    // not scheduled to run again leaves a stale non-null handle forever.
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    if (next) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function selectFlow(flowId, { play = true } = {}) {
    const flow = flowById.get(flowId);
    if (!flow) return;
    state.flowId = flowId;
    state.stepIndex = -1;
    shownStep = -1;
    state.subject = { type: 'flow', id: flowId };
    $('#flow-select').value = flowId;
    highlightFlow(flow);
    cycle = buildTokens(flow) + 500;
    clock = 0;
    setPlaying(play && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!state.playing) paintTokens(0);
    renderPanel();
    syncSidebar();
  }

  function traceOneStep() {
    const flow = flowById.get(state.flowId);
    if (!flow) return;
    setPlaying(false);
    shownStep = -1;
    state.stepIndex = (state.stepIndex + 1) % flow.steps.length;
    const entries = stepPaths(flow);
    const active = entries[state.stepIndex];
    clearHighlight();
    highlightFlow(flow);
    if (active.path) {
      active.path.classList.add('is-active');
      for (const el of edgeEls) if (el !== active.path) el.classList.add('is-dimmed');
    }
    buildings.get(active.step.from)?.classList.remove('is-dimmed');
    buildings.get(active.step.to)?.classList.remove('is-dimmed');
    buildings.get(active.step.to)?.classList.add('is-selected');
    syncEdgeLabels();
    const token = tokens.find((entry) => entry.stepIndex === state.stepIndex);
    if (token) {
      clearTokensVisibility();
      // The far end is the resting position for both kinds: a branch token's
      // bounce peaks at full path length before returning.
      const point = token.path.getPointAtLength(token.length);
      token.el.setAttribute('cx', point.x);
      token.el.setAttribute('cy', point.y);
      token.el.style.visibility = 'visible';
    }
    renderPanel();
  }

  function clearTokensVisibility() {
    for (const token of tokens) token.el.style.visibility = 'hidden';
  }

  $('#toggle-flow').addEventListener('click', () => {
    if (!state.flowId) { selectFlow($('#flow-select').value); return; }
    setPlaying(!state.playing);
  });
  $('#trace-step').addEventListener('click', traceOneStep);
  $('#flow-select').addEventListener('change', (event) => selectFlow(event.target.value));

  /* ---- chapters ---------------------------------------------------------
     The field is laid out once for the whole system; a chapter changes only
     what is visible and where the camera sits, so a structure never moves and
     the reader keeps one mental model. This is what makes a large system
     readable without pretending it is small -- the alternative is capping the
     node count and merging structures you can no longer describe. */
  const revealables = [...scene.querySelectorAll('[data-reveal]')];

  function applyReveal() {
    if (CHAPTERS.length === 0) return;
    for (const el of revealables) {
      const reveal = Number(el.dataset.reveal);
      el.classList.toggle('is-unrevealed', reveal > state.chapter);
      el.classList.toggle('is-fresh', reveal === state.chapter && state.chapter > 0);
    }
    for (const row of document.querySelectorAll('.node-row')) {
      const reveal = Number(row.dataset.reveal);
      const ahead = reveal > state.chapter;
      row.classList.toggle('is-unrevealed', ahead);
      // Say when it appears, so an unrevealed row is a signpost rather than a
      // dead entry. Clicking it already jumps to that chapter.
      let when = row.querySelector('.node-row__when');
      if (ahead && !when) {
        when = document.createElement('span');
        when.className = 'node-row__when';
        row.appendChild(when);
      }
      if (when) {
        when.textContent = `ch ${reveal + 1}`;
        when.style.display = ahead ? '' : 'none';
      }
    }
  }

  /** Move the camera so a box fills the stage, without moving the scene. */
  function fitTo(box) {
    if (!box) return;
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (width <= 0 || height <= 0) return;          // a zero-size rect inverts the scale
    const scale = Math.min(6, Math.max(0.2, Math.min(baseBox[2] / width, baseBox[3] / height)));
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    view.scale = scale;
    view.x = baseBox[0] + baseBox[2] / 2 - scale * centre.x;
    view.y = baseBox[1] + baseBox[3] / 2 - scale * centre.y;
    applyView();
  }

  function chapterOf(nodeId) {
    return CHAPTERS.findIndex((chapter) => (chapter.reveals || []).includes(nodeId));
  }

  function setChapter(index, { keepSelection = false } = {}) {
    if (CHAPTERS.length === 0) return;
    state.chapter = Math.max(0, Math.min(CHAPTERS.length - 1, index));
    const chapter = CHAPTERS[state.chapter];
    applyReveal();
    fitTo(CHAPTER_VIEWS[state.chapter]);
    // Each chapter carries at most one flow, and only the last offers a picker.
    const select = $('#flow-select');
    if (select) {
      const last = state.chapter === CHAPTERS.length - 1;
      select.disabled = !last;
      // Do not leave another chapter's flow named in the picker: on a chapter
      // with no flow that reads as though one were running.
      const placeholder = select.querySelector('option[value="__none"]')
        || Object.assign(document.createElement('option'), { value: '__none', textContent: 'no flow this chapter' });
      if (!placeholder.parentNode) select.appendChild(placeholder);
      placeholder.hidden = Boolean(chapter.flow);
      if (chapter.flow) selectFlow(chapter.flow, { play: false });
      else {
        setPlaying(false);
        clearTokens();
        clearHighlight();
        select.value = '__none';
        state.flowId = null;
      }
    }
    // The chapter's own story is the default reading. Its flow still lights up
    // and animates on the field, but burying the story behind the step list
    // means the prose explaining the chapter is never the thing you land on.
    if (!keepSelection) state.subject = { type: 'overview' };
    syncRail();
    renderPanel();
    syncSidebar();
  }

  function syncRail() {
    for (const mark of document.querySelectorAll('.rail__step')) {
      mark.setAttribute('aria-current', String(Number(mark.dataset.chapter) === state.chapter));
    }
    const title = $('#rail-title');
    if (title) title.textContent = CHAPTERS[state.chapter]?.title ?? '';
    const counter = $('#chapter-counter');
    if (counter) {
      const shown = revealables.filter((el) => el.classList.contains('bldg')
        && Number(el.dataset.reveal) <= state.chapter).length;
      counter.textContent = `chapter ${state.chapter + 1}/${CHAPTERS.length}`
        + ` \u00b7 ${shown}/${buildings.size} structures`;
    }
    const back = $('#chapter-back');
    const next = $('#chapter-next');
    if (back) back.disabled = state.chapter === 0;
    if (next) next.disabled = state.chapter === CHAPTERS.length - 1;
  }

  function buildChapterUI() {
    if (CHAPTERS.length === 0) return;
    const controls = document.querySelector('.controls');
    const nav = document.createElement('span');
    nav.className = 'chapter-nav';
    nav.innerHTML = '<button id="chapter-back" type="button">&#9666; Back</button>'
      + '<button id="chapter-next" type="button">Next &#9656;</button>';
    controls.insertBefore(nav, controls.firstChild);

    const rail = document.createElement('div');
    rail.className = 'rail';
    rail.innerHTML = `<div class="rail__steps">${CHAPTERS.map((chapter, index) =>
      `<button class="rail__step" type="button" data-chapter="${index}" `
      + `title="${chapter.title.replace(/"/g, '&quot;')}">${index + 1}</button>`).join('')}</div>`
      + '<div class="rail__title" id="rail-title"></div>';
    document.querySelector('.stage').appendChild(rail);

    const counter = document.createElement('div');
    counter.className = 'stage__counter';
    counter.id = 'chapter-counter';
    document.querySelector('.stage__head').appendChild(counter);

    $('#chapter-back').addEventListener('click', () => setChapter(state.chapter - 1));
    $('#chapter-next').addEventListener('click', () => setChapter(state.chapter + 1));
    for (const mark of rail.querySelectorAll('.rail__step')) {
      mark.addEventListener('click', () => setChapter(Number(mark.dataset.chapter)));
    }
  }

  /* ---- selection -------------------------------------------------------- */
  function selectNode(id) {
    // Clicking something the reader has not reached yet is a request to go
    // there, not a dead link.
    if (CHAPTERS.length > 0) {
      const appears = chapterOf(id);
      if (appears > state.chapter) { setChapter(appears, { keepSelection: true }); }
    }
    shownStep = -1;
    state.subject = { type: 'node', id };
    state.flowId = null;
    setPlaying(false);
    clearTokens();
    highlightNode(id);
    renderPanel();
    syncSidebar();
  }

  function selectOverview() {
    shownStep = -1;
    state.subject = { type: 'overview' };
    state.flowId = null;
    setPlaying(false);
    clearTokens();
    clearHighlight();
    renderPanel();
    syncSidebar();
  }

  for (const [id, el] of buildings) {
    el.addEventListener('click', () => selectNode(id));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(id); }
    });
  }
  scene.addEventListener('click', (event) => {
    if (!event.target.closest('.bldg')) selectOverview();
  });

  function syncSidebar() {
    for (const row of document.querySelectorAll('.node-row')) {
      row.setAttribute(
        'aria-current',
        String(state.subject.type === 'node' && row.dataset.node === state.subject.id),
      );
    }
  }
  for (const row of document.querySelectorAll('.node-row')) {
    row.addEventListener('click', () => selectNode(row.dataset.node));
  }

  /* ---- explainer -------------------------------------------------------- */
  const esc = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[^\x20-\x7E\n\t]/g, (char) => '&#' + char.codePointAt(0) + ';');

  const paragraphs = (text) => String(text)
    .split(/\n{2,}/)
    .map((chunk) => `<p>${esc(chunk.trim().replace(/\s+/g, ' '))}</p>`)
    .join('');

  function citation(cite) {
    const ref = `${cite.file}:${cite.line}`;
    return `<button class="cite" type="button" data-copy="${esc(ref)}" title="Click to copy ${esc(ref)}">`
      + `${esc(ref)}<br><span class="cite__evidence">${esc(cite.evidence)}</span></button>`;
  }

  function nodePanel(node, tab) {
    const m = metrics[node.id];
    const confidence = node.confidence === 'inferred'
      ? '<span class="tag tag--warn">inferred</span>' : '';
    if (tab === 0) {
      const capped = m.capped
        ? `<p class="concern">Height is capped at 30 floors; the real mass is ${m.rawFloors} floors of code.</p>`
        : '';
      const untested = testAttribution.reliable && m.testFiles === 0 && m.loc > 200
        ? '<p class="concern">No test files resolve to this node.</p>' : '';
      return `<div class="panel__eyebrow">Selected structure</div>`
        + `<h2 class="panel__title">${esc(node.label)}</h2>`
        + `<div><span class="tag">${esc(node.kind)}</span>${confidence}</div>`
        + paragraphs(node.whatItDoes)
        + `<div class="metrics">`
        + metric('source files', m.fileCount)
        + metric('lines of code', m.loc.toLocaleString())
        + metric('test files', m.testFiles)
        + metric('depended on by', m.fanIn)
        + `</div>${capped}${untested}`;
    }
    const concerns = (node.concerns || []).length
      ? `<div class="panel__eyebrow">Condition</div>`
        + node.concerns.map((c) => `<p class="concern">${esc(c)}</p>`).join('')
      : '';
    return `<div class="panel__eyebrow">Implementation</div>`
      + `<h2 class="panel__title">${esc(node.label)}</h2>`
      + paragraphs(node.howItsBuilt)
      + concerns
      + connections(node.id)
      + `<div class="panel__eyebrow">Evidence</div>`
      + node.citations.map(citation).join('')
      + `<div class="panel__eyebrow">Largest file</div>`
      + `<p>${esc(m.largestFile.file || 'n/a')} &#8212; ${m.largestFile.loc} lines</p>`;
  }

  const EDGE_VERB = {
    call: 'calls', read: 'reads from', write: 'writes to', emit: 'publishes to',
    consume: 'consumes from', http: 'reaches over the network', import: 'imports types from',
  };
  const EDGE_VERB_IN = {
    call: 'called by', read: 'read by', write: 'written by', emit: 'published to by',
    consume: 'consumed by', http: 'reached by', import: 'imported by',
  };

  /**
   * Connections for one node, with the citation behind each. These are the
   * claims the map makes about how this thing is wired, so they belong on the
   * page rather than only in the highlight.
   */
  function connections(id) {
    const out = map.edges.filter((edge) => edge.from === id);
    const incoming = map.edges.filter((edge) => edge.to === id);
    if (out.length === 0 && incoming.length === 0) {
      return '<div class="panel__eyebrow">Connections</div><p>Nothing connects to this structure.</p>';
    }
    const row = (edge, other, verb) => {
      const node = nodeById.get(other);
      const inferred = edge.confidence === 'inferred' ? ' <span class="tag tag--warn">inferred</span>' : '';
      const label = edge.label ? ` <span class="hop__label">${esc(edge.label)}</span>` : '';
      const weight = edge.weight > 1 ? ` <span class="hop__label">${edge.weight} references</span>` : '';
      return `<div class="hop">`
        + `<button class="hop__jump" type="button" data-jump="${esc(other)}">`
        + `${esc(verb)} <strong>${esc(node ? node.label : other)}</strong></button>`
        + `${label}${weight}${inferred}</div>`
        + citation(edge.citation);
    };
    return '<div class="panel__eyebrow">Connections out</div>'
      + (out.length ? out.map((edge) => row(edge, edge.to, EDGE_VERB[edge.kind] || edge.kind)).join('') : '<p>None.</p>')
      + '<div class="panel__eyebrow">Connections in</div>'
      + (incoming.length ? incoming.map((edge) => row(edge, edge.from, EDGE_VERB_IN[edge.kind] || edge.kind)).join('') : '<p>None.</p>');
  }

  function metric(label, value) {
    return `<div class="metric"><div class="metric__label">${esc(label)}</div>`
      + `<div class="metric__value">${esc(value)}</div></div>`;
  }

  function flowPanel(flow, tab) {
    if (tab === 0) {
      const steps = flow.steps.map((step, i) => {
        const branch = step.branch ? ' <span class="step__branch">[branch]</span>' : '';
        return `<button class="step" type="button" data-step="${i}" aria-current="${i === state.stepIndex}">`
          + `<span class="step__hop">${i + 1}. ${esc(step.from)} &#8594; ${esc(step.to)}${branch}</span><br>`
          + `${esc(step.note)}</button>`;
      }).join('');
      return `<div class="panel__eyebrow">Selected flow</div>`
        + `<h2 class="panel__title">${esc(flow.label)}</h2>`
        + `<p class="lead">${esc(flow.summary)}</p>`
        + (flow.trigger ? `<div class="panel__eyebrow">Trigger</div><p>${esc(flow.trigger)}</p>` : '')
        + (flow.payload ? `<div class="panel__eyebrow">Payload</div><p><span class="tag">${esc(flow.payload)}</span></p>` : '')
        + `<div class="panel__eyebrow">Steps</div><div class="steps">${steps}</div>`;
    }
    const current = state.stepIndex >= 0 ? state.stepIndex : 0;
    return `<div class="panel__eyebrow">Evidence per step</div>`
      + `<h2 class="panel__title">${esc(flow.label)}</h2>`
      + flow.steps.map((step, i) => {
        const mark = i === current ? ' aria-current="true"' : '';
        return `<div class="step" data-step="${i}"${mark}><span class="step__hop">${i + 1}. ${esc(step.from)} &#8594; ${esc(step.to)}</span></div>`
          + citation(step.citation);
      }).join('');
  }

  function chapterPanel(tab) {
    const chapter = CHAPTERS[state.chapter];
    if (tab !== 0) return overviewPanel(1);
    const chips = (chapter.reveals || [])
      .map((id) => `<button class="chip" type="button" data-jump="${esc(id)}">`
        + `${esc(nodeById.get(id)?.label ?? id)}</button>`).join('');
    return `<div class="panel__eyebrow">Chapter ${state.chapter + 1} of ${CHAPTERS.length}</div>`
      + `<h2 class="panel__title">${esc(chapter.title)}</h2>`
      + `<p class="lead">${esc(chapter.lede)}</p>`
      + paragraphs(chapter.story)
      + (chips ? `<div class="panel__eyebrow">New in this chapter</div><div>${chips}</div>` : '')
      + (chapter.flow ? `<div class="panel__eyebrow">Flow shown</div>`
        + `<p>${esc(flowById.get(chapter.flow)?.summary ?? '')}</p>` : '')
      + `<div class="panel__eyebrow">The whole system</div>`
      + `<p>${esc(map.meta.subtitle || map.meta.title)} &mdash; `
      + `${map.nodes.length} structures, ${map.edges.length} connections. `
      + `Jump to the last chapter to see all of it at once.</p>`;
  }

  function overviewPanel(tab) {
    if (tab === 0) {
      return `<div class="panel__eyebrow">${esc(map.meta.repository)}</div>`
        + `<h2 class="panel__title">${esc(map.meta.title)}</h2>`
        + (map.meta.subtitle ? `<p class="lead">${esc(map.meta.subtitle)}</p>` : '')
        + paragraphs(map.meta.overview)
        + (map.meta.readingHint
          ? `<div class="panel__eyebrow">How to read it</div><p>${esc(map.meta.readingHint)}</p>` : '');
    }
    const inferredNodes = map.nodes.filter((n) => n.confidence === 'inferred').length;
    const inferredEdges = map.edges.filter((e) => e.confidence === 'inferred').length;
    return `<div class="panel__eyebrow">How this map was built</div>`
      + `<h2 class="panel__title">Provenance</h2>`
      + `<p>Every structure, connection and flow step on this map carries a citation to a
          file, a line, and a literal string found at that line. The map was rejected at
          build time until all of them resolved.</p>`
      + `<div class="metrics">`
      + metric('commit', map.meta.commit)
      + metric('branch', map.meta.branch || 'main')
      + metric('structures', map.nodes.length)
      + metric('connections', map.edges.length)
      + metric('traced flows', (map.flows || []).length)
      + metric('inferred', `${inferredNodes + inferredEdges}`)
      + `</div>`
      + `<div class="panel__eyebrow">Scope</div><p>${esc(map.meta.scope)}</p>`
      + (testAttribution.inScope
        ? `<div class="panel__eyebrow">Test coverage</div>`
          + `<p>${testAttribution.inScope} test file(s) in scope, ${testAttribution.attributed} `
          + `attributable to a structure.${testAttribution.reliable ? ''
            : ' Too few attribute cleanly to mark structures untested, so that marker is not shown '
              + '-- this repo names its tests after behaviour rather than after the file under test.'}</p>`
        : '')
      + (map.meta.omitted
        ? `<div class="panel__eyebrow">What is not shown</div>`
          + `<p class="concern">${map.meta.omitted.edges} connection(s) left off the map. `
          + `${esc(map.meta.omitted.note)}</p>`
        : '')
      + `<div class="panel__eyebrow">Geometry</div>`
      + `<p>Footprint tracks source file count, height tracks lines of code, and hatch
          density tracks how many other structures depend on it. Nothing here was chosen
          by eye. Dashed outlines are systems outside this repository, which is why they
          are hollow.</p>`;
  }

  function renderPanel() {
    const { subject, tab } = state;
    if (subject.type === 'node') panel.innerHTML = nodePanel(nodeById.get(subject.id), tab);
    else if (subject.type === 'flow') panel.innerHTML = flowPanel(flowById.get(subject.id), tab);
    else if (CHAPTERS.length > 0) panel.innerHTML = chapterPanel(tab);
    else panel.innerHTML = overviewPanel(tab);

    for (const button of panel.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', () => {
        navigator.clipboard?.writeText(button.dataset.copy);
        const original = button.style.borderLeftColor;
        button.style.borderLeftColor = 'var(--accent)';
        setTimeout(() => { button.style.borderLeftColor = original; }, 600);
      });
    }
    for (const button of panel.querySelectorAll('[data-jump]')) {
      button.addEventListener('click', () => selectNode(button.dataset.jump));
    }
    for (const button of panel.querySelectorAll('[data-step]')) {
      button.addEventListener('click', () => {
        state.stepIndex = Number(button.dataset.step) - 1;
        traceOneStep();
      });
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      state.tab = index;
      tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === index)));
      renderPanel();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea')) return;
    const nudge = 40 / view.scale;
    if (event.key === 'ArrowLeft') { view.x += nudge; applyView(); }
    else if (event.key === 'ArrowRight') { view.x -= nudge; applyView(); }
    else if (event.key === 'ArrowUp') { view.y += nudge; applyView(); }
    else if (event.key === 'ArrowDown') { view.y -= nudge; applyView(); }
    else if (event.key === ']' || event.key === 'Enter') setChapter(state.chapter + 1);
    else if (event.key === '[') setChapter(state.chapter - 1);
    else if (event.key === 'Escape') selectOverview();
    else if (event.key === '.') traceOneStep();
    else return;
    event.preventDefault();
  });

  buildChapterUI();
  if (CHAPTERS.length > 0) setChapter(state.chapter);
  else { applyView(); renderPanel(); }

  // Small seek API so flow playback is verifiable without a visible frame loop.
  // requestAnimationFrame does not fire in a hidden document, which is correct
  // for animation but makes the token path untestable in a headless check.
  window.__isomap = {
    seek(ms) {
      clock = ms;
      paintTokens(cycle > 0 ? clock % cycle : 0);
      return this.state;
    },
    selectFlow,
    selectNode,
    get state() {
      return {
        subject: { ...state.subject },
        flowId: state.flowId,
        playing: state.playing,
        stepIndex: state.stepIndex,
        cycle,
        shownStep,
        tokens: tokens.map((token) => ({
          stepIndex: token.stepIndex,
          start: Math.round(token.start),
          travel: Math.round(token.travel),
          dwell: Math.round(token.dwell),
          total: Math.round(token.total),
          length: Math.round(token.length),
          branch: token.branch,
          visible: token.el.style.visibility === 'visible',
          cx: Number(token.el.getAttribute('cx')) || null,
        })),
      };
    },
  };
})();
