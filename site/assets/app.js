import { store } from './store.js?v=4';
import { buildPlan, pace, streak, tagStats } from './plan.js?v=4';
import { todayStr, addDays, fmt, fmtLong, daysBetween, isoToLocalDay } from './dates.js?v=4';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

// ── Content loading ─────────────────────────────────────────
const cache = new Map();
function fetchCached(path, as) {
  if (!cache.has(path)) {
    const p = fetch(path, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return as === 'json' ? r.json() : r.text();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}
const getJSON = (p) => fetchCached(p, 'json');
const getText = (p) => fetchCached(p, 'text');

let course, lessonById, blockById;

// ── Helpers ─────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusOf = (id) => store.lesson(id).status;
const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const pct = (n) => `${Math.round(n * 100)}%`;

function md(text) {
  const html = window.marked ? window.marked.parse(text, { gfm: true }) : `<pre>${esc(text)}</pre>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  wrap.querySelectorAll('table').forEach((t) => {
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.replaceWith(w);
    w.appendChild(t);
  });
  wrap.querySelectorAll('h2, h3').forEach((h) => (h.id = 'sec-' + slug(h.textContent)));
  // Colour-code callouts by their leading emoji (alert, tip, commercial, memory aid).
  const tones = [[/^(🚨|⚠️|🔴)/u, 'bq-alert'], [/^(💡|🔑|⭐|🎯)/u, 'bq-tip'], [/^🏢/u, 'bq-commercial'], [/^(🧠|🧮|🧭|🔎|✅)/u, 'bq-memory']];
  wrap.querySelectorAll('blockquote').forEach((b) => {
    const tone = tones.find(([re]) => re.test(b.textContent.trim()));
    if (tone) b.classList.add(tone[1]);
  });
  return wrap;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard');
  }
}

function bestScore(p, lessonId) {
  const atts = p.quizAttempts.filter((a) => a.lessonId === lessonId && a.mode === 'lesson');
  if (!atts.length) return null;
  return Math.max(...atts.map((a) => a.score / a.total));
}

function statusPill(status, overdue) {
  if (overdue && status !== 'complete') return `<span class="pill pill-warn">Overdue</span>`;
  return `<span class="pill pill-${status}">${STATUS_LABEL[status]}</span>`;
}

function activityText(a) {
  const l = a.lessonId && lessonById[a.lessonId];
  const name = l ? `Lesson ${l.num}: ${l.title}` : '';
  switch (a.type) {
    case 'lesson_open': return `Studied ${name}`;
    case 'lesson_complete': return `Completed ${name}`;
    case 'lesson_reopen': return `Reopened ${name}`;
    case 'quiz': return `Quiz — ${name} · ${a.detail}`;
    case 'review': return `Review session · ${a.detail}`;
    case 'profile_created': return 'Joined';
    default: return a.type;
  }
}

// ── Timeline ────────────────────────────────────────────────
function timeline(plan, p, { compact = false } = {}) {
  if (!plan.ok) return `<div class="callout"><strong>Timeline couldn’t be created.</strong> ${plan.warnings.map(esc).join('<br>')} <a href="#/profile">Add dates →</a></div>`;
  const span = daysBetween(plan.start, plan.target);
  const pos = (d) => Math.min(100, Math.max(0, (daysBetween(plan.start, d) / span) * 100));
  const today = todayStr();
  // Stack dots that would overlap into rows: on the track, then above, then below.
  const minGap = compact ? 5.5 : 3;
  const rowEnds = [-Infinity, -Infinity, -Infinity];
  const ROW_OFFSET = [0, -26, 26];
  const dots = plan.lessons.map((pl) => {
    const l = lessonById[pl.id];
    const st = statusOf(pl.id);
    const cls = st === 'complete' ? 'done' : pl.due < today ? 'late' : st === 'in_progress' ? 'now' : '';
    const x = pos(pl.due);
    let row = rowEnds.findIndex((end) => x - end >= minGap);
    if (row === -1) row = rowEnds.indexOf(Math.min(...rowEnds));
    rowEnds[row] = x;
    return `<a class="tl-dot ${cls}" href="#/lesson/${l.id}" style="left:${x}%; margin-top:${ROW_OFFSET[row]}px" title="Lesson ${l.num}: ${esc(l.title)} — due ${fmt(pl.due)}">${l.num}</a>`;
  }).join('');
  const todayMark = today >= plan.start && today <= plan.target
    ? `<div class="tl-today" style="left:${pos(today)}%"><span>Today</span></div>` : '';
  return `
    <div class="timeline ${compact ? 'compact' : ''}">
      <div class="tl-track">
        <div class="tl-review" style="left:${pos(plan.reviewStart)}%; right:0" title="Review & mock exam period"></div>
        ${todayMark}
        ${dots}
      </div>
      <div class="tl-labels">
        <span>Start · ${fmt(plan.start)}</span>
        <span>${plan.examDate ? 'Exam' : 'Course end'} · ${fmt(plan.target)}</span>
      </div>
      ${compact ? '' : `<p class="tl-legend"><span class="tl-swatch"></span>Review &amp; mock exam period: ${fmt(plan.reviewStart)} – ${fmt(plan.target)}</p>`}
    </div>
    ${plan.warnings.length ? `<div class="callout callout-warn">${plan.warnings.map(esc).join('<br>')}</div>` : ''}`;
}

// ── Views ───────────────────────────────────────────────────
function viewWelcome() {
  const existing = store.profiles();
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">BC Real Estate Trading Services Licence</p>
      <h1>Your study companion</h1>
      <p class="lede">Plain-English lessons, quizzes that remember what you got wrong, and a timeline built from your own course dates. Written for people starting from zero.</p>
    </section>
    <form class="card form" id="welcome-form">
      <h2>Create your profile</h2>
      <p class="muted small">Stored only in this browser for now. You can export it any time from Profile.</p>
      <label>Your name <input name="name" required autocomplete="name" placeholder="e.g. Sandeep"></label>
      <label>Email <span class="muted">(optional, for summaries later)</span> <input name="email" type="email" autocomplete="email"></label>
      <fieldset>
        <legend>Course dates <span class="muted">(optional)</span></legend>
        <p class="muted small">Add the dates from your course enrolment to get a personal study timeline. You can skip this and add them later in Profile.</p>
        <div class="grid-3">
          <label>Course start <input name="courseStart" type="date"></label>
          <label>Course end <input name="courseEnd" type="date"></label>
          <label>Exam date <span class="muted">(optional)</span> <input name="examDate" type="date"></label>
        </div>
      </fieldset>
      ${studyDaysField([1, 2, 3, 4, 5, 6])}
      <button class="btn btn-primary" type="submit">Start studying</button>
      ${existing.length ? `<p class="small">Or <a href="#/profile">switch to an existing profile</a>.</p>` : ''}
    </form>`;
  app.querySelector('#welcome-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    store.createProfile({
      name: f.get('name').trim(),
      email: f.get('email').trim(),
      courseStart: f.get('courseStart'),
      courseEnd: f.get('courseEnd'),
      examDate: f.get('examDate'),
      studyDays: f.getAll('studyDays').map(Number),
    });
    location.hash = '#/';
  });
}

