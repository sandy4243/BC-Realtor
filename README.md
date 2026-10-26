# BC Licence Study Companion

A study site for the BC Real Estate Trading Services licensing course: plain-English lessons, quizzes with a spaced-review queue, a personal timeline built from each learner's course dates, and daily/weekly summaries.

## Run it locally

```bash
python3 serve.py
```

Then open http://127.0.0.1:8765. It has to be served over HTTP; double-clicking `index.html` won't work.

## What's where

```
site/                       ← the website (this folder is what gets published)
  index.html
  assets/
    app.js                  screens and routing
    store.js                all saved data (profiles, progress, quizzes, reviews)
    plan.js                 timeline, pace, streak, weak-spot calculations
    dates.js                date helpers
    styles.css
  content/                  ← edit these to add or change course material
    course.json             lesson list, chapters, hours, topics, status
    lessons/NN.md           lesson text (Markdown)
    cheatsheets/NN.md       one-page revision sheets
    quizzes/NN.json         quiz questions
    glossary.json           plain-English definitions
study/                      planning notes (STUDY-PLAN.md, PROGRESS.md)
serve.py                    local server
```

## Adding a lesson

1. Write `site/content/lessons/NN.md`. Each `##` heading becomes an entry in the lesson's "On this page" menu. Hide model answers in `<details><summary>Model answer</summary> … </details>` (leave a blank line after `<summary>`).
2. Optionally add `site/content/cheatsheets/NN.md` and `site/content/quizzes/NN.json`.
3. In `course.json`, set the lesson's `"status": "ready"`, plus `"quiz": true` / `"cheatsheet": true` if those files exist.
4. Add new terms to `glossary.json` with `"lesson": "NN"`.

### Quiz question format

```json
{
  "id": "02-001",
  "tag": "Co-ownership",
  "q": "Question text",
  "choices": ["A", "B", "C", "D"],
  "answer": 1,
  "explain": "Why the answer is right.",
  "ref": "Lesson 2 · Section name"
}
```

- `answer` is the zero-based index into `choices`. Choices are shuffled every time a question is shown, so the order in the file doesn't matter. Add `"fixedOrder": true` if a choice refers to another one (e.g. "Both A and B").
- `tag` groups questions into topics for the dashboard's weak-spots panel.
- `id` must never change once published. Learners' review history is keyed on it.

## Caching

GitHub Pages tells browsers to cache files for 10 minutes. Content files (`site/content/`) are always revalidated, so new lessons appear on the next page load. Code files are not: when you change anything in `site/assets/`, bump the `?v=N` number everywhere it appears (`index.html` and the `import` lines in the `.js` files) so browsers fetch the new version.

## How progress works

- **Profiles** live in the browser's localStorage. Several people can have profiles on one device. Profile → Export downloads a JSON backup that can be imported on another computer.
- **Timeline**: the course start date plus the exam date (or course end date if no exam date is set) define the window. The last ~15% (3–21 days) is reserved for review. Lessons are spread across the learner's chosen study days in proportion to their estimated hours.
- **Review queue**: a missed question goes into box 1 (due today). Each correct review moves it up a box (due again in 1, 2, 4, 8, then 16 days); a miss sends it back to box 1. After box 5 it graduates out of the queue.
- **Summaries** are generated from the activity log. The copyable text is the planned format for future email or chat delivery.

## Roadmap

- **GitHub Pages**: publish only the `site/` folder (e.g. a GitHub Actions workflow that uploads `site/`).
- **Real user accounts**: swap the inside of `store.js` for a hosted backend (e.g. Supabase auth + Postgres) so progress follows the learner across devices. The screens only talk to `store`'s API, so they won't need to change.
- **Automated summaries**: a scheduled job that emails each learner their daily/weekly summary (needs the backend).

## ⚠️ Copyright

The UBC Sauder course manual is copyrighted, all rights reserved. **Never commit or publish** the chapter PDFs, the `.epub`, or `study/_text/` (the extracted text). `.gitignore` already excludes them. Everything under `site/content/` should be original teaching notes in our own words, with at most occasional short quotes, because a GitHub Pages site is public.
