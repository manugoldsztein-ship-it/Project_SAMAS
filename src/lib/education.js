// ============================================================
// education.js (samas-0.4.35) — Tutorials progress + streak
// ============================================================
// Tracks completion state for the Duolingo-style Tutorials hub.
// Two pieces of state, both in localStorage:
//
//   samas_tutorials_v2  = { completed: Record<id, dateISO>, totalXp: number }
//   samas_streak_v2     = { lastDay: "YYYY-MM-DD", current: number, longest: number }
//
// Day boundary is local-time ISO date (YYYY-MM-DD). A "completion"
// counts toward the streak only on the FIRST tutorial completed
// per local-time day; subsequent completions in the same day don't
// inflate the streak (but do add XP).
//
// SECURITY / PRIVACY: all client-side, no server round-trip. We
// don't need the server to know about tutorials read state for the
// pitch. Eventually (post-launch) sync to a profile_education table
// so progress survives reinstall — that's a 0.5+ patch.
// ============================================================

const KEY_PROGRESS = "samas_tutorials_v2";
const KEY_STREAK   = "samas_streak_v2";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a, b) {
  if (!a || !b) return 9999;
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db - da) / (24 * 3600 * 1000));
}

export function getProgress() {
  if (typeof localStorage === "undefined") return { completed: {}, totalXp: 0 };
  try {
    const raw = localStorage.getItem(KEY_PROGRESS);
    if (!raw) return { completed: {}, totalXp: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object") return { completed: {}, totalXp: 0 };
    return {
      completed: parsed.completed || {},
      totalXp: Number(parsed.totalXp) || 0,
    };
  } catch { return { completed: {}, totalXp: 0 }; }
}

function saveProgress(p) {
  try { localStorage.setItem(KEY_PROGRESS, JSON.stringify(p)); } catch { /* ignore */ }
}

export function getStreak() {
  if (typeof localStorage === "undefined") return { current: 0, longest: 0, lastDay: null };
  try {
    const raw = localStorage.getItem(KEY_STREAK);
    if (!raw) return { current: 0, longest: 0, lastDay: null };
    const parsed = JSON.parse(raw);
    // Auto-decay: if lastDay is >1 day in the past, current → 0.
    // (We don't reset until the user opens the app a 2+-day-late
    // session, which mirrors how Duolingo computes it lazily.)
    const t = todayISO();
    const since = daysBetween(parsed.lastDay, t);
    if (since > 1) {
      return { current: 0, longest: parsed.longest || 0, lastDay: parsed.lastDay || null };
    }
    return {
      current: Number(parsed.current) || 0,
      longest: Number(parsed.longest) || 0,
      lastDay: parsed.lastDay || null,
    };
  } catch { return { current: 0, longest: 0, lastDay: null }; }
}

function saveStreak(s) {
  try { localStorage.setItem(KEY_STREAK, JSON.stringify(s)); } catch { /* ignore */ }
}

// Mark a tutorial as completed. Idempotent on FIRST completion (XP +
// streak only awarded once). Subsequent re-completions can improve the
// best score (perfect run unlocks a star).
// Returns { gainedXp, streakChanged, newPerfect } so callers can render
// a celebration.
//
// 0.4.69 — added `bonusXp` for quiz-based scoring. Base XP comes from
// the tutorial's xp field; bonus is +2 per first-try-correct question.
export function completeTutorial(tutorialId, xp = 10, bonusXp = 0, perfect = false) {
  if (!tutorialId) return { gainedXp: 0, streakChanged: false, newPerfect: false };
  const t = todayISO();
  const progress = getProgress();
  const prior = progress.completed[tutorialId];
  const wasCompleted = !!prior;
  const totalXp = xp + (bonusXp || 0);
  let gainedXp = 0;
  let newPerfect = false;
  if (!wasCompleted) {
    progress.completed[tutorialId] = t;
    progress.totalXp = (progress.totalXp || 0) + totalXp;
    if (perfect) {
      progress.perfectIds = progress.perfectIds || {};
      progress.perfectIds[tutorialId] = true;
      newPerfect = true;
    }
    gainedXp = totalXp;
    saveProgress(progress);
  } else if (perfect && !(progress.perfectIds || {})[tutorialId]) {
    // First time getting a perfect run on a tutorial already completed
    // (e.g. user redid it). Award only the bonus + the perfect star.
    progress.perfectIds = progress.perfectIds || {};
    progress.perfectIds[tutorialId] = true;
    progress.totalXp = (progress.totalXp || 0) + (bonusXp || 0);
    gainedXp = bonusXp || 0;
    newPerfect = true;
    saveProgress(progress);
  }

  // Streak: only bumps on first completion of the day, regardless
  // of whether THIS tutorial was new or a re-read.
  let streakChanged = false;
  const streak = getStreak();
  if (streak.lastDay !== t) {
    const since = daysBetween(streak.lastDay, t);
    let next;
    if (since === 1) next = (streak.current || 0) + 1;
    else next = 1; // First completion ever, OR a fresh streak after a gap.
    const longest = Math.max(streak.longest || 0, next);
    saveStreak({ current: next, longest, lastDay: t });
    streakChanged = true;
  }
  return { gainedXp, streakChanged, newPerfect };
}

// Whether the user got a perfect run (all questions first try) on a
// tutorial. Used to render the star indicator on the path.
export function isTutorialPerfect(tutorialId) {
  const progress = getProgress();
  return !!(progress.perfectIds || {})[tutorialId];
}

// Compute the user's overall stats — used by the EducationCard
// preview on Wallet and the header of TutorialsHub.
export function getEducationStats(allTutorials) {
  const progress = getProgress();
  const streak = getStreak();
  const completed = Object.keys(progress.completed).length;
  const total = allTutorials.length;
  return {
    completed,
    total,
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
    totalXp: progress.totalXp || 0,
    streakCurrent: streak.current,
    streakLongest: streak.longest,
    completedSet: new Set(Object.keys(progress.completed)),
    perfectSet: new Set(Object.keys(progress.perfectIds || {})),
  };
}

// Lookup a single tutorial's completion state.
export function isTutorialCompleted(tutorialId) {
  return !!getProgress().completed[tutorialId];
}