function studyDaysField(selected) {
  return `
    <fieldset>
      <legend>Study days</legend>
      <div class="chips">
        ${DAY_NAMES.map((d, i) => `<label class="chip"><input type="checkbox" name="studyDays" value="${i}" ${selected.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}
      </div>
    </fieldset>`;
}

function viewDashboard() {
  const p = store.active();
  const plan = buildPlan(course, p);
  const pc = pace(plan, p);
  const today = todayStr();
  const done = course.lessons.filter((l) => statusOf(l.id) === 'complete').length;
  const next = course.lessons.find((l) => statusOf(l.id) !== 'complete');
  const dueCount = store.reviewDue().length;
  const lessonAtts = p.quizAttempts.filter((a) => a.mode === 'lesson');
  const avg = lessonAtts.length ? lessonAtts.reduce((s, a) => s + a.score, 0) / lessonAtts.reduce((s, a) => s + a.total, 0) : null;
  const st = streak(p);
  const weak = tagStats(p).filter((t) => t.total >= 2 && t.pct < 0.75).sort((a, b) => a.pct - b.pct).slice(0, 5);
  const focus = plan.ok ? plan.lessons.filter((pl) => pl.start <= today && pl.due >= today && statusOf(pl.id) !== 'complete') : [];
  const recent = [...p.activity].reverse().filter((a) => a.type !== 'profile_created').slice(0, 6);
  const nextPlan = next && plan.ok ? plan.byId[next.id] : null;

  app.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">${fmtLong(today)}</p>
        <h1>Welcome back, ${esc(p.name.split(' ')[0])}</h1>
      </div>
      ${pc ? `<span class="badge badge-${pc.tone}">${esc(pc.label)}</span>` : ''}
    </section>

    <div class="stats">
      <div class="stat"><span class="stat-n">${done}<small>/${course.lessons.length}</small></span><span class="stat-l">Lessons complete</span></div>
      <div class="stat"><span class="stat-n">${avg === null ? '—' : pct(avg)}</span><span class="stat-l">Average quiz score</span></div>
      <a class="stat" href="#/review"><span class="stat-n">${dueCount}</span><span class="stat-l">Review questions due</span></a>
      <div class="stat"><span class="stat-n">${st}<small> day${st === 1 ? '' : 's'}</small></span><span class="stat-l">Study streak</span></div>
      <div class="stat"><span class="stat-n">${pc ? Math.max(0, pc.daysLeft) : '—'}</span><span class="stat-l">Days to ${plan.ok && plan.examDate ? 'exam' : 'course end'}</span></div>
    </div>

    <div class="grid-main">
      <div class="col">
        ${next ? `
        <section class="card next">
          <p class="eyebrow">${statusOf(next.id) === 'in_progress' ? 'Continue' : 'Up next'} · ${esc(blockById[next.block].title)}</p>
          <h2>Lesson ${next.num}: ${esc(next.title)}</h2>
          <p class="muted">${next.chapters.join(' · ')} · about ${next.estHours} h${nextPlan ? ` · planned for ${fmt(nextPlan.start)}–${fmt(nextPlan.due)}` : ''}</p>
          <p>${esc(next.summary)}</p>
          <div class="actions">
            <a class="btn btn-primary" href="#/lesson/${next.id}">${statusOf(next.id) === 'in_progress' ? 'Continue lesson' : 'Start lesson'}</a>
            ${next.quiz ? `<a class="btn" href="#/quiz/${next.id}">Take the quiz</a>` : ''}
          </div>
        </section>` : `<section class="card next"><h2>All lessons complete 🎉</h2><p>Keep your review queue at zero and start mock exams.</p></section>`}

        <section class="card">
          <div class="card-head"><h3>Your timeline</h3><a class="small" href="#/course">Full plan →</a></div>
          ${timeline(plan, p, { compact: true })}
          ${pc?.overdue.length ? `<p class="small warn-text">Overdue: ${pc.overdue.map((o) => `<a href="#/lesson/${o.id}">Lesson ${lessonById[o.id].num}</a>`).join(', ')}</p>` : ''}
          ${pc?.inReview ? `<p class="small">You're in the review window. Clear your review queue daily and retake the quizzes.</p>` : ''}
        </section>
      </div>

      <div class="col">
        <section class="card">
          <h3>Today's focus</h3>
          ${focus.length ? `<ul class="list">${focus.map((f) => `<li><a href="#/lesson/${f.id}">Lesson ${lessonById[f.id].num}: ${esc(lessonById[f.id].title)}</a><span class="muted small"> due ${fmt(f.due)}</span></li>`).join('')}</ul>`
            : `<p class="muted">${plan.ok ? 'Nothing scheduled today. A good day to clear reviews or get ahead.' : 'Add your course dates to get a daily plan.'}</p>`}
          ${dueCount ? `<a class="btn btn-small" href="#/review">Review ${dueCount} question${dueCount > 1 ? 's' : ''}</a>` : ''}
          ${plan.ok ? `<p class="muted small">Pace needed: about ${(plan.hoursPerStudyDay * 60).toFixed(0)} min per study day.</p>` : ''}
        </section>

        <section class="card">
          <h3>Weak spots</h3>
          ${weak.length ? `<ul class="list">${weak.map((w) => `<li>${esc(w.tag)} <span class="muted small">${w.right}/${w.total} correct</span></li>`).join('')}</ul>`
            : `<p class="muted">${p.quizAttempts.length ? 'Nothing flagged yet. Keep going.' : 'Take a quiz and topics you miss will show up here.'}</p>`}
        </section>

        <section class="card">
          <div class="card-head"><h3>Recent activity</h3><a class="small" href="#/summary">Summaries →</a></div>
          ${recent.length ? `<ul class="list feed">${recent.map((a) => `<li>${esc(activityText(a))}<span class="muted small">${fmt(isoToLocalDay(a.at))}</span></li>`).join('')}</ul>` : `<p class="muted">No activity yet.</p>`}
        </section>
      </div>
    </div>`;
}

function viewCourse() {
  const p = store.active();
  const plan = buildPlan(course, p);
  const today = todayStr();
  app.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">${esc(course.edition)}</p><h1>Course map</h1></div></section>
    <section class="card">${timeline(plan, p)}</section>
    ${course.blocks.map((b) => {
      const ls = course.lessons.filter((l) => l.block === b.id);
      return `
      <section class="block" data-b="${b.id}">
        <h2><span class="block-id">${b.id}</span> ${esc(b.title)}</h2>
        <p class="muted">${esc(b.blurb)}</p>
        <div class="lesson-rows">
          ${ls.map((l) => {
            const st = statusOf(l.id);
            const pl = plan.ok ? plan.byId[l.id] : null;
            const best = bestScore(p, l.id);
            return `
            <a class="lesson-row" href="#/lesson/${l.id}">
              <span class="lesson-num">${l.num}</span>
              <span class="lesson-main">
                <strong>${esc(l.title)}</strong>
                <span class="muted small">${l.chapters.join(' · ')} · ${l.estHours} h${l.status === 'coming_soon' ? ' · <em>lesson notes coming soon</em>' : ''}</span>
              </span>
              <span class="lesson-meta">
                ${pl ? `<span class="small muted">Due ${fmt(pl.due)}</span>` : ''}
                ${best !== null ? `<span class="small">Best ${pct(best)}</span>` : ''}
                ${statusPill(st, pl && pl.due < today)}
              </span>
            </a>`;
          }).join('')}
        </div>
      </section>`;
    }).join('')}`;
}

