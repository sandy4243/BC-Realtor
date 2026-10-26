// Turns a learner's course dates into a study timeline.
//
// - The target is the exam date if set, otherwise the course end date.
// - The last stretch before the target is reserved for review and mock exams
//   (15% of the window, between 3 and 21 days).
// - Lessons are spread across the learner's chosen study weekdays in
//   proportion to each lesson's estimated hours.

import { addDays, daysBetween, todayStr, weekday, isoToLocalDay } from './dates.js?v=4';

export function buildPlan(course, profile) {
  const { courseStart, courseEnd, examDate } = profile.dates;
  const warnings = [];
  if (!courseStart && !courseEnd && !examDate) return { ok: false, warnings: ['No course dates have been added yet. Lessons, quizzes and reviews all work without them.'] };
  if (!courseStart || !(courseEnd || examDate)) return { ok: false, warnings: ['It needs both a course start date and a course end (or exam) date.'] };

  const target = examDate || courseEnd;
  if (examDate && courseEnd && examDate > courseEnd) warnings.push('Your exam date is after your course end date. Double-check both dates against your enrolment records.');

  const span = daysBetween(courseStart, target);
  if (span < 7) return { ok: false, warnings: ['Your course window is less than a week, so a timeline can’t be built. Check your dates.'] };

  const buffer = Math.min(21, Math.max(3, Math.round(span * 0.15)));
  const contentEnd = addDays(target, -buffer);
  const studyWeekdays = profile.prefs.studyDays?.length ? profile.prefs.studyDays : [1, 2, 3, 4, 5, 6];

  const studyDates = [];
  for (let d = courseStart; d <= contentEnd; d = addDays(d, 1)) {
    if (studyWeekdays.includes(weekday(d))) studyDates.push(d);
  }
  if (!studyDates.length) return { ok: false, warnings: ['No study days fall inside your course window. Check your dates and study days.'] };

  const totalHours = course.lessons.reduce((s, l) => s + l.estHours, 0);
  let cum = 0;
  const lessons = course.lessons.map((l) => {
    const startIdx = Math.min(studyDates.length - 1, Math.floor((cum / totalHours) * studyDates.length));
    cum += l.estHours;
    const endIdx = Math.max(startIdx, Math.ceil((cum / totalHours) * studyDates.length) - 1);
    return { id: l.id, start: studyDates[startIdx], due: studyDates[endIdx] };
  });

  return {
    ok: true,
    warnings,
    start: courseStart,
    target,
    courseEnd,
    examDate,
    reviewStart: addDays(contentEnd, 1),
    lessons,
    byId: Object.fromEntries(lessons.map((l) => [l.id, l])),
    studyDayCount: studyDates.length,
    hoursPerStudyDay: totalHours / studyDates.length,
    totalHours,
  };
}

// Where the learner stands against their plan today.
export function pace(plan, profile, today = todayStr()) {
  if (!plan?.ok) return null;
  const done = plan.lessons.filter((l) => profile.progress[l.id]?.status === 'complete').length;
  const expected = plan.lessons.filter((l) => l.due < today).length;
  const diff = done - expected;
  const overdue = plan.lessons.filter((l) => l.due < today && profile.progress[l.id]?.status !== 'complete');
  let label, tone;
  if (today < plan.start) { label = 'Course hasn’t started yet'; tone = 'neutral'; }
  else if (diff >= 1) { label = `Ahead by ${diff} lesson${diff > 1 ? 's' : ''}`; tone = 'good'; }
  else if (diff === 0) { label = 'On track'; tone = 'good'; }
  else { label = `Behind by ${-diff} lesson${diff < -1 ? 's' : ''}`; tone = 'warn'; }
  return {
    done, expected, diff, overdue, label, tone,
    daysLeft: daysBetween(today, plan.target),
    inReview: today >= plan.reviewStart,
  };
}

// Consecutive days with any study activity, ending today (or yesterday).
export function streak(profile, today = todayStr()) {
  const days = new Set(profile.activity.filter((a) => a.type !== 'profile_created').map((a) => isoToLocalDay(a.at)));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Accuracy per question tag across all quiz attempts.
export function tagStats(profile) {
  const t = {};
  for (const att of profile.quizAttempts) {
    for (const a of att.answers) {
      if (!a.tag) continue;
      t[a.tag] ??= { tag: a.tag, right: 0, total: 0 };
      t[a.tag].total++;
      if (a.correct) t[a.tag].right++;
    }
  }
  return Object.values(t).map((x) => ({ ...x, pct: x.right / x.total }));
}
