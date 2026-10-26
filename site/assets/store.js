// Data layer. Everything the app persists goes through this module.
// Today it's backed by localStorage (one browser, many profiles). To move to a
// real backend (multi-device, shared profiles), replace load()/save() and keep
// the exported API the same.

import { todayStr, addDays, isoToLocalDay as toLocalDay } from './dates.js?v=5';

const KEY = 'cre-study.v1';
const REVIEW_INTERVALS = [0, 1, 2, 4, 8, 16]; // days, indexed by Leitner box 1–5

function blank() {
  return { version: 1, activeProfileId: null, profiles: {} };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : blank();
  } catch {
    return blank();
  }
}

let db = load();
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('Could not save progress', e);
  }
  listeners.forEach((fn) => fn());
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function newProfile({ name, email = '', courseStart = '', courseEnd = '', examDate = '', studyDays = [1, 2, 3, 4, 5, 6] }) {
  return {
    id: uid(),
    name,
    email,
    createdAt: new Date().toISOString(),
    dates: { courseStart, courseEnd, examDate },
    prefs: { studyDays },
    progress: {},      // lessonId -> { status, startedAt, completedAt, notes }
    quizAttempts: [],  // { lessonId, mode, at, score, total, answers: [{ qid, tag, correct }] }
    review: {},        // qid -> { lessonId, box, due, lapses }
    activity: [],      // { at, type, lessonId?, detail? }
  };
}

function active() {
  return db.profiles[db.activeProfileId] || null;
}

function mutate(fn) {
  const p = active();
  if (!p) return;
  fn(p);
  save();
}

function log(p, type, data = {}) {
  p.activity.push({ at: new Date().toISOString(), type, ...data });
  if (p.activity.length > 2000) p.activity.splice(0, p.activity.length - 2000);
}

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ── Profiles ──────────────────────────────────────────────
  profiles() {
    return Object.values(db.profiles).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  active,
  createProfile(data) {
    const p = newProfile(data);
    db.profiles[p.id] = p;
    db.activeProfileId = p.id;
    log(p, 'profile_created');
    save();
    return p;
  },
  updateProfile(patch) {
    mutate((p) => {
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.email !== undefined) p.email = patch.email;
      if (patch.dates) Object.assign(p.dates, patch.dates);
      if (patch.prefs) Object.assign(p.prefs, patch.prefs);
    });
  },
  switchTo(id) {
    if (db.profiles[id]) {
      db.activeProfileId = id;
      save();
    }
  },
  deleteProfile(id) {
    delete db.profiles[id];
    if (db.activeProfileId === id) db.activeProfileId = Object.keys(db.profiles)[0] || null;
    save();
  },

  // ── Lessons ───────────────────────────────────────────────
  lesson(lessonId) {
    const p = active();
    return (p && p.progress[lessonId]) || { status: 'not_started', notes: '' };
  },
  openLesson(lessonId) {
    mutate((p) => {
      const cur = p.progress[lessonId] || { status: 'not_started', notes: '' };
      if (cur.status === 'not_started') {
        cur.status = 'in_progress';
        cur.startedAt = new Date().toISOString();
      }
      p.progress[lessonId] = cur;
      const today = todayStr();
      const already = p.activity.some((a) => a.type === 'lesson_open' && a.lessonId === lessonId && toLocalDay(a.at) === today);
      if (!already) log(p, 'lesson_open', { lessonId });
    });
  },
  setLessonStatus(lessonId, status) {
    mutate((p) => {
      const cur = p.progress[lessonId] || { notes: '' };
      cur.status = status;
      if (status === 'complete') cur.completedAt = new Date().toISOString();
      if (status !== 'complete') delete cur.completedAt;
      p.progress[lessonId] = cur;
      log(p, status === 'complete' ? 'lesson_complete' : 'lesson_reopen', { lessonId });
    });
  },
  setNotes(lessonId, notes) {
    mutate((p) => {
      const cur = p.progress[lessonId] || { status: 'not_started' };
      cur.notes = notes;
      p.progress[lessonId] = cur;
    });
  },

  // ── Quizzes and review (Leitner boxes) ─────────────────────
  recordQuiz({ lessonId, mode, answers }) {
    mutate((p) => {
      const score = answers.filter((a) => a.correct).length;
      p.quizAttempts.push({ lessonId, mode, at: new Date().toISOString(), score, total: answers.length, answers });
      const today = todayStr();
      for (const a of answers) {
        const item = p.review[a.qid];
        if (!a.correct) {
          p.review[a.qid] = { lessonId: a.lessonId || lessonId, box: 1, due: mode === 'review' ? addDays(today, 1) : today, lapses: (item?.lapses || 0) + 1 };
        } else if (item) {
          const box = item.box + 1;
          if (box > 5) delete p.review[a.qid];
          else p.review[a.qid] = { ...item, box, due: addDays(today, REVIEW_INTERVALS[box]) };
        }
      }
      log(p, mode === 'review' ? 'review' : 'quiz', { lessonId, detail: `${score}/${answers.length}` });
    });
  },
  reviewDue(today = todayStr()) {
    const p = active();
    if (!p) return [];
    return Object.entries(p.review)
      .filter(([, r]) => r.due <= today)
      .map(([qid, r]) => ({ qid, ...r }));
  },

  // ── Portability ───────────────────────────────────────────
  exportActive() {
    return JSON.stringify({ format: 'cre-study-profile', version: 1, profile: active() }, null, 2);
  },
  importProfile(json) {
    const data = JSON.parse(json);
    if (data.format !== 'cre-study-profile' || !data.profile?.id) throw new Error('Not a study profile export file.');
    db.profiles[data.profile.id] = data.profile;
    db.activeProfileId = data.profile.id;
    save();
    return data.profile;
  },
};