async function viewLesson(id) {
  const l = lessonById[id];
  if (!l) return viewNotFound();
  store.openLesson(id);
  const p = store.active();
  const plan = buildPlan(course, p);
  const pl = plan.ok ? plan.byId[id] : null;
  const prog = store.lesson(id);
  const idx = course.lessons.indexOf(l);
  const prev = course.lessons[idx - 1];
  const nextL = course.lessons[idx + 1];

  app.innerHTML = `
    <section class="lesson-head">
      <p class="eyebrow"><a href="#/course">Course</a> · Block ${l.block}: ${esc(blockById[l.block].title)}</p>
      <h1>Lesson ${l.num}: ${esc(l.title)}</h1>
      <p class="muted">${l.chapters.join(' · ')} · about ${l.estHours} h${pl ? ` · planned ${fmt(pl.start)}–${fmt(pl.due)}` : ''}</p>
      <div class="actions">
        ${l.cheatsheet ? `<a class="btn btn-small" href="#/lesson/${id}/cheatsheet">Cheat sheet</a>` : ''}
        ${l.quiz ? `<a class="btn btn-small" href="#/quiz/${id}">Quiz</a>` : ''}
      </div>
    </section>
    <div class="lesson-layout">
      <nav class="toc" id="toc"></nav>
      <article class="prose" id="lesson-body"><p class="muted">Loading…</p></article>
    </div>
    <section class="card lesson-foot">
      <div class="lesson-status">
        <span>Status: ${statusPill(prog.status)}</span>
        ${prog.status === 'complete'
          ? `<button class="btn btn-small" id="reopen">Mark as not complete</button>`
          : `<button class="btn btn-primary" id="complete">${l.status === 'ready' ? 'Mark lesson complete' : 'Mark chapter studied'}</button>`}
        ${l.quiz ? `<a class="btn" href="#/quiz/${id}">Take the quiz →</a>` : ''}
      </div>
      <label class="notes">My notes <span class="muted small" id="saved"></span>
        <textarea id="notes" rows="6" placeholder="Questions, examples, things to look up…">${esc(prog.notes || '')}</textarea>
      </label>
      <div class="pager">
        ${prev ? `<a href="#/lesson/${prev.id}">← Lesson ${prev.num}: ${esc(prev.title)}</a>` : '<span></span>'}
        ${nextL ? `<a href="#/lesson/${nextL.id}">Lesson ${nextL.num}: ${esc(nextL.title)} →</a>` : ''}
      </div>
    </section>`;

  app.querySelector('#complete')?.addEventListener('click', () => { store.setLessonStatus(id, 'complete'); toast('Nice work. Lesson marked complete.'); viewLesson(id); });
  app.querySelector('#reopen')?.addEventListener('click', () => { store.setLessonStatus(id, 'in_progress'); viewLesson(id); });
  let t;
  app.querySelector('#notes').addEventListener('input', (e) => {
    clearTimeout(t);
    app.querySelector('#saved').textContent = 'Saving…';
    t = setTimeout(() => { store.setNotes(id, e.target.value); app.querySelector('#saved').textContent = 'Saved'; }, 500);
  });

  const body = app.querySelector('#lesson-body');
  if (l.status !== 'ready') {
    body.innerHTML = `
      <div class="callout"><strong>Lesson notes for this one haven't been written yet.</strong> Study ${l.chapters.join(' and ')} in your course manual for now. Here's what it covers.</div>
      <p class="lede">${esc(l.summary)}</p>
      <h2>Topics</h2>
      <ul>${l.topics.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    return;
  }
  try {
    const content = md(await getText(`content/lessons/${id}.md`));
    body.replaceChildren(...content.childNodes);
    const heads = [...body.querySelectorAll('h2')];
    const toc = app.querySelector('#toc');
    if (heads.length > 2) {
      toc.innerHTML = `<p class="eyebrow">On this page</p>` + heads.map((h) => `<button data-target="${h.id}">${esc(h.textContent)}</button>`).join('');
      toc.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } catch {
    body.innerHTML = `<div class="callout callout-warn">Couldn't load this lesson file.</div>`;
  }
}

async function viewCheatsheet(id) {
  const l = lessonById[id];
  if (!l) return viewNotFound();
  app.innerHTML = `
    <section class="lesson-head">
      <p class="eyebrow"><a href="#/lesson/${id}">← Lesson ${l.num}</a></p>
      <h1>Cheat sheet: ${esc(l.title)}</h1>
      <div class="actions"><button class="btn btn-small" onclick="window.print()">Print</button>${l.quiz ? `<a class="btn btn-small" href="#/quiz/${id}">Quiz</a>` : ''}</div>
    </section>
    <article class="prose cheatsheet" id="cs"><p class="muted">Loading…</p></article>`;
  try {
    const content = md(await getText(`content/cheatsheets/${id}.md`));
    content.querySelector('h1')?.remove();
    app.querySelector('#cs').replaceChildren(...content.childNodes);
  } catch {
    app.querySelector('#cs').innerHTML = `<div class="callout callout-warn">No cheat sheet for this lesson yet.</div>`;
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffle answer choices so the correct position never gives the answer away.
// Set "fixedOrder": true on a question whose choices refer to each other.
function shuffleChoices(q) {
  if (q.fixedOrder) return q;
  const order = shuffle(q.choices.map((_, k) => k));
  return { ...q, choices: order.map((k) => q.choices[k]), answer: order.indexOf(q.answer) };
}

function runQuiz({ title, subtitle, questions, mode, lessonId, backHref }) {
  questions = questions.map(shuffleChoices);
  let i = 0;
  const answers = [];
  let locked = false;

  const onKey = (e) => {
    if (!document.body.contains(app.querySelector('.quiz'))) return document.removeEventListener('keydown', onKey);
    const n = Number(e.key);
    if (!locked && n >= 1 && n <= 9) app.querySelectorAll('.choice')[n - 1]?.click();
    else if (locked && e.key === 'Enter') app.querySelector('#next')?.click();
  };
  document.addEventListener('keydown', onKey);

  function renderQ() {
    locked = false;
    const q = questions[i];
    app.innerHTML = `
      <section class="quiz">
        <p class="eyebrow">${esc(title)}${subtitle ? ` · ${esc(subtitle)}` : ''}</p>
        <div class="quiz-progress"><div style="width:${(i / questions.length) * 100}%"></div></div>
        <p class="muted small">Question ${i + 1} of ${questions.length}${q.tag ? ` · ${esc(q.tag)}` : ''}</p>
        <h2 class="q">${esc(q.q)}</h2>
        <div class="choices">
          ${q.choices.map((c, k) => `<button class="choice" data-k="${k}"><span class="key">${k + 1}</span><span>${esc(c)}</span></button>`).join('')}
        </div>
        <div id="feedback"></div>
      </section>`;
    app.querySelectorAll('.choice').forEach((btn) => btn.addEventListener('click', () => choose(Number(btn.dataset.k))));
  }

  function choose(k) {
    if (locked) return;
    locked = true;
    const q = questions[i];
    const correct = k === q.answer;
    answers.push({ qid: q.id, lessonId: q.lessonId, tag: q.tag, choice: k, correct });
    app.querySelectorAll('.choice').forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) b.classList.add('right');
      else if (idx === k) b.classList.add('wrong');
    });
    app.querySelector('#feedback').innerHTML = `
      <div class="explain ${correct ? 'ok' : 'no'}">
        <strong>${correct ? 'Correct.' : 'Not quite.'}</strong> ${esc(q.explain)}
        ${q.ref ? `<p class="muted small">Source: ${esc(q.ref)}</p>` : ''}
      </div>
      <button class="btn btn-primary" id="next">${i + 1 < questions.length ? 'Next question' : 'See results'} <span class="muted small">↵</span></button>`;
    app.querySelector('#next').addEventListener('click', () => {
      i++;
      if (i < questions.length) renderQ();
      else finish();
    });
  }

  function finish() {
    document.removeEventListener('keydown', onKey);
    store.recordQuiz({ lessonId, mode, answers });
    const score = answers.filter((a) => a.correct).length;
    const ratio = score / answers.length;
    const missed = answers.filter((a) => !a.correct).map((a) => questions.find((q) => q.id === a.qid));
    const verdict = ratio >= 0.9 ? 'Exam-ready on this material.' : ratio >= 0.75 ? 'Solid. Tighten up the misses below.' : ratio >= 0.5 ? 'Getting there. Reread the sections behind the misses, then retake.' : 'Worth a second pass through the lesson before retaking.';
    app.innerHTML = `
      <section class="quiz">
        <p class="eyebrow">${esc(title)} · results</p>
        <h1 class="score">${score}<small>/${answers.length}</small> <span class="muted">(${pct(ratio)})</span></h1>
        <p class="lede">${verdict}</p>
        ${missed.length ? `<p class="muted">${missed.length} question${missed.length > 1 ? 's were' : ' was'} added to your review queue.</p>` : ''}
        <div class="actions">
          <a class="btn btn-primary" href="${backHref}">Done</a>
          ${mode === 'lesson' ? `<button class="btn" id="retake">Retake</button>` : ''}
          <a class="btn" href="#/review">Review queue</a>
        </div>
        ${missed.length ? `<h2>What you missed</h2>` + missed.map((q) => `
          <div class="missed">
            <p><strong>${esc(q.q)}</strong></p>
            <p class="right-text">✓ ${esc(q.choices[q.answer])}</p>
            <p class="muted">${esc(q.explain)}</p>
          </div>`).join('') : ''}
      </section>`;
    app.querySelector('#retake')?.addEventListener('click', () => render());
  }

  renderQ();
}

async function viewQuiz(id) {
  const l = lessonById[id];
  if (!l) return viewNotFound();
  if (!l.quiz) {
    app.innerHTML = `<section class="card"><h2>No quiz yet for Lesson ${l.num}</h2><p class="muted">It'll be added when the lesson notes are written.</p><a class="btn" href="#/lesson/${id}">Back to lesson</a></section>`;
    return;
  }
  const data = await getJSON(`content/quizzes/${id}.json`);
  const questions = shuffle(data.questions.map((q) => ({ ...q, lessonId: id })));
  runQuiz({ title: `Lesson ${l.num} quiz`, subtitle: l.title, questions, mode: 'lesson', lessonId: id, backHref: `#/lesson/${id}` });
}

async function loadAllQuestions() {
  const withQuiz = course.lessons.filter((l) => l.quiz);
  const sets = await Promise.all(withQuiz.map((l) => getJSON(`content/quizzes/${l.id}.json`).then((d) => d.questions.map((q) => ({ ...q, lessonId: l.id }))).catch(() => [])));
  return Object.fromEntries(sets.flat().map((q) => [q.id, q]));
}

async function viewReview() {
  const p = store.active();
  const due = store.reviewDue();
  const all = await loadAllQuestions();
  const qs = shuffle(due.map((d) => all[d.qid]).filter(Boolean)).slice(0, 20);
  if (!qs.length) {
    const upcoming = Object.values(p.review).map((r) => r.due).sort()[0];
    app.innerHTML = `
      <section class="card center">
        <h1>Nothing to review right now</h1>
        <p class="muted">Questions you miss in quizzes come back here on a schedule (1, 2, 4, 8, then 16 days) until you've got them right enough times in a row.</p>
        ${upcoming ? `<p>Next review due ${fmtLong(upcoming)} · ${Object.keys(p.review).length} question${Object.keys(p.review).length === 1 ? '' : 's'} in the queue.</p>` : ''}
        <a class="btn btn-primary" href="#/">Back to dashboard</a>
      </section>`;
    return;
  }
  runQuiz({ title: 'Review session', subtitle: `${qs.length} due`, questions: qs, mode: 'review', lessonId: null, backHref: '#/' });
}

function summaryData(p, from, to) {
  const inRange = p.activity.filter((a) => { const d = isoToLocalDay(a.at); return d >= from && d <= to; });
  const atts = p.quizAttempts.filter((a) => { const d = isoToLocalDay(a.at); return d >= from && d <= to; });
  const completed = [...new Set(inRange.filter((a) => a.type === 'lesson_complete').map((a) => a.lessonId))];
  const studied = [...new Set(inRange.filter((a) => a.type === 'lesson_open').map((a) => a.lessonId))];
  const activeDays = new Set(inRange.filter((a) => a.type !== 'profile_created').map((a) => isoToLocalDay(a.at))).size;
  const answered = atts.reduce((s, a) => s + a.total, 0);
  const right = atts.reduce((s, a) => s + a.score, 0);
  return { completed, studied, atts, activeDays, answered, right };
}

function viewSummary(period = 'day') {
  const p = store.active();
  const plan = buildPlan(course, p);
  const pc = pace(plan, p);
  const today = todayStr();
  const from = period === 'week' ? addDays(today, -6) : today;
  const s = summaryData(p, from, today);
  const ahead = period === 'week' ? addDays(today, 7) : addDays(today, 1);
  const upcoming = plan.ok ? plan.lessons.filter((l) => l.due > today && l.due <= ahead && statusOf(l.id) !== 'complete') : [];
  const focus = plan.ok ? plan.lessons.filter((pl) => pl.start <= today && pl.due >= today && statusOf(pl.id) !== 'complete') : [];
  const weak = tagStats(p).filter((t) => t.total >= 2 && t.pct < 0.75).sort((a, b) => a.pct - b.pct).slice(0, 3);
  const dueCount = store.reviewDue().length;
  const L = (id) => `Lesson ${lessonById[id].num}: ${lessonById[id].title}`;

  const lines = [
    `${period === 'week' ? 'Weekly' : 'Daily'} study summary — ${p.name}`,
    period === 'week' ? `${fmtLong(from)} to ${fmtLong(today)}` : fmtLong(today),
    '',
    pc ? `Pace: ${pc.label}. ${pc.done}/${course.lessons.length} lessons complete, ${Math.max(0, pc.daysLeft)} days to ${plan.examDate ? 'exam' : 'course end'}.` : 'Pace: add course dates to track pace.',
    (period === 'week' ? `Active days: ${s.activeDays}/7 · ` : '') + `Streak: ${streak(p)} day${streak(p) === 1 ? '' : 's'}`,
    '',
    'Done:',
    ...(s.completed.length ? s.completed.map((id) => `  ✓ Completed ${L(id)}`) : []),
    ...(s.studied.filter((id) => !s.completed.includes(id)).map((id) => `  • Studied ${L(id)}`)),
    ...(s.atts.map((a) => `  • ${a.mode === 'review' ? 'Review session' : 'Quiz: ' + L(a.lessonId)} — ${a.score}/${a.total}`)),
    ...(!s.completed.length && !s.studied.length && !s.atts.length ? ['  (no activity)'] : []),
    s.answered ? `  Accuracy: ${pct(s.right / s.answered)} across ${s.answered} questions` : '',
    '',
    period === 'week' ? 'Coming up this week:' : 'Next:',
    ...(focus.map((f) => `  → Scheduled now: ${L(f.id)} (due ${fmt(f.due)})`)),
    ...(upcoming.filter((u) => !focus.find((f) => f.id === u.id)).map((u) => `  → ${L(u.id)} due ${fmt(u.due)}`)),
    dueCount ? `  → ${dueCount} review question${dueCount > 1 ? 's' : ''} due` : '',
    ...(weak.length ? ['', 'Weak spots:', ...weak.map((w) => `  ! ${w.tag} (${w.right}/${w.total})`)] : []),
  ].filter((x, k, arr) => !(x === '' && arr[k - 1] === ''));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  app.innerHTML = `
    <section class="page-head">
      <div><p class="eyebrow">Summaries</p><h1>${period === 'week' ? 'This week' : 'Today'}</h1></div>
      <div class="tabs">
        <a class="tab ${period === 'day' ? 'on' : ''}" href="#/summary">Daily</a>
        <a class="tab ${period === 'week' ? 'on' : ''}" href="#/summary/week">Weekly</a>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><span class="stat-n">${s.completed.length}</span><span class="stat-l">Lessons completed</span></div>
      <div class="stat"><span class="stat-n">${s.atts.length}</span><span class="stat-l">Quizzes &amp; reviews</span></div>
      <div class="stat"><span class="stat-n">${s.answered ? pct(s.right / s.answered) : '—'}</span><span class="stat-l">Accuracy</span></div>
      ${period === 'week' ? `<div class="stat"><span class="stat-n">${s.activeDays}<small>/7</small></span><span class="stat-l">Active days</span></div>` : `<div class="stat"><span class="stat-n">${dueCount}</span><span class="stat-l">Reviews due</span></div>`}
    </div>
    <section class="card">
      <div class="card-head"><h3>Shareable summary</h3><button class="btn btn-small" id="copy">Copy text</button></div>
      <pre class="summary-text">${esc(text)}</pre>
      <p class="muted small">Automatic email or chat delivery can be wired up later. This text is the format it will use.</p>
    </section>`;
  app.querySelector('#copy').addEventListener('click', () => copyText(text));
}

async function viewGlossary() {
  const terms = (await getJSON('content/glossary.json')).sort((a, b) => a.term.localeCompare(b.term));
  app.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">Plain-English definitions</p><h1>Glossary</h1></div></section>
    <input class="search" id="q" type="search" placeholder="Search ${terms.length} terms…" autofocus>
    <div id="terms" class="terms"></div>`;
  const out = app.querySelector('#terms');
  const draw = (f = '') => {
    const ql = f.toLowerCase();
    const hits = terms.filter((t) => !ql || t.term.toLowerCase().includes(ql) || t.def.toLowerCase().includes(ql));
    out.innerHTML = hits.length ? hits.map((t) => `
      <div class="term">
        <h3>${esc(t.term)}</h3>
        <p>${esc(t.def)}</p>
        ${t.lesson && lessonById[t.lesson] ? `<a class="small" href="#/lesson/${t.lesson}">Lesson ${lessonById[t.lesson].num}: ${esc(lessonById[t.lesson].title)}</a>` : ''}
      </div>`).join('') : `<p class="muted">No matches.</p>`;
  };
  app.querySelector('#q').addEventListener('input', (e) => draw(e.target.value));
  draw();
}

function viewProfile() {
  const p = store.active();
  const others = store.profiles().filter((x) => x.id !== p?.id);
  app.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">Profile</p><h1>${esc(p.name)}</h1></div></section>
    <form class="card form" id="pf">
      <h2>Details and course dates</h2>
      <div class="grid-2">
        <label>Name <input name="name" value="${esc(p.name)}" required></label>
        <label>Email <input name="email" type="email" value="${esc(p.email)}"></label>
      </div>
      <fieldset>
        <legend>Course dates</legend>
        <div class="grid-3">
          <label>Course start <input name="courseStart" type="date" value="${esc(p.dates.courseStart)}"></label>
          <label>Course end <input name="courseEnd" type="date" value="${esc(p.dates.courseEnd)}"></label>
          <label>Exam date <input name="examDate" type="date" value="${esc(p.dates.examDate)}"></label>
        </div>
      </fieldset>
      ${studyDaysField(p.prefs.studyDays || [])}
      <button class="btn btn-primary" type="submit">Save changes</button>
    </form>

    <section class="card">
      <h2>Profiles on this device</h2>
      <ul class="list">
        <li><strong>${esc(p.name)}</strong> <span class="muted small">(active)</span></li>
        ${others.map((o) => `<li>${esc(o.name)} <span class="row-actions"><button class="btn btn-small" data-switch="${o.id}">Switch</button><button class="btn btn-small btn-danger" data-del="${o.id}">Delete</button></span></li>`).join('')}
      </ul>
      <a class="btn btn-small" href="#/welcome">+ Add another profile</a>
    </section>

    <section class="card">
      <h2>Backup and transfer</h2>
      <p class="muted">Your progress lives in this browser. Export it to keep a backup or move it to another computer.</p>
      <div class="actions">
        <button class="btn" id="export">Export my progress</button>
        <label class="btn">Import a profile file<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn btn-danger" id="delete-me">Delete this profile</button>
      </div>
    </section>`;

  app.querySelector('#pf').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    store.updateProfile({
      name: f.get('name').trim(),
      email: f.get('email').trim(),
      dates: { courseStart: f.get('courseStart'), courseEnd: f.get('courseEnd'), examDate: f.get('examDate') },
      prefs: { studyDays: f.getAll('studyDays').map(Number) },
    });
    toast('Saved. Your timeline has been rebuilt.');
    renderNav();
  });
  app.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => { store.switchTo(b.dataset.switch); location.hash = '#/'; }));
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Delete this profile and all its progress? This cannot be undone.')) { store.deleteProfile(b.dataset.del); render(); }
  }));
  app.querySelector('#delete-me').addEventListener('click', () => {
    if (confirm(`Delete ${p.name}'s profile and all progress? Export first if you want a backup. This cannot be undone.`)) { store.deleteProfile(p.id); location.hash = store.active() ? '#/' : '#/welcome'; render(); }
  });
  app.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([store.exportActive()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `study-progress-${slug(p.name)}-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  app.querySelector('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const imported = store.importProfile(await file.text());
      toast(`Imported ${imported.name}`);
      location.hash = '#/';
    } catch (err) {
      alert(`Couldn't import that file: ${err.message}`);
    }
  });
}

function viewNotFound() {
  app.innerHTML = `<section class="card center"><h1>Page not found</h1><a class="btn" href="#/">Go to dashboard</a></section>`;
}

// ── Shell ───────────────────────────────────────────────────
function renderNav() {
  const p = store.active();
  const route = location.hash || '#/';
  const due = p ? store.reviewDue().length : 0;
  const link = (href, label, match) => `<a href="${href}" class="${match.test(route) ? 'on' : ''}">${label}</a>`;
  nav.innerHTML = p ? `
    ${link('#/', 'Dashboard', /^#\/?$/)}
    ${link('#/course', 'Course', /^#\/(course|lesson|quiz)/)}
    ${link('#/review', `Review${due ? ` <span class="count">${due}</span>` : ''}`, /^#\/review/)}
    ${link('#/summary', 'Summaries', /^#\/summary/)}
    ${link('#/glossary', 'Glossary', /^#\/glossary/)}
    <a href="#/profile" class="profile-chip ${/^#\/profile/.test(route) ? 'on' : ''}" title="Profile">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</a>` : '';
}

async function render() {
  const route = location.hash || '#/';
  renderNav();
  if (!store.active() && route !== '#/welcome') { location.hash = '#/welcome'; return; }
  window.scrollTo(0, 0);
  let m;
  try {
    if (route === '#/welcome') viewWelcome();
    else if (/^#\/?$/.test(route)) viewDashboard();
    else if (route === '#/course') viewCourse();
    else if ((m = route.match(/^#\/lesson\/(\d+)\/cheatsheet$/))) await viewCheatsheet(m[1]);
    else if ((m = route.match(/^#\/lesson\/(\d+)$/))) await viewLesson(m[1]);
    else if ((m = route.match(/^#\/quiz\/(\d+)$/))) await viewQuiz(m[1]);
    else if (route === '#/review') await viewReview();
    else if (route === '#/summary') viewSummary('day');
    else if (route === '#/summary/week') viewSummary('week');
    else if (route === '#/glossary') await viewGlossary();
    else if (route === '#/profile') viewProfile();
    else viewNotFound();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<section class="card callout-warn"><h2>Something went wrong</h2><p>${esc(err.message)}</p><p class="muted small">If you opened this file directly, run it through a local server instead (see README).</p></section>`;
  }
  renderNav();
}

async function boot() {
  try {
    course = await getJSON('content/course.json');
  } catch {
    app.innerHTML = `<section class="card callout-warn"><h2>Couldn't load the course</h2><p>Open this site through a local web server, not by double-clicking the file. See README.md.</p></section>`;
    return;
  }
  lessonById = Object.fromEntries(course.lessons.map((l) => [l.id, l]));
  blockById = Object.fromEntries(course.blocks.map((b) => [b.id, b]));
  window.addEventListener('hashchange', render);
  render();
}

boot();
