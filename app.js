// ============================================================
// FocusFlow — app.js
// All original features preserved: theme toggle, click counter,
// study timer, session tracking, session history, completion
// sound. Additive: today's sessions + total focus time stats,
// productivity dashboard, weekly focus chart, task manager,
// focus achievements (Day 10, +2 flashcard badges Day 11),
// flashcard decks with Leitner spaced repetition (Day 11),
// a course gradebook with a target-grade solver (Day 12), and
// an exam countdown linked to gradebook courses (Day 13).
// ============================================================

// ===== Theme Toggle functionality =====
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');

function updateThemeUI(isDark) {
    if (isDark) {
        document.documentElement.classList.add('dark-theme');
        document.body.classList.add('dark-theme');
        themeToggle.setAttribute('aria-pressed', 'true');
        themeToggle.setAttribute('aria-label', 'Toggle light mode');
        themeIcon.textContent = '☀️';
        themeText.textContent = 'Light Mode';
    } else {
        document.documentElement.classList.remove('dark-theme');
        document.body.classList.remove('dark-theme');
        themeToggle.setAttribute('aria-pressed', 'false');
        themeToggle.setAttribute('aria-label', 'Toggle dark mode');
        themeIcon.textContent = '🌙';
        themeText.textContent = 'Dark Mode';
    }
}

// Initialize UI based on current theme class
const initialIsDark = document.documentElement.classList.contains('dark-theme');
updateThemeUI(initialIsDark);

themeToggle.addEventListener('click', function () {
    const currentlyDark = document.documentElement.classList.contains('dark-theme');
    const nextIsDark = !currentlyDark;
    // One-shot cross-fade animation (styles.css reacts to .theme-anim)
    document.documentElement.classList.add('theme-anim');
    setTimeout(function () {
        document.documentElement.classList.remove('theme-anim');
    }, 450);
    updateThemeUI(nextIsDark);
    localStorage.setItem('theme', nextIsDark ? 'dark' : 'light');
});

// Listen for OS theme changes if user hasn't set an explicit preference
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) {
        updateThemeUI(e.matches);
    }
});

// ===== Counter functionality =====
const button = document.getElementById('clickBtn');
const resetBtn = document.getElementById('resetBtn');
const messageDiv = document.getElementById('message');
let clickCount = 0;

button.addEventListener('click', function () {
    clickCount++;
    if (clickCount === 1) {
        messageDiv.textContent = '🎉 You have clicked this button 1 time!';
    } else {
        messageDiv.textContent = `🎉 You have clicked this button ${clickCount} times!`;
    }
});

resetBtn.addEventListener('click', function () {
    clickCount = 0;
    messageDiv.textContent = '';
});

// ===== Study Timer functionality (Day 5, redesigned Day 7) =====
const timerDisplay = document.getElementById('timerDisplay');
const timerAnnounce = document.getElementById('timerAnnounce');
const timerStatus = document.getElementById('timerStatus');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const timerResetBtn = document.getElementById('timerResetBtn');
const setCustomBtn = document.getElementById('setCustomBtn');
const customMin = document.getElementById('customMin');
const customSec = document.getElementById('customSec');
const presetButtons = document.querySelectorAll('.btn-preset');
const timerRing = document.getElementById('timerRing');
const timerRingWrap = document.querySelector('.timer-ring-wrap');

// State: 'idle' | 'running' | 'paused'
const DURATION_KEY = 'timerDuration'; // persisted like the 'theme' key
const DEFAULT_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 180 * 60 * 1000;

let timerState = 'idle';
let timerInterval = null;
let endAt = 0;                   // wall-clock end timestamp (prevents drift in background tabs)
let selectedMs = loadSavedDuration(); // last duration chosen (restored from localStorage)
let remainingMs = selectedMs;    // current time left
let runTotalMs = selectedMs;     // full duration of the current run (drives the progress ring)

function loadSavedDuration() {
    const saved = Number(localStorage.getItem(DURATION_KEY));
    // Accept only sane whole-second values (1s–180min); anything else falls back
    if (isFinite(saved) && saved >= 1000 && saved <= MAX_DURATION_MS && saved % 1000 === 0) {
        return saved;
    }
    return DEFAULT_DURATION_MS;
}

// Defensive (Day 8 bugfix): single validator for any incoming duration value.
// Returns a safe whole-second value (1s–180min) or the default duration.
function sanitizeDurationMs(value) {
    const n = Number(value);
    if (isFinite(n) && n >= 1000 && n <= MAX_DURATION_MS && n % 1000 === 0) {
        return n;
    }
    return DEFAULT_DURATION_MS;
}

function formatTime(ms) {
    // Defensive (Day 8 bugfix): guard the display — NaN/undefined/etc. must never
    // reach the screen as "NaN:NaN". Falls back to the default duration instead.
    if (!isFinite(ms) || ms < 0) {
        ms = DEFAULT_DURATION_MS;
    }
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

// --- Progress ring (SVG stroke drains from 100% to 0% as time passes) ---
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ~339.292, matches CSS dasharray

function updateRing() {
    const progress = runTotalMs > 0
        ? Math.min(1, Math.max(0, remainingMs / runTotalMs))
        : 0;
    timerRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
}

function renderTimer() {
    timerDisplay.textContent = formatTime(remainingMs);
    updateRing();
}

function setStatus(text) {
    timerStatus.textContent = text;
}

function announce(text) {
    // New content in the live region is read out by screen readers
    timerAnnounce.textContent = text;
}

// --- Study session tracking (persisted like the theme) ---
const SESSIONS_KEY = 'studySessions';
const HIST_KEY = 'sessionHistory';
const TODAY_KEY = 'studySessionsToday'; // additive (Day 7): {date, count}
const TOTAL_KEY = 'totalFocusMs';       // additive (Day 7): total focused milliseconds
const MAX_HISTORY = 8; // keep the list small and readable
const sessionCountEl = document.getElementById('sessionCount');
const sessionResetBtn = document.getElementById('sessionResetBtn');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');
const todayCountEl = document.getElementById('todayCount');
const totalFocusEl = document.getElementById('totalFocus');

let sessionCount = loadSavedSessions();

function loadSavedSessions() {
    const saved = Number(localStorage.getItem(SESSIONS_KEY));
    return (isFinite(saved) && saved > 0) ? Math.floor(saved) : 0;
}

function renderSessions() {
    sessionCountEl.textContent = String(sessionCount);
}

function todayDateString() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

// --- Additive stats: today's sessions + total focus time ---
function loadTodayStats() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TODAY_KEY));
        if (parsed && typeof parsed === 'object' &&
            parsed.date === todayDateString() && isFinite(Number(parsed.count))) {
            return Math.max(0, Math.floor(Number(parsed.count)));
        }
    } catch (err) { /* corrupt or missing -> start fresh today */ }
    return 0; // different day or bad data: today's count restarts
}

function saveTodayStats() {
    try {
        localStorage.setItem(TODAY_KEY, JSON.stringify({ date: todayDateString(), count: todayCount }));
    } catch (err) { /* storage unavailable: keep in-memory value */ }
}

let todayCount = loadTodayStats();
let totalFocusMs = loadTotalFocus(); // may be a live estimate for pre-Day-7 sessions

function loadTotalFocus() {
    const saved = Number(localStorage.getItem(TOTAL_KEY));
    if (isFinite(saved) && saved >= 0) return saved;
    // Backfill an estimate for sessions completed before this upgrade:
    // assume each used the default 5-minute duration until the next real session lands.
    return sessionCount * DEFAULT_DURATION_MS;
}

function isEstimatedFocus() {
    return localStorage.getItem(TOTAL_KEY) === null;
}

function formatFocus(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return minutes + 'm';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
}

function renderStats() {
    todayCountEl.textContent = String(todayCount);
    totalFocusEl.textContent = (isEstimatedFocus() ? '≈ ' : '') + formatFocus(totalFocusMs);
}

// --- Session history (lengths + completion times, newest first) ---
let sessionHistory = loadSavedHistory();

function loadSavedHistory() {
    try {
        const parsed = JSON.parse(localStorage.getItem(HIST_KEY));
        if (!Array.isArray(parsed)) return [];
        // Keep only well-formed entries; anything corrupt is dropped
        return parsed
            .filter(function (e) {
                return e && typeof e === 'object' &&
                    isFinite(Number(e.ms)) && Number(e.ms) > 0 &&
                    typeof e.at === 'number' && isFinite(e.at);
            })
            .slice(0, MAX_HISTORY);
    } catch (err) {
        return []; // missing or corrupt data -> start fresh
    }
}

function formatClock(date) {
    let h = date.getHours();
    const m = String(date.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
}

function formatRelative(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 45 * 1000) return 'just now';
    if (diff < 60 * 60 * 1000) return Math.round(diff / 60000) + ' min ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.round(diff / (60 * 60 * 1000)) + ' h ago';
    if (diff < 48 * 60 * 60 * 1000) return 'yesterday';
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderHistory() {
    historyListEl.innerHTML = ''; // textContent-only nodes below: no injection risk
    if (sessionHistory.length === 0) {
        historyListEl.hidden = true;
        historyEmptyEl.hidden = false;
        return;
    }
    historyListEl.hidden = false;
    historyEmptyEl.hidden = true;
    sessionHistory.forEach(function (entry, index) {
        const li = document.createElement('li');
        li.style.setProperty('--delay', (index * 0.05) + 's'); // staggered pop-in

        const dur = document.createElement('span');
        dur.className = 'hist-dur';
        dur.textContent = formatTime(Number(entry.ms));

        const at = document.createElement('span');
        at.className = 'hist-time';
        at.textContent = 'finished at ' + formatClock(new Date(entry.at));

        const when = document.createElement('span');
        when.className = 'hist-when';
        when.textContent = formatRelative(Number(entry.at));

        li.appendChild(dur);
        li.appendChild(at);
        li.appendChild(when);
        historyListEl.appendChild(li);
    });
}

function recordSessionHistory(ms) {
    sessionHistory.unshift({ ms: ms, at: Date.now() });
    sessionHistory = sessionHistory.slice(0, MAX_HISTORY);
    try {
        localStorage.setItem(HIST_KEY, JSON.stringify(sessionHistory));
    } catch (err) {
        // Storage full or unavailable: keep showing the in-memory list
    }
    renderHistory();
}

sessionResetBtn.addEventListener('click', function () {
    sessionCount = 0;
    localStorage.setItem(SESSIONS_KEY, '0');
    sessionHistory = [];
    localStorage.removeItem(HIST_KEY);
    todayCount = 0;
    saveTodayStats();
    totalFocusMs = 0;
    try {
        localStorage.setItem(TOTAL_KEY, '0');
    } catch (err) { /* keep in-memory zero */ }
    // Additive Day 8: clear today's focus log + current streak (best streak kept as record)
    resetDashboardData();
    renderSessions();
    renderHistory();
    renderStats();
    renderDashboard();
    announce('Study sessions, history, goal progress and streak reset to zero');
});

function recordCompletedSession(ms) {
    sessionCount++;
    localStorage.setItem(SESSIONS_KEY, String(sessionCount));
    renderSessions();
    // Additive Day 7 stats
    todayCount = (loadTodayStats()) + 1; // re-check date so midnight rollover is handled
    saveTodayStats();
    totalFocusMs = loadTotalFocus() + ms;
    try {
        localStorage.setItem(TOTAL_KEY, String(totalFocusMs));
    } catch (err) { /* keep running in-memory total */ }
    renderStats();
    // Additive Day 8: dashboard (focus log + streak)
    recordFocusForToday(ms);
    updateStreakOnSession();
    renderDashboard();
    // Additive Day 10: achievements (session count, focus hours, night owl, goal)
    achvOnSession(ms);
    recordSessionHistory(ms);
    let message = "Time's up! Session " + sessionCount + " complete.";
    if (sessionCount % 5 === 0) {
        message += ' 🎉 ' + sessionCount + ' sessions — great streak!';
    }
    announce(message);
}

renderSessions();
renderHistory();
renderStats();

// ===== Productivity Dashboard (Day 8: goal, focus log, streak) =====
const GOAL_KEY = 'dailyGoalMinutes';
const FOCUS_LOG_KEY = 'focusDailyLog';   // additive: {"YYYY-MM-DD": focusMs}
const STREAK_KEY = 'dayStreak';          // additive: {last, current, best}
const DEFAULT_GOAL_MIN = 60;
const MIN_GOAL_MIN = 5;
const MAX_GOAL_MIN = 720;
const FOCUS_LOG_DAYS = 35;               // keep ~5 weeks of per-day focus
const goalPanelEl = document.getElementById('goalPanel');
const goalDetailEl = document.getElementById('goalDetail');
const goalBarEl = document.getElementById('goalBar');
const goalBarFillEl = document.getElementById('goalBarFill');
const goalReachedEl = document.getElementById('goalReached');
const goalChips = document.querySelectorAll('.goal-chip');
const goalCustomEl = document.getElementById('goalCustom');
const setGoalBtn = document.getElementById('setGoalBtn');
const streakCountEl = document.getElementById('streakCount');
const streakPluralEl = document.getElementById('streakPlural');
const streakBestEl = document.getElementById('streakBest');
const todayFocusEl = document.getElementById('todayFocus');
const goalPercentageEl = document.getElementById('goalPercentage');

let dailyGoalMin = loadDailyGoal();
let focusLog = loadFocusLog();
let streak = loadStreak();

function loadDailyGoal() {
    const saved = Number(localStorage.getItem(GOAL_KEY));
    if (isFinite(saved) && saved >= MIN_GOAL_MIN && saved <= MAX_GOAL_MIN) {
        return Math.round(saved);
    }
    return DEFAULT_GOAL_MIN;
}

function loadFocusLog() {
    try {
        const parsed = JSON.parse(localStorage.getItem(FOCUS_LOG_KEY));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Keep only sane numeric entries, then prune to the recent window
            const clean = {};
            Object.keys(parsed).forEach(function (key) {
                const ms = Number(parsed[key]);
                if (/^\d{4}-\d{2}-\d{2}$/.test(key) && isFinite(ms) && ms >= 0) {
                    clean[key] = ms;
                }
            });
            return pruneFocusLog(clean);
        }
    } catch (err) { /* corrupt or missing -> start fresh */ }
    return {};
}

function pruneFocusLog(log) {
    // newest last; keep only the most recent FOCUS_LOG_DAYS dates
    const keys = Object.keys(log).sort();
    const keep = keys.slice(-FOCUS_LOG_DAYS);
    const pruned = {};
    keep.forEach(function (key) { pruned[key] = log[key]; });
    return pruned;
}

function saveFocusLog() {
    try {
        localStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(pruneFocusLog(focusLog)));
    } catch (err) { /* storage unavailable: keep in-memory value */ }
}

function todayFocusMs() {
    return focusLog[todayDateString()] || 0;
}

function loadStreak() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STREAK_KEY));
        if (parsed && typeof parsed === 'object' &&
            typeof parsed.current === 'number' && isFinite(parsed.current) &&
            typeof parsed.best === 'number' && isFinite(parsed.best)) {
            return {
                last: typeof parsed.last === 'string' ? parsed.last : null,
                current: Math.max(0, Math.floor(parsed.current)),
                best: Math.max(0, Math.floor(parsed.best))
            };
        }
    } catch (err) { /* corrupt or missing -> start fresh */ }
    return { last: null, current: 0, best: 0 };
}

function saveStreak() {
    try {
        localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
    } catch (err) { /* storage unavailable: keep in-memory value */ }
}

function daysBetween(fromDateStr, toDateStr) {
    // Whole days between two YYYY-MM-DD strings (local time, DST-safe)
    const from = new Date(fromDateStr + 'T00:00:00');
    const to = new Date(toDateStr + 'T00:00:00');
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return NaN;
    return Math.round((to - from) / 86400000);
}

function recordFocusForToday(ms) {
    const today = todayDateString();
    focusLog[today] = (focusLog[today] || 0) + ms;
    saveFocusLog();
}

function updateStreakOnSession() {
    const today = todayDateString();
    if (streak.last === today) return; // already counted today
    const gap = streak.last === null ? NaN : daysBetween(streak.last, today);
    // Consecutive day (yesterday or earlier today) extends; anything else restarts at 1
    streak.current = (gap === 1) ? streak.current + 1 : 1;
    streak.last = today;
    streak.best = Math.max(streak.best, streak.current);
    saveStreak();
}

function resetDashboardData() {
    focusLog = {};
    try {
        localStorage.removeItem(FOCUS_LOG_KEY);
    } catch (err) { /* nothing to do */ }
    streak.current = 0;
    streak.last = null;
    // streak.best intentionally kept as the all-time record
    saveStreak();
}

function syncGoalUI() {
    goalCustomEl.value = String(dailyGoalMin);
    goalChips.forEach(function (chip) {
        const isMatch = Number(chip.dataset.goal) === dailyGoalMin;
        chip.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
}

function renderDashboard() {
    // Streak tile: shows the current streak; if today has no session yet, the
    // streak from yesterday still stands (it only breaks after a full missed day)
    let displayStreak = streak.current;
    const today = todayDateString();
    if (streak.last !== null && streak.last !== today) {
        const gap = daysBetween(streak.last, today);
        if (gap === 1) displayStreak = streak.current; // yesterday counted; still alive
        else if (gap > 1) displayStreak = 0;           // a full day was missed
    }
    streakCountEl.textContent = String(displayStreak);
    streakPluralEl.textContent = displayStreak === 1 ? '' : 's';
    streakBestEl.textContent = String(Math.max(streak.best, displayStreak));

    // Today's focus tile
    const todaysMs = todayFocusMs();
    todayFocusEl.textContent = formatFocus(todaysMs);

    // Goal progress bar + percentage
    const goalMs = dailyGoalMin * 60000;
    const ratio = goalMs > 0 ? Math.min(1, todaysMs / goalMs) : 0;
    const percent = Math.floor(ratio * 100);
    goalPercentageEl.textContent = percent + '%';
    goalBarFillEl.style.width = (ratio * 100) + '%';
    goalBarEl.setAttribute('aria-valuemax', String(dailyGoalMin));
    goalBarEl.setAttribute('aria-valuenow', String(percent));
    goalBarEl.setAttribute('aria-valuetext',
        formatFocus(todaysMs) + ' of ' + formatFocus(goalMs) + ' (' + percent + '%)');
    goalDetailEl.textContent = formatFocus(todaysMs) + ' of ' + formatFocus(goalMs) + ' focus time today';

    const goalMet = todaysMs >= goalMs;
    goalPanelEl.classList.toggle('goal-met', goalMet);
    goalReachedEl.hidden = !goalMet;

    // Additive: Weekly Focus Chart shares renderDashboard()'s triggers
    // (page load, completed session, Reset Sessions, goal change)
    renderWeeklyChart();

    syncGoalUI();
}

function applyGoal(minutes) {
    const clamped = clampInt(minutes, MIN_GOAL_MIN, MAX_GOAL_MIN);
    if (!isFinite(clamped) || clamped < MIN_GOAL_MIN) {
        dailyGoalMin = DEFAULT_GOAL_MIN;
    } else {
        dailyGoalMin = clamped;
    }
    try {
        localStorage.setItem(GOAL_KEY, String(dailyGoalMin));
    } catch (err) { /* keep in-memory goal */ }
    renderDashboard();
    announce('Daily goal set to ' + dailyGoalMin + ' minutes');
}

goalChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
        applyGoal(Number(chip.dataset.goal));
    });
});

function setCustomGoal() {
    const raw = goalCustomEl.value;
    if (raw === '' || !isFinite(Number(raw))) {
        announce('Please enter a goal in minutes');
        syncGoalUI(); // restore the current goal in the input
        return;
    }
    applyGoal(Math.round(Number(raw)));
}

setGoalBtn.addEventListener('click', setCustomGoal);
goalCustomEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        setCustomGoal();
    }
});

// ===== Weekly Focus Chart (additive: rolling last 7 days) =====
// Reads the existing focusLog (localStorage 'focusDailyLog') only —
// no sample data, no new storage. Re-renders via renderDashboard().
const WEEKLY_DAYS = 7;
const weeklyPanelEl = document.getElementById('weeklyPanel');
const weeklyChartEl = document.getElementById('weeklyChart');
const weeklyTotalEl = document.getElementById('weeklyTotal');
const weeklyEmptyEl = document.getElementById('weeklyEmpty');
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderWeeklyChart() {
    if (!weeklyChartEl) return; // markup missing: fail silently, nothing else breaks

    // Build the last 7 dates ending today (local time, same YYYY-MM-DD keys as focusLog)
    const days = [];
    const now = new Date();
    for (let i = WEEKLY_DAYS - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
        days.push({ key: key, label: WEEKDAY_NAMES[d.getDay()], ms: focusLog[key] || 0, isToday: i === 0 });
    }

    const weekTotalMs = days.reduce(function (sum, day) { return sum + day.ms; }, 0);
    weeklyTotalEl.textContent = formatFocus(weekTotalMs);

    const hasData = weekTotalMs > 0;
    weeklyEmptyEl.hidden = hasData;
    weeklyChartEl.hidden = !hasData;
    if (!hasData) {
        weeklyChartEl.innerHTML = ''; // nothing rendered when there is truly no data
        weeklyPanelEl.setAttribute('aria-label', 'Weekly focus chart: no focus time recorded in the last 7 days');
        return;
    }

    // Scale bars against the busiest day of the week so one long day
    // doesn't flatten all the others; zero days show a tiny stub.
    const maxDayMs = days.reduce(function (max, day) { return Math.max(max, day.ms); }, 0);
    weeklyChartEl.innerHTML = ''; // textContent-only nodes below: no injection risk

    days.forEach(function (day) {
        const col = document.createElement('div');
        col.className = 'weekly-col' + (day.isToday ? ' is-today' : '');

        const value = document.createElement('span');
        value.className = 'weekly-value';
        value.textContent = formatFocus(day.ms);

        const barTrack = document.createElement('div');
        barTrack.className = 'weekly-bar-track';

        const bar = document.createElement('div');
        bar.className = 'weekly-bar';
        const ratio = maxDayMs > 0 ? day.ms / maxDayMs : 0;
        // 6% shows a visible stub for zero days without implying any focus time
        bar.style.height = day.ms > 0 ? Math.max(8, Math.round(ratio * 100)) + '%' : '6%';
        const minutes = Math.round(day.ms / 60000);
        bar.title = day.label + ': ' + formatFocus(day.ms);
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label',
            (day.isToday ? 'Today' : day.label) + ': ' + formatFocus(day.ms) +
            ' (' + minutes + ' minutes)');

        barTrack.appendChild(bar);

        const label = document.createElement('span');
        label.className = 'weekly-day';
        label.textContent = day.label + (day.isToday ? ' ·' : '');

        col.appendChild(value);
        col.appendChild(barTrack);
        col.appendChild(label);
        weeklyChartEl.appendChild(col);
    });

    weeklyPanelEl.setAttribute('aria-label',
        'Weekly focus chart: ' + formatFocus(weekTotalMs) + ' across the last 7 days');
}

renderWeeklyChart();

renderDashboard();

// --- Completion sound: short beeps via Web Audio API (no files, no libraries) ---
let audioCtx = null;

function playCompletionSound() {
    try {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return; // browser has no Web Audio support
            audioCtx = new Ctx();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;
        [0, 0.3, 0.6].forEach(function (offset) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.2, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.25);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.25);
        });
    } catch (err) {
        // Sound is a nice-to-have: never let it break the timer
    }
}

// --- State machine helpers ---

function stopTicking() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function setControls(state) {
    // Which buttons are usable in each state?
    startBtn.disabled = (state === 'running');
    // Pause stays ENABLED while paused — it becomes the Resume button
    pauseBtn.disabled = (state === 'idle');
    timerResetBtn.disabled = (state === 'idle');
    pauseBtn.textContent = (state === 'paused') ? 'Resume' : 'Pause';
}

function setRingRunning(isRunning) {
    // Drives the CSS glow behind the ring
    timerRingWrap.classList.toggle('running', isRunning);
}

function completeTimer() {
    stopTicking(); // clear FIRST so completion can never fire twice
    timerState = 'idle';
    remainingMs = 0;
    renderTimer();
    setRingRunning(false);
    setStatus("Time's up!");
    timerStatus.classList.add('time-up');
    recordCompletedSession(selectedMs);
    playCompletionSound();
    setControls('idle');
}

function startTimer() {
    if (timerState === 'running') return; // guard against double-click = double speed
    // Defensive (Day 8 bugfix): sanitize state before any arithmetic touches it
    remainingMs = sanitizeDurationMs(remainingMs);
    runTotalMs = sanitizeDurationMs(runTotalMs);
    if (remainingMs <= 0) {
        // "Start" after Time's up restarts the last chosen duration
        loadDuration(selectedMs);
    }
    endAt = Date.now() + remainingMs;
    if (timerState !== 'paused') {
        runTotalMs = remainingMs; // fresh run: ring denominator = full duration
    }
    // resuming a pause: keep runTotalMs so the ring CONTINUES from its paused position
    timerState = 'running';
    setControls('running');
    setRingRunning(true);
    timerStatus.classList.remove('time-up');
    setStatus('Running…');
    announce('Timer started');
    timerDisplay.classList.remove('celebrate'); // one-shot pop (retriggerable)
    void timerDisplay.offsetWidth;              // force reflow so the animation can restart
    timerDisplay.classList.add('celebrate');
    stopTicking(); // safety: never allow two intervals at once
    timerInterval = setInterval(function () {
        remainingMs = endAt - Date.now(); // recompute from wall clock, not by decrementing
        if (remainingMs <= 0) {
            completeTimer();
        } else {
            renderTimer();
        }
    }, 250);
}

function pauseTimer() {
    if (timerState === 'running') {
        // Pause: freeze the countdown at the exact current moment
        stopTicking();
        remainingMs = Math.max(0, endAt - Date.now());
        renderTimer(); // sync display + ring to the exact paused moment
        timerState = 'paused';
        setControls('paused');
        setRingRunning(false);
        setStatus('Paused');
        announce('Timer paused');
    } else if (timerState === 'paused') {
        // Resume: startTimer keeps runTotalMs, so the ring continues (not reset)
        startTimer();
    }
}

function loadDuration(ms) {
    // Defensive (Day 8 bugfix): never let a non-finite/invalid value (NaN, undefined,
    // 0, negative) into the timer state or localStorage — fall back to the default.
    ms = Number(ms);
    if (!isFinite(ms) || ms <= 0 || ms > MAX_DURATION_MS || ms % 1000 !== 0) {
        ms = DEFAULT_DURATION_MS;
    }
    // Fully reset the machine before loading a new duration (e.g. preset clicked mid-run)
    stopTicking();
    timerState = 'idle';
    remainingMs = ms;
    selectedMs = ms;
    runTotalMs = ms;
    localStorage.setItem(DURATION_KEY, String(ms));
    renderTimer();
    setRingRunning(false);
    timerStatus.classList.remove('time-up');
    setStatus('Ready — press Start');
    announce('Timer set to ' + formatTime(ms));
    setControls('idle');
}

function resetTimer() {
    loadDuration(selectedMs);
    setStatus('Ready — pick a duration');
}

// --- Preset buttons (load only; do not auto-start) ---
presetButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
        presetButtons.forEach(function (other) {
            other.setAttribute('aria-pressed', 'false');
        });
        btn.setAttribute('aria-pressed', 'true');
        // Defensive (Day 8 bugfix): only real timer presets carry data-minutes;
        // anything else falls back to the default duration instead of NaN.
        const minutes = Number(btn.dataset.minutes);
        const ms = (isFinite(minutes) && minutes > 0) ? minutes * 60 * 1000 : DEFAULT_DURATION_MS;
        loadDuration(ms);
    });
});

// --- Custom duration ---
function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!isFinite(n)) return min; // empty or invalid input
    return Math.min(max, Math.max(min, n));
}

function setCustomDuration() {
    const minutes = clampInt(customMin.value, 0, 180);
    const seconds = clampInt(customSec.value, 0, 59);
    customMin.value = minutes; // show the user what was actually used
    customSec.value = seconds;
    const ms = (minutes * 60 + seconds) * 1000;
    if (ms <= 0) {
        // 00:00 (or all-blank input): refuse politely, keep the current timer
        setStatus('Please enter a time greater than 0:00');
        announce('Please enter a time greater than zero');
        return;
    }
    presetButtons.forEach(function (other) {
        other.setAttribute('aria-pressed', 'false');
    });
    loadDuration(ms);
}

setCustomBtn.addEventListener('click', setCustomDuration);
[customMin, customSec].forEach(function (input) {
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            setCustomDuration();
        }
    });
});

startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
timerResetBtn.addEventListener('click', resetTimer);

// Initialise display from the restored duration
syncPresetUI();
renderTimer();

// Highlight the matching preset, or preload the custom inputs for custom durations
function syncPresetUI() {
    let matched = false;
    presetButtons.forEach(function (btn) {
        const isMatch = Number(btn.dataset.minutes) * 60 * 1000 === selectedMs;
        btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
        if (isMatch) matched = true;
    });
    if (!matched) {
        customMin.value = Math.floor(selectedMs / 60000);
        customSec.value = Math.round((selectedMs % 60000) / 1000);
    }
}

// ===== Task Manager (Day 9: add, complete/uncomplete, delete, priority, count) =====
const TASKS_KEY = 'tasks';               // additive: [{id, text, done, priority, createdAt}]
const MAX_TASKS = 50;                    // keep the list (and storage) small
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
const taskInputEl = document.getElementById('taskInput');
const addTaskBtn = document.getElementById('addTaskBtn');
const taskChips = document.querySelectorAll('.task-chip');
const taskCountEl = document.getElementById('taskCount');
const taskListEl = document.getElementById('taskList');
const taskEmptyEl = document.getElementById('taskEmpty');
const taskAnnounceEl = document.getElementById('taskAnnounce');
const clearDoneBtn = document.getElementById('clearDoneBtn');

let tasks = loadTasks();
let selectedPriority = 'medium';

function loadTasks() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TASKS_KEY));
        if (!Array.isArray(parsed)) return [];
        // Keep only well-formed entries; anything unrecoverable is dropped.
        // A bad/missing priority is RECOVERABLE: coerce it instead of losing the task
        // (dropping here used to silently delete tasks on reload — Day 9 bugfix).
        return parsed
            .filter(function (t) {
                return t && typeof t === 'object' &&
                    typeof t.id === 'string' && t.id.length > 0 &&
                    typeof t.text === 'string' && t.text.trim().length > 0 &&
                    typeof t.done === 'boolean';
            })
            .map(function (t) {
                return {
                    id: t.id,
                    text: t.text.trim(),
                    done: t.done,
                    priority: VALID_PRIORITIES.indexOf(t.priority) !== -1 ? t.priority : 'medium',
                    createdAt: isFinite(Number(t.createdAt)) ? Number(t.createdAt) : 0
                };
            })
            .slice(0, MAX_TASKS);
    } catch (err) {
        return []; // missing or corrupt data -> start fresh
    }
}

function saveTasks() {
    try {
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
    } catch (err) {
        // Storage full or unavailable: keep showing the in-memory list
    }
}

function announceTask(text) {
    // New content in the live region is read out by screen readers
    taskAnnounceEl.textContent = text;
}

function syncTaskChips() {
    taskChips.forEach(function (chip) {
        chip.setAttribute('aria-pressed', chip.dataset.priority === selectedPriority ? 'true' : 'false');
    });
}

function makeTaskId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addTask() {
    const text = taskInputEl.value.trim().replace(/\s+/g, ' ');
    if (text.length === 0) {
        announceTask('Please type a task before adding');
        taskInputEl.focus();
        return;
    }
    if (tasks.length >= MAX_TASKS) {
        announceTask('Task list is full — complete or delete some tasks first');
        return;
    }
    tasks.unshift({
        id: makeTaskId(),
        text: text,
        done: false,
        priority: selectedPriority,
        createdAt: Date.now()
    });
    saveTasks();
    renderTasks();
    taskInputEl.value = '';
    taskInputEl.focus();
    announceTask('Task added: ' + text + ' (' + PRIORITY_LABELS[selectedPriority] + ' priority)');
}

function toggleTaskDone(id) {
    let doneText = null;
    tasks.forEach(function (t) {
        if (t.id === id) {
            t.done = !t.done;
            doneText = (t.done ? 'Completed: ' : 'Reopened: ') + t.text;
            // Additive Day 10: achievements listen for completions only
            if (t.done) achvOnTaskCompleted();
        }
    });
    if (doneText === null) return; // unknown id: nothing to do
    saveTasks();
    renderTasks();
    announceTask(doneText);
}

function deleteTask(id) {
    const index = tasks.findIndex(function (t) { return t.id === id; });
    if (index === -1) return; // unknown id: nothing to do
    const removed = tasks.splice(index, 1)[0];
    saveTasks();
    renderTasks();
    announceTask('Task deleted: ' + removed.text);
}

function clearCompletedTasks() {
    const openCount = tasks.length - tasks.filter(function (t) { return t.done; }).length;
    tasks = tasks.filter(function (t) { return !t.done; });
    saveTasks();
    renderTasks();
    announceTask(openCount === 1
        ? 'Completed tasks cleared — 1 open task left'
        : 'Completed tasks cleared — ' + openCount + ' open tasks left');
}

function renderTasks() {
    taskListEl.innerHTML = ''; // textContent-only nodes below: no injection risk

    if (tasks.length === 0) {
        taskListEl.hidden = true;
        taskEmptyEl.hidden = false;
    } else {
        taskListEl.hidden = false;
        taskEmptyEl.hidden = true;
        tasks.forEach(function (task, index) {
            const li = document.createElement('li');
            li.className = 'task-item' + (task.done ? ' done' : '');
            li.style.setProperty('--delay', (index * 0.05) + 's'); // staggered pop-in
            li.dataset.id = task.id;

            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'task-check';
            check.checked = task.done;
            check.setAttribute('aria-label',
                (task.done ? 'Mark as not done: ' : 'Mark as done: ') + task.text);

            const badge = document.createElement('span');
            badge.className = 'task-priority priority-' + task.priority;
            badge.textContent = PRIORITY_LABELS[task.priority];

            const text = document.createElement('span');
            text.className = 'task-text';
            text.textContent = task.text; // textContent: user input is never parsed as HTML

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'task-delete';
            del.textContent = '🗑';
            del.setAttribute('aria-label', 'Delete task: ' + task.text);

            li.appendChild(check);
            li.appendChild(badge);
            li.appendChild(text);
            li.appendChild(del);
            taskListEl.appendChild(li);
        });
    }

    // Task count line
    const doneCount = tasks.reduce(function (n, t) { return n + (t.done ? 1 : 0); }, 0);
    const openCount = tasks.length - doneCount;
    taskCountEl.textContent = openCount + ' open · ' + doneCount + ' completed';

    // "Clear completed" only makes sense when something is completed
    clearDoneBtn.hidden = doneCount === 0;
}

addTaskBtn.addEventListener('click', addTask);

taskInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addTask();
    }
});

taskChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
        selectedPriority = VALID_PRIORITIES.indexOf(chip.dataset.priority) !== -1
            ? chip.dataset.priority
            : 'medium';
        syncTaskChips();
    });
});

// Event delegation: one listener handles every row's checkbox and delete button
// (rows are re-rendered on each change, so per-row listeners would leak)
taskListEl.addEventListener('click', function (e) {
    const row = e.target.closest('.task-item');
    if (!row) return;
    if (e.target.classList.contains('task-delete')) {
        deleteTask(row.dataset.id);
    }
});

taskListEl.addEventListener('change', function (e) {
    if (e.target.classList.contains('task-check')) {
        const row = e.target.closest('.task-item');
        if (row) toggleTaskDone(row.dataset.id);
    }
});

clearDoneBtn.addEventListener('click', clearCompletedTasks);

// Initialise the task manager from restored state
syncTaskChips();
renderTasks();

// ===== Focus Achievements (additive: Day 10) =====
// A reward layer that reads the app's existing data — sessions, focus time,
// streaks, tasks, daily goals — and unlocks milestone badges. Unlock-only:
// achievements are never revoked (Reset Sessions deliberately keeps them,
// matching the existing precedent of keeping streak.best as a record).
const ACHV_KEY = 'achievements';          // additive: {unlocked:{id:ts}, counters:{...}, lastGoalDate}
const achvGridEl = document.getElementById('achvGrid');
const achvSummaryEl = document.getElementById('achvSummary');
const achvBarEl = document.getElementById('achvProgressBar');
const achvBarFillEl = document.getElementById('achvProgressFill');
const achvToastStackEl = document.getElementById('achvToastStack');

function achvDef(id, icon, name, requirement, evaluate, progress) {
    return { id: id, icon: icon, name: name, requirement: requirement, evaluate: evaluate, progress: progress };
}

// 12 definitions. evaluate() returns true when the badge is earned;
// progress() returns {current, goal} for the locked-card progress bar.
const ACHIEVEMENTS = [
    achvDef('firstFocus', '🌱', 'First Focus', 'Complete 1 study session',
        function () { return achvCountSessions() >= 1; },
        function () { return { current: achvCountSessions(), goal: 1, unit: 'sessions' }; }),
    achvDef('doubleDigits', '🔟', 'Double Digits', 'Complete 10 study sessions',
        function () { return achvCountSessions() >= 10; },
        function () { return { current: achvCountSessions(), goal: 10, unit: 'sessions' }; }),
    achvDef('fiftyClub', '🏅', 'Fifty Club', 'Complete 50 study sessions',
        function () { return achvCountSessions() >= 50; },
        function () { return { current: achvCountSessions(), goal: 50, unit: 'sessions' }; }),
    achvDef('fiveHours', '⏳', 'Five Hours Deep', 'Focus for 5 hours in total',
        function () { return achvFocusMs() >= 5 * 3600000; },
        function () { return { current: achvFocusMs() / 3600000, goal: 5, unit: 'hours' }; }),
    achvDef('tenHours', '🧠', 'Ten Hour Mind', 'Focus for 10 hours in total',
        function () { return achvFocusMs() >= 10 * 3600000; },
        function () { return { current: achvFocusMs() / 3600000, goal: 10, unit: 'hours' }; }),
    achvDef('streak3', '🔥', 'Heating Up', 'Reach a 3-day study streak',
        function () { return achvStreakBest() >= 3; },
        function () { return { current: Math.max(achvStreakBest(), achvStreakNow()), goal: 3, unit: 'days' }; }),
    achvDef('streak7', '🗓️', 'Week Warrior', 'Reach a 7-day study streak',
        function () { return achvStreakBest() >= 7; },
        function () { return { current: Math.max(achvStreakBest(), achvStreakNow()), goal: 7, unit: 'days' }; }),
    achvDef('firstTaskDone', '✅', 'First Task Done', 'Complete 1 task',
        function () { return achvState.counters.tasksCompleted >= 1; },
        function () { return { current: achvState.counters.tasksCompleted, goal: 1, unit: 'tasks' }; }),
    achvDef('checklistChamp', '📋', 'Checklist Champ', 'Complete 25 tasks',
        function () { return achvState.counters.tasksCompleted >= 25; },
        function () { return { current: achvState.counters.tasksCompleted, goal: 25, unit: 'tasks' }; }),
    achvDef('goalGetter', '🎯', 'Goal Getter', 'Reach your daily goal once',
        function () { return achvState.counters.goalsReached >= 1; },
        function () { return { current: achvState.counters.goalsReached, goal: 1, unit: 'times' }; }),
    achvDef('goalMachine', '🎖️', 'Goal Machine', 'Reach your daily goal 5 times',
        function () { return achvState.counters.goalsReached >= 5; },
        function () { return { current: achvState.counters.goalsReached, goal: 5, unit: 'times' }; }),
    achvDef('nightOwl', '🌙', 'Night Owl', 'Finish a session between 10 PM and 5 AM',
        function () { return achvState.counters.nightSessions >= 1; },
        function () { return { current: achvState.counters.nightSessions, goal: 1, unit: 'nights' }; }),
    // Additive Day 11: flashcard badges. Unlocked via achvOnFlashcardsReviewed()
    // and achvOnFlashcardRoundEnd(), called from the flashcards module below.
    achvDef('cardSharp', '🃏', 'Card Sharp', 'Review 50 flashcards',
        function () { return achvState.counters.flashcardsReviewed >= 50; },
        function () { return { current: achvState.counters.flashcardsReviewed, goal: 50, unit: 'cards' }; }),
    achvDef('perfectRecall', '🎓', 'Perfect Recall', 'Finish a study round with 100% correct (min 5 cards)',
        function () { return achvState.counters.perfectRounds >= 1; },
        function () { return { current: achvState.counters.perfectRounds, goal: 1, unit: 'rounds' }; })
];

let achvState = loadAchvState();

function loadAchvState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ACHV_KEY));
        if (!parsed || typeof parsed !== 'object') return makeAchvState();
        const unlocked = {};
        if (parsed.unlocked && typeof parsed.unlocked === 'object' && !Array.isArray(parsed.unlocked)) {
            // Keep only known ids with sane timestamps
            ACHIEVEMENTS.forEach(function (def) {
                const ts = Number(parsed.unlocked[def.id]);
                if (isFinite(ts) && ts > 0) unlocked[def.id] = ts;
            });
        }
        const c = (parsed.counters && typeof parsed.counters === 'object') ? parsed.counters : {};
        return {
            unlocked: unlocked,
            counters: {
                tasksCompleted: achvSaneCount(c.tasksCompleted),
                goalsReached: achvSaneCount(c.goalsReached),
                nightSessions: achvSaneCount(c.nightSessions),
                flashcardsReviewed: achvSaneCount(c.flashcardsReviewed),
                perfectRounds: achvSaneCount(c.perfectRounds)
            },
            lastGoalDate: (typeof parsed.lastGoalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastGoalDate))
                ? parsed.lastGoalDate : null
        };
    } catch (err) {
        return makeAchvState(); // missing or corrupt data -> start fresh
    }
}

function makeAchvState() {
    return {
        unlocked: {},
        // Additive Day 11: flashcardsReviewed + perfectRounds counters
        counters: { tasksCompleted: 0, goalsReached: 0, nightSessions: 0, flashcardsReviewed: 0, perfectRounds: 0 },
        lastGoalDate: null
    };
}

function achvSaneCount(value) {
    const n = Number(value);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
}

function saveAchvState() {
    try {
        localStorage.setItem(ACHV_KEY, JSON.stringify(achvState));
    } catch (err) {
        // Storage full or unavailable: keep the in-memory state (badges still show)
    }
}

// --- Reads over EXISTING feature data (no new sources of truth) ---
function achvCountSessions() {
    const saved = Number(localStorage.getItem(SESSIONS_KEY));
    return (isFinite(saved) && saved > 0) ? Math.floor(saved) : 0;
}

function achvFocusMs() {
    // Matches the stats tile: backfilled estimate while TOTAL_KEY is unset
    const saved = Number(localStorage.getItem(TOTAL_KEY));
    if (isFinite(saved) && saved >= 0) return saved;
    return achvCountSessions() * DEFAULT_DURATION_MS;
}

function achvStreakBest() {
    return (streak && isFinite(streak.best)) ? Math.max(0, Math.floor(streak.best)) : 0;
}

function achvStreakNow() {
    // Mirrors renderDashboard()'s display logic: yesterday's streak still stands
    if (!streak || streak.last === null) return 0;
    const today = todayDateString();
    if (streak.last === today) return streak.current;
    const gap = daysBetween(streak.last, today);
    return (gap === 1) ? streak.current : 0;
}

// --- Toast queue: several unlocks in one action show one at a time ---
const achvToastQueue = [];
let achvToastBusy = false;

function achvQueueToast(def) {
    achvToastQueue.push(def);
    if (!achvToastBusy) achvShowNextToast();
}

function achvShowNextToast() {
    const def = achvToastQueue.shift();
    if (!def) {
        achvToastBusy = false;
        return;
    }
    achvToastBusy = true;

    const toast = document.createElement('div');
    toast.className = 'achv-toast';

    const icon = document.createElement('span');
    icon.className = 'achv-toast-icon';
    icon.textContent = def.icon;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'achv-toast-eyebrow';
    eyebrow.textContent = 'Achievement unlocked';
    const name = document.createElement('p');
    name.className = 'achv-toast-name';
    name.textContent = def.icon + ' ' + def.name;
    body.appendChild(eyebrow);
    body.appendChild(name);

    toast.appendChild(icon);
    toast.appendChild(body);
    achvToastStackEl.appendChild(toast);

    // Slide in, hold, slide out, then show the next queued toast
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { toast.classList.add('show'); });
    });
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () {
            toast.remove();
            achvShowNextToast();
        }, 350); // matches the CSS transition duration
    }, 4000);
}

// --- Rendering ---
function renderAchievements() {
    if (!achvGridEl) return; // markup missing: fail silently, nothing else breaks
    achvGridEl.innerHTML = ''; // textContent-only nodes below: no injection risk

    ACHIEVEMENTS.forEach(function (def, index) {
        const unlockedAt = achvState.unlocked[def.id];
        const card = document.createElement('article');
        card.className = 'achv-card' + (unlockedAt ? ' is-unlocked' : '');
        card.style.setProperty('--delay', (index * 0.04) + 's'); // staggered pop-in

        const icon = document.createElement('span');
        icon.className = 'achv-icon';
        icon.textContent = unlockedAt ? def.icon : '🔒';
        icon.setAttribute('aria-hidden', 'true');

        const name = document.createElement('h3');
        name.className = 'achv-name';
        name.textContent = def.name;

        const requirement = document.createElement('p');
        requirement.className = 'achv-requirement';
        requirement.textContent = def.requirement;

        card.appendChild(icon);
        card.appendChild(name);
        card.appendChild(requirement);

        if (unlockedAt) {
            const date = document.createElement('p');
            date.className = 'achv-date';
            date.textContent = 'Unlocked ' + new Date(unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            card.appendChild(date);
        } else {
            // Live progress bar for locked badges
            const prog = def.progress();
            const ratio = prog.goal > 0 ? Math.min(1, Math.max(0, prog.current / prog.goal)) : 0;

            const track = document.createElement('div');
            track.className = 'achv-progress-track';
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-label', def.name + ' progress');
            track.setAttribute('aria-valuemin', '0');
            track.setAttribute('aria-valuemax', String(prog.goal));
            track.setAttribute('aria-valuenow', String(Math.floor(ratio * 100)));

            const bar = document.createElement('div');
            bar.className = 'achv-progress-bar';
            bar.style.width = (ratio * 100) + '%';
            track.appendChild(bar);

            const text = document.createElement('p');
            text.className = 'achv-progress-text';
            text.textContent = achvProgressText(prog);

            card.appendChild(track);
            card.appendChild(text);
        }

        achvGridEl.appendChild(card);
    });

    // Summary line + overall progress bar
    const unlockedCount = Object.keys(achvState.unlocked).length;
    achvSummaryEl.innerHTML = '';
    const summaryText = document.createElement('strong');
    summaryText.textContent = unlockedCount + ' of ' + ACHIEVEMENTS.length + ' unlocked';
    achvSummaryEl.appendChild(summaryText);
    achvSummaryEl.appendChild(document.createTextNode(' — keep focusing to earn more badges'));

    const ratio = ACHIEVEMENTS.length > 0 ? unlockedCount / ACHIEVEMENTS.length : 0;
    achvBarFillEl.style.width = (ratio * 100) + '%';
    achvBarEl.setAttribute('aria-valuemax', String(ACHIEVEMENTS.length));
    achvBarEl.setAttribute('aria-valuenow', String(unlockedCount));
}

function achvProgressText(prog) {
    if (prog.unit === 'hours') {
        // Fractional hours: show minutes under 1h, 1-decimal hours above
        const cur = prog.current < 1 ? Math.round(prog.current * 60) + '/' + (prog.goal * 60) + 'm'
            : prog.current.toFixed(1) + '/' + prog.goal + 'h';
        return cur;
    }
    const current = Math.min(Math.floor(prog.current), prog.goal);
    return current + '/' + prog.goal + ' ' + prog.unit;
}

// --- Unlock evaluation (unlock-only: never revokes) ---
function achvEvaluate(triggerToast) {
    let newlyUnlocked = [];
    ACHIEVEMENTS.forEach(function (def) {
        if (!achvState.unlocked[def.id] && def.evaluate()) {
            achvState.unlocked[def.id] = Date.now();
            newlyUnlocked.push(def);
        }
    });
    if (newlyUnlocked.length > 0) {
        saveAchvState();
        renderAchievements();
        if (triggerToast) newlyUnlocked.forEach(achvQueueToast);
    }
    return newlyUnlocked.length;
}

// --- Event hooks (called from existing flows, after this module is defined) ---
function achvOnSession(sessionMs) {
    // Night Owl: session finished between 10 PM (22:00) and 5 AM (04:59)
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 5) {
        achvState.counters.nightSessions += 1;
    }
    // Goal badges: did this session push today's focus over the daily goal?
    const today = todayDateString();
    if (achvState.lastGoalDate !== today && todayFocusMs() >= dailyGoalMin * 60000) {
        achvState.counters.goalsReached += 1;
        achvState.lastGoalDate = today;
    }
    saveAchvState();
    achvEvaluate(true);
}

function achvOnTaskCompleted() {
    achvState.counters.tasksCompleted += 1;
    saveAchvState();
    achvEvaluate(true);
}

// Additive Day 11: called by the flashcards module once per graded card.
// Lifetime counter — reopening/unflipping can never decrement it.
function achvOnFlashcardsReviewed() {
    achvState.counters.flashcardsReviewed += 1;
    saveAchvState();
    achvEvaluate(true);
}

// Additive Day 11: called at the end of every study round. A round counts as
// "perfect" (for Perfect Recall) only with 5+ cards and zero misses.
function achvOnFlashcardRoundEnd(correctCount, roundSize) {
    if (roundSize >= 5 && correctCount === roundSize) {
        achvState.counters.perfectRounds += 1;
        saveAchvState();
        achvEvaluate(true);
    }
}

// Initialise the achievements section from restored state (no toasts on load)
achvEvaluate(false);
renderAchievements();

// ===== Flashcard Decks (additive: Day 11) =====
// Students create decks of front/back cards and study them with the Leitner
// system: cards answered correctly move up boxes 1-5 (longer review gaps),
// misses drop back to box 1 (seen again next round). Reads nothing from the
// other features; writes only its own keys and feeds the two Day 11 badges.
const DECKS_KEY = 'flashcardDecks';    // additive: [{id, name, cards:[{id, front, back, box, due}]}]
const FC_STATS_KEY = 'flashcardStats'; // additive: {reviewed, correct} (lifetime)
const MAX_DECKS = 10;
const MAX_CARDS_PER_DECK = 100;
const FC_MAX_TEXT = 240;
const FC_MAX_NAME = 40;
// index = Leitner box; days until the card is due again (box 1 = next round)
const LEITNER_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14];
const fcDeckInputEl = document.getElementById('fcDeckInput');
const fcAddDeckBtn = document.getElementById('fcAddDeckBtn');
const fcDeckListEl = document.getElementById('fcDeckList');
const fcDeckEmptyEl = document.getElementById('fcDeckEmpty');
const fcStatsLineEl = document.getElementById('fcStatsLine');
const fcAnnounceEl = document.getElementById('fcAnnounce');
const fcDeckViewEl = document.getElementById('fcDeckView');
const fcStudyViewEl = document.getElementById('fcStudyView');
const fcBackBtn = document.getElementById('fcBackBtn');
const fcStudyDeckNameEl = document.getElementById('fcStudyDeckName');
const fcStudyProgressEl = document.getElementById('fcStudyProgress');
const fcStudyStageEl = document.getElementById('fcStudyStage');
const fcAgainBtn = document.getElementById('fcAgainBtn');
const fcFlipBtn = document.getElementById('fcFlipBtn');
const fcGotBtn = document.getElementById('fcGotBtn');
const fcTimerSuggestBtn = document.getElementById('fcTimerSuggest');

let decks = loadDecks();
let expandedDeckId = null;   // which deck shows its card editor
let fcConfirmDeleteId = null; // two-step deck delete (click again to confirm)
let study = null;            // {deckId, queue, index, roundSize, correct, flipped}

function fcMakeId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function announceFc(text) {
    // New content in the live region is read out by screen readers
    fcAnnounceEl.textContent = text;
}

// --- Storage: decks (defensive load, coerces what it can, drops the rest) ---
function sanitizeCard(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const front = typeof raw.front === 'string' ? raw.front.trim().slice(0, FC_MAX_TEXT) : '';
    const back = typeof raw.back === 'string' ? raw.back.trim().slice(0, FC_MAX_TEXT) : '';
    if (!front || !back) return null;
    const box = Number(raw.box);
    const due = Number(raw.due);
    return {
        id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : fcMakeId('c'),
        front: front,
        back: back,
        // Recoverable corruption is coerced, not dropped (Day 9 precedence)
        box: (isFinite(box) && box >= 1 && box <= 5) ? Math.floor(box) : 1,
        due: (isFinite(due) && due >= 0) ? due : 0
    };
}

function loadDecks() {
    try {
        const parsed = JSON.parse(localStorage.getItem(DECKS_KEY));
        if (!Array.isArray(parsed)) return [];
        const clean = [];
        parsed.forEach(function (raw) {
            if (!raw || typeof raw !== 'object') return;
            const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, FC_MAX_NAME) : '';
            if (!name || !Array.isArray(raw.cards)) return;
            clean.push({
                id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : fcMakeId('d'),
                name: name,
                cards: raw.cards.map(sanitizeCard).filter(Boolean).slice(0, MAX_CARDS_PER_DECK)
            });
        });
        return clean.slice(0, MAX_DECKS);
    } catch (err) {
        return []; // missing or corrupt data -> start fresh
    }
}

function saveDecks() {
    try {
        localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
    } catch (err) {
        // Storage full or unavailable: keep showing the in-memory decks
    }
}

function loadFcStats() {
    try {
        const parsed = JSON.parse(localStorage.getItem(FC_STATS_KEY));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                reviewed: fcSaneCount(parsed.reviewed),
                correct: fcSaneCount(parsed.correct)
            };
        }
    } catch (err) { /* corrupt or missing -> start fresh */ }
    return { reviewed: 0, correct: 0 };
}

function saveFcStats() {
    try {
        localStorage.setItem(FC_STATS_KEY, JSON.stringify(fcStats));
    } catch (err) { /* keep in-memory values */ }
}

function fcSaneCount(value) {
    const n = Number(value);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
}

let fcStats = loadFcStats();

// --- Leitner helpers ---
function isCardDue(card) {
    return card.due <= Date.now();
}

function deckDueCount(deck) {
    return deck.cards.filter(isCardDue).length;
}

function findDeck(id) {
    let found = null;
    decks.forEach(function (d) {
        if (d.id === id) found = d;
    });
    return found;
}

// --- Deck CRUD ---
function addDeck() {
    const name = fcDeckInputEl.value.trim().replace(/\s+/g, ' ').slice(0, FC_MAX_NAME);
    if (name.length === 0) {
        announceFc('Please type a deck name before creating');
        fcDeckInputEl.focus();
        return;
    }
    if (decks.length >= MAX_DECKS) {
        announceFc('Deck list is full — delete a deck first');
        return;
    }
    const deck = { id: fcMakeId('d'), name: name, cards: [] };
    decks.push(deck);
    saveDecks();
    fcDeckInputEl.value = '';
    expandedDeckId = deck.id; // open the editor straight away
    renderDecks();
    announceFc('Deck created: ' + name + '. Add your first cards below it.');
    fcDeckInputEl.focus();
}

function deleteDeck(id) {
    const index = decks.findIndex(function (d) { return d.id === id; });
    if (index === -1) return;
    if (fcConfirmDeleteId !== id) {
        fcConfirmDeleteId = id; // first click arms the confirm
        renderDecks();
        announceFc('Press delete again to confirm removing this deck and all its cards');
        return;
    }
    fcConfirmDeleteId = null;
    const removed = decks.splice(index, 1)[0];
    if (expandedDeckId === id) expandedDeckId = null;
    saveDecks();
    renderDecks();
    announceFc('Deck deleted: ' + removed.name);
}

function addCard(deckId) {
    const deck = findDeck(deckId);
    if (!deck) return;
    const frontEl = document.getElementById('fcFrontInput');
    const backEl = document.getElementById('fcBackInput');
    if (!frontEl || !backEl) return;
    const front = frontEl.value.trim().replace(/\s+/g, ' ').slice(0, FC_MAX_TEXT);
    const back = backEl.value.trim().replace(/\s+/g, ' ').slice(0, FC_MAX_TEXT);
    if (front.length === 0 || back.length === 0) {
        announceFc('Please fill in both the front and the back of the card');
        return;
    }
    if (deck.cards.length >= MAX_CARDS_PER_DECK) {
        announceFc('This deck is full — delete some cards first');
        return;
    }
    // New cards start in box 1 with due=0, so they appear in the first round
    deck.cards.push({ id: fcMakeId('c'), front: front, back: back, box: 1, due: 0 });
    saveDecks();
    frontEl.value = '';
    backEl.value = '';
    renderDecks();
    announceFc('Card added to ' + deck.name);
}

function deleteCard(deckId, cardId) {
    const deck = findDeck(deckId);
    if (!deck) return;
    const index = deck.cards.findIndex(function (c) { return c.id === cardId; });
    if (index === -1) return;
    deck.cards.splice(index, 1);
    saveDecks();
    renderDecks();
    announceFc('Card deleted');
}

// --- Rendering: deck list ---
function renderFcStatsLine() {
    if (fcStats.reviewed === 0) {
        fcStatsLineEl.textContent = 'No cards reviewed yet';
        return;
    }
    const percent = Math.round((fcStats.correct / fcStats.reviewed) * 100);
    fcStatsLineEl.textContent = 'All-time: ' + fcStats.reviewed + ' cards reviewed · ' +
        percent + '% correct';
}

function buildCardEditor(deck) {
    const editor = document.createElement('div');
    editor.className = 'fc-deck-editor';

    const form = document.createElement('div');
    form.className = 'fc-add-form';

    const front = document.createElement('input');
    front.type = 'text';
    front.id = 'fcFrontInput';
    front.className = 'task-input';
    front.maxLength = FC_MAX_TEXT;
    front.placeholder = 'Front (question)…';
    front.setAttribute('aria-label', 'Card front for ' + deck.name);
    front.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCard(deck.id);
        }
    });

    const back = document.createElement('input');
    back.type = 'text';
    back.id = 'fcBackInput';
    back.className = 'task-input';
    back.maxLength = FC_MAX_TEXT;
    back.placeholder = 'Back (answer)…';
    back.setAttribute('aria-label', 'Card back for ' + deck.name);
    back.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCard(deck.id);
        }
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add Card';
    addBtn.addEventListener('click', function () { addCard(deck.id); });

    form.appendChild(front);
    form.appendChild(back);
    form.appendChild(addBtn);
    editor.appendChild(form);

    const list = document.createElement('ul');
    list.className = 'fc-card-list';
    deck.cards.forEach(function (card) {
        const row = document.createElement('li');
        row.className = 'fc-card-row';
        row.dataset.id = card.id;

        const f = document.createElement('span');
        f.className = 'fc-card-front';
        f.textContent = card.front; // textContent: user input is never parsed as HTML

        const b = document.createElement('span');
        b.className = 'fc-card-back';
        b.textContent = card.back;

        const box = document.createElement('span');
        box.className = 'fc-card-box';
        box.textContent = 'Box ' + card.box;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'task-delete';
        del.textContent = '🗑';
        del.setAttribute('aria-label', 'Delete card: ' + card.front);

        row.appendChild(f);
        row.appendChild(b);
        row.appendChild(box);
        row.appendChild(del);
        list.appendChild(row);
    });
    editor.appendChild(list);
    return editor;
}

function renderDecks() {
    fcDeckListEl.innerHTML = ''; // textContent-only nodes below: no injection risk
    renderFcStatsLine();

    if (decks.length === 0) {
        fcDeckListEl.hidden = true;
        fcDeckEmptyEl.hidden = false;
        return;
    }
    fcDeckListEl.hidden = false;
    fcDeckEmptyEl.hidden = true;

    decks.forEach(function (deck, index) {
        const li = document.createElement('li');
        li.className = 'fc-deck-row';
        li.style.setProperty('--delay', (index * 0.05) + 's'); // staggered pop-in
        li.dataset.id = deck.id;

        const top = document.createElement('div');
        top.className = 'fc-deck-top';

        const name = document.createElement('span');
        name.className = 'fc-deck-name';
        name.textContent = deck.name;

        const meta = document.createElement('span');
        meta.className = 'fc-deck-meta';
        meta.textContent = deck.cards.length + (deck.cards.length === 1 ? ' card' : ' cards');

        top.appendChild(name);
        top.appendChild(meta);

        const dueCount = deckDueCount(deck);
        if (deck.cards.length > 0 && dueCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'fc-due-badge';
            badge.textContent = dueCount + ' due';
            top.appendChild(badge);
        }

        const actions = document.createElement('div');
        actions.className = 'fc-deck-actions';

        const studyBtn = document.createElement('button');
        studyBtn.type = 'button';
        studyBtn.className = 'btn btn-primary fc-study-btn';
        studyBtn.textContent = 'Study';
        studyBtn.disabled = deck.cards.length === 0;
        studyBtn.setAttribute('aria-label', 'Study deck: ' + deck.name);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'task-delete';
        if (fcConfirmDeleteId === deck.id) {
            delBtn.textContent = '✓';
            delBtn.classList.add('confirm');
            delBtn.setAttribute('aria-label', 'Confirm delete deck: ' + deck.name);
        } else {
            delBtn.textContent = '🗑';
            delBtn.setAttribute('aria-label', 'Delete deck: ' + deck.name);
        }

        actions.appendChild(studyBtn);
        actions.appendChild(delBtn);
        top.appendChild(actions);
        li.appendChild(top);

        // Leitner histogram: one bar per box, height = share of the deck's cards
        if (deck.cards.length > 0) {
            const counts = [0, 0, 0, 0, 0];
            deck.cards.forEach(function (c) { counts[c.box - 1] += 1; });
            const bars = document.createElement('div');
            bars.className = 'fc-boxes';
            const labels = document.createElement('div');
            labels.className = 'fc-box-labels';
            counts.forEach(function (count, i) {
                const bar = document.createElement('div');
                bar.className = 'fc-box' + (count > 0 ? ' filled' : '');
                bar.style.height = count > 0
                    ? Math.max(12, Math.round((count / deck.cards.length) * 100)) + '%'
                    : '';
                bar.title = 'Box ' + (i + 1) + ': ' + count + ' cards';
                bars.appendChild(bar);

                const label = document.createElement('span');
                label.textContent = count > 0 ? String(count) : '·';
                label.title = 'Box ' + (i + 1) + ': ' + count + ' cards';
                labels.appendChild(label);
            });
            li.appendChild(bars);
            li.appendChild(labels);
        }

        if (expandedDeckId === deck.id) {
            li.appendChild(buildCardEditor(deck));
        }

        fcDeckListEl.appendChild(li);
    });
}

// Event delegation: deck-level buttons, card deletes, editor toggle.
// (Rows are re-rendered on each change, so per-row listeners would leak.)
fcDeckListEl.addEventListener('click', function (e) {
    const cardRow = e.target.closest('.fc-card-row');
    if (cardRow) {
        if (e.target.classList.contains('task-delete')) {
            const deckRow = cardRow.closest('.fc-deck-row');
            if (deckRow) deleteCard(deckRow.dataset.id, cardRow.dataset.id);
        }
        return;
    }
    // Clicks inside an open editor (inputs, its Add button) never toggle the editor
    if (e.target.closest('.fc-deck-editor')) return;
    const deckRow = e.target.closest('.fc-deck-row');
    if (!deckRow) return;
    if (e.target.classList.contains('fc-study-btn')) {
        startStudy(deckRow.dataset.id);
    } else if (e.target.classList.contains('task-delete')) {
        deleteDeck(deckRow.dataset.id);
    } else if (e.target.closest('button') === null) {
        // Clicking the row itself (not a button) expands/collapses the editor
        expandedDeckId = (expandedDeckId === deckRow.dataset.id) ? null : deckRow.dataset.id;
        fcConfirmDeleteId = null;
        renderDecks();
    }
});

fcAddDeckBtn.addEventListener('click', addDeck);
fcDeckInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addDeck();
    }
});

// --- Study mode: flip, self-grade, Leitner update ---
function currentStudyCard() {
    if (!study) return null;
    const deck = findDeck(study.deckId);
    if (!deck) return null;
    let card = null;
    deck.cards.forEach(function (c) {
        if (c.id === study.queue[study.index]) card = c;
    });
    return card;
}

function startStudy(deckId) {
    const deck = findDeck(deckId);
    if (!deck || deck.cards.length === 0) return;
    // Due cards first (oldest due first); if none are due, preview the
    // weakest-box cards so an up-to-date deck still has something to study.
    let queue = deck.cards.filter(isCardDue);
    if (queue.length === 0) {
        queue = deck.cards.slice().sort(function (a, b) {
            return a.box - b.box || a.due - b.due;
        }).slice(0, 10);
    } else {
        queue = queue.slice().sort(function (a, b) { return a.due - b.due; });
    }
    study = {
        deckId: deckId,
        queue: queue.map(function (c) { return c.id; }),
        index: 0,
        roundSize: queue.length,
        correct: 0,
        flipped: false
    };
    fcDeckViewEl.hidden = true;
    fcStudyViewEl.hidden = false;
    fcTimerSuggestBtn.hidden = true;
    fcFlipBtn.disabled = false;
    fcAgainBtn.disabled = true;
    fcGotBtn.disabled = true;
    fcStudyDeckNameEl.textContent = deck.name;
    renderStudyCard();
    announceFc('Study round started: ' + study.roundSize + ' cards from ' + deck.name);
}

function renderStudyCard() {
    fcStudyStageEl.innerHTML = '';
    const card = currentStudyCard();
    if (!card) {
        endStudyRound();
        return;
    }
    study.flipped = false;
    fcStudyProgressEl.textContent = 'Card ' + (study.index + 1) + ' of ' + study.roundSize;

    const wrap = document.createElement('div');
    wrap.className = 'fc-flip-card';
    wrap.id = 'fcFlipCard';
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Flashcard front. Activate to show the answer.');
    wrap.addEventListener('click', flipStudyCard);
    wrap.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            flipStudyCard();
        }
    });

    const inner = document.createElement('div');
    inner.className = 'fc-flip-inner';

    const front = document.createElement('div');
    front.className = 'fc-face fc-face-front';
    front.textContent = card.front;

    const back = document.createElement('div');
    back.className = 'fc-face fc-face-back';
    back.textContent = card.back;

    inner.appendChild(front);
    inner.appendChild(back);
    wrap.appendChild(inner);
    fcStudyStageEl.appendChild(wrap);
    syncStudyControls();
}

function flipStudyCard() {
    if (!study) return;
    const wrap = document.getElementById('fcFlipCard');
    if (!wrap) return;
    study.flipped = !study.flipped;
    wrap.classList.toggle('is-flipped', study.flipped);
    wrap.setAttribute('aria-label', study.flipped
        ? 'Flashcard answer. Activate to show the question.'
        : 'Flashcard front. Activate to show the answer.');
    syncStudyControls();
    announceFc(study.flipped ? 'Answer side shown' : 'Question side shown');
}

function syncStudyControls() {
    // Grade buttons only make sense after the card has been flipped
    fcAgainBtn.disabled = !study || !study.flipped;
    fcGotBtn.disabled = !study || !study.flipped;
    fcFlipBtn.textContent = (study && study.flipped) ? 'Show Question' : 'Show Answer';
}

function gradeStudyCard(gotIt) {
    if (!study) return;
    if (!study.flipped) {
        announceFc('Flip the card first, then grade yourself');
        return;
    }
    const card = currentStudyCard();
    if (!card) return;
    // Leitner: correct moves up a box (max 5), a miss drops back to box 1.
    if (gotIt) {
        card.box = Math.min(5, card.box + 1);
    } else {
        card.box = 1;
    }
    card.due = Date.now() + LEITNER_INTERVAL_DAYS[card.box] * 86400000;
    fcStats.reviewed += 1;
    if (gotIt) {
        fcStats.correct += 1;
        study.correct += 1;
    }
    saveDecks();
    saveFcStats();
    renderFcStatsLine();
    achvOnFlashcardsReviewed(); // feeds the Card Sharp badge
    study.index += 1;
    if (study.index >= study.queue.length) {
        endStudyRound();
    } else {
        renderStudyCard();
        announceFc(gotIt ? 'Got it — next card' : 'Again — next card');
    }
}

function endStudyRound() {
    const total = study ? study.roundSize : 0;
    const correct = study ? study.correct : 0;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    achvOnFlashcardRoundEnd(correct, total); // feeds the Perfect Recall badge

    fcStudyStageEl.innerHTML = '';
    const big = document.createElement('p');
    big.className = 'fc-summary-big';
    big.textContent = percent + '% correct';
    const line = document.createElement('p');
    line.className = 'fc-summary-line';
    line.textContent = correct + ' of ' + total + ' cards right · weak cards return sooner';
    fcStudyStageEl.appendChild(big);
    fcStudyStageEl.appendChild(line);

    fcStudyProgressEl.textContent = 'Round complete';
    fcFlipBtn.disabled = true;
    fcAgainBtn.disabled = true;
    fcGotBtn.disabled = true;

    // Natural tie-in to the existing timer: offer a follow-up focus block
    fcTimerSuggestBtn.hidden = false;
    fcTimerSuggestBtn.textContent = '⏱️ Start a 10 min focus session';

    announceFc('Round complete: ' + correct + ' of ' + total + ' correct');
    study = null;
}

function exitStudy() {
    study = null;
    fcStudyViewEl.hidden = true;
    fcDeckViewEl.hidden = false;
    fcTimerSuggestBtn.hidden = true;
    fcFlipBtn.disabled = false;
    renderDecks(); // refresh due badges + box histograms after the round
    announceFc('Back to decks');
}

fcBackBtn.addEventListener('click', exitStudy);
fcFlipBtn.addEventListener('click', flipStudyCard);
fcAgainBtn.addEventListener('click', function () { gradeStudyCard(false); });
fcGotBtn.addEventListener('click', function () { gradeStudyCard(true); });
fcTimerSuggestBtn.addEventListener('click', function () {
    // Reuses the existing Study Timer unchanged: load 10 minutes; the user
    // presses Start as usual (same flow as the preset buttons).
    loadDuration(10 * 60 * 1000);
    announceFc('Timer set to 10:00 — press Start');
});

// Escape exits study mode or collapses the open editor
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (study) {
        exitStudy();
        return;
    }
    if (expandedDeckId !== null || fcConfirmDeleteId !== null) {
        expandedDeckId = null;
        fcConfirmDeleteId = null;
        renderDecks();
    }
});

// Initialise the flashcards section from restored state
renderDecks();

// ===== Course Gradebook (additive: Day 12) =====
// Students track courses made of weighted assessments and see their current
// weighted grade plus the average needed on the remaining work to hit a
// target. Reads nothing from the other features; writes only its own key and
// leaves achievements, streaks, decks and tasks untouched.
const COURSES_KEY = 'courses';   // additive: [{id, name, target, assessments:[{id, name, weight, score}]}]
const MAX_COURSES = 10;
const MAX_ASSESSMENTS_PER_COURSE = 15;
const GB_MAX_NAME = 40;
const GB_MIN_WEIGHT = 1;
const GB_MAX_WEIGHT = 100;
const GB_MIN_SCORE = 0;
const GB_MAX_SCORE = 100;

const gbCourseInputEl = document.getElementById('gbCourseInput');
const gbAddCourseBtn = document.getElementById('gbAddCourseBtn');
const gbTargetChips = document.querySelectorAll('.gb-target-chip');
const gbOverallLineEl = document.getElementById('gbOverallLine');
const gbCourseListEl = document.getElementById('gbCourseList');
const gbCourseEmptyEl = document.getElementById('gbCourseEmpty');
const gbAnnounceEl = document.getElementById('gbAnnounce');

let courses = loadCourses();
let expandedCourseId = null;   // which course shows its assessment editor
let gbConfirmDeleteId = null;  // two-step course delete (click again to confirm)
let gbSelectedTarget = 80;     // target grade applied to newly created courses

function gbMakeId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function announceGb(text) {
    // New content in the live region is read out by screen readers
    gbAnnounceEl.textContent = text;
}

// --- Storage: courses (defensive load, coerces what it can, drops the rest) ---
function gbSaneScore(value) {
    const n = Number(value);
    return (isFinite(n) && n >= GB_MIN_SCORE && n <= GB_MAX_SCORE) ? n : null;
}

function gbSanitizeAssessment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, GB_MAX_NAME) : '';
    const weight = Number(raw.weight);
    if (!name) return null;
    return {
        id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : gbMakeId('a'),
        name: name,
        // Recoverable corruption is coerced, not dropped (Day 9 precedence)
        weight: (isFinite(weight) && weight >= GB_MIN_WEIGHT && weight <= GB_MAX_WEIGHT) ? Math.round(weight) : null,
        score: gbSaneScore(raw.score) // null = not graded yet
    };
}

function loadCourses() {
    try {
        const parsed = JSON.parse(localStorage.getItem(COURSES_KEY));
        if (!Array.isArray(parsed)) return [];
        const clean = [];
        parsed.forEach(function (raw) {
            if (!raw || typeof raw !== 'object') return;
            const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, GB_MAX_NAME) : '';
            const target = Number(raw.target);
            if (!name || !Array.isArray(raw.assessments)) return;
            clean.push({
                id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : gbMakeId('c'),
                name: name,
                target: (isFinite(target) && target >= GB_MIN_SCORE && target <= GB_MAX_SCORE) ? target : 80,
                assessments: raw.assessments.map(gbSanitizeAssessment).filter(Boolean).slice(0, MAX_ASSESSMENTS_PER_COURSE)
            });
        });
        return clean.slice(0, MAX_COURSES);
    } catch (err) {
        return []; // missing or corrupt data -> start fresh
    }
}

function saveCourses() {
    try {
        localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
    } catch (err) {
        // Storage full or unavailable: keep showing the in-memory courses
    }
}

// --- Grade math (pure helpers so tests can call them directly) ---
// current: weighted mean over GRADED assessments only
// need:    target minus graded contribution, spread over the remaining weight
function gbCompute(course) {
    let gradedWeight = 0;
    let gradedContribution = 0;
    let totalWeight = 0;
    course.assessments.forEach(function (a) {
        const w = Number(a.weight);
        if (!isFinite(w) || w <= 0) return;
        totalWeight += w;
        if (a.score === null || a.score === undefined || !isFinite(Number(a.score))) return;
        gradedWeight += w;
        gradedContribution += Number(a.score) * w;
    });

    const current = gradedWeight > 0 ? gradedContribution / gradedWeight : null;
    const remainingWeight = totalWeight - gradedWeight;
    let need = null;
    if (remainingWeight > 0) {
        // Solve (gradedContribution + need * remainingWeight) / totalWeight = target.
        // gradedContribution is in score% x weight% units, so the target must be
        // scaled by totalWeight here (need is a plain percent 0-100).
        need = (course.target * totalWeight - gradedContribution) / remainingWeight;
    }
    // Best achievable final grade if every remaining assessment scores 100
    const bestPossible = totalWeight > 0
        ? (gradedContribution + remainingWeight * 100) / totalWeight
        : null;
    return {
        current: current,             // percent or null when nothing is graded
        gradedWeight: gradedWeight,   // weight already graded
        gradedContribution: gradedContribution, // sum of score x weight
        remainingWeight: remainingWeight,
        totalWeight: totalWeight,
        need: need,                   // percent needed on remaining work, or null
        bestPossible: bestPossible
    };
}

function gbGradeBand(percent) {
    if (percent === null || percent === undefined || !isFinite(Number(percent))) return 'none';
    const p = Number(percent);
    if (p >= 80) return 'good';
    if (p >= 60) return 'mid';
    return 'low';
}

function gbRound1(value) {
    return Math.round(value * 10) / 10;
}

// --- CRUD ---
function addCourse() {
    const name = gbCourseInputEl.value.trim().replace(/\s+/g, ' ').slice(0, GB_MAX_NAME);
    if (name.length === 0) {
        announceGb('Please type a course name before adding');
        gbCourseInputEl.focus();
        return;
    }
    if (courses.length >= MAX_COURSES) {
        announceGb('Course list is full — delete a course first');
        return;
    }
    courses.push({ id: gbMakeId('c'), name: name, target: gbSelectedTarget, assessments: [] });
    saveCourses();
    gbCourseInputEl.value = '';
    expandedCourseId = courses[courses.length - 1].id; // open the editor straight away
    renderGradebook();
    // Additive Day 13: keep the exam form's course dropdown in sync (hoisted
    // function from the exams module below; guarded so the gradebook works alone)
    if (typeof refreshExamCourseOptions === 'function') refreshExamCourseOptions();
    announceGb('Course added: ' + name + '. Add its assessments below it.');
    gbCourseInputEl.focus();
}

function deleteCourse(id) {
    const index = courses.findIndex(function (c) { return c.id === id; });
    if (index === -1) return;
    if (gbConfirmDeleteId !== id) {
        gbConfirmDeleteId = id; // first click arms the confirm
        renderGradebook();
        announceGb('Press delete again to confirm removing this course and all its assessments');
        return;
    }
    gbConfirmDeleteId = null;
    const removed = courses.splice(index, 1)[0];
    if (expandedCourseId === id) expandedCourseId = null;
    saveCourses();
    renderGradebook();
    // Additive Day 13: drop the deleted course from the exam dropdown (the
    // exams loader also nulls dangling courseIds on the next page load)
    if (typeof refreshExamCourseOptions === 'function') refreshExamCourseOptions();
    announceGb('Course deleted: ' + removed.name);
}

function addAssessment(courseId) {
    const course = courses.find(function (c) { return c.id === courseId; });
    if (!course) return;
    const nameEl = document.getElementById('gbAssessName');
    const weightEl = document.getElementById('gbAssessWeight');
    const scoreEl = document.getElementById('gbAssessScore');
    if (!nameEl || !weightEl || !scoreEl) return;
    const name = nameEl.value.trim().replace(/\s+/g, ' ').slice(0, GB_MAX_NAME);
    const weight = Math.round(Number(weightEl.value));
    const scoreRaw = scoreEl.value.trim();
    if (name.length === 0) {
        announceGb('Please give the assessment a name');
        return;
    }
    if (!isFinite(Number(weightEl.value)) || weight < GB_MIN_WEIGHT || weight > GB_MAX_WEIGHT) {
        announceGb('Weight must be between 1 and 100 percent');
        return;
    }
    // Score is optional: leave it blank for "not graded yet"
    let score = null;
    if (scoreRaw !== '') {
        const s = Number(scoreRaw);
        if (!isFinite(s) || s < GB_MIN_SCORE || s > GB_MAX_SCORE) {
            announceGb('Score must be between 0 and 100, or blank if not graded yet');
            return;
        }
        score = s;
    }
    if (course.assessments.length >= MAX_ASSESSMENTS_PER_COURSE) {
        announceGb('This course is full — delete some assessments first');
        return;
    }
    course.assessments.push({ id: gbMakeId('a'), name: name, weight: weight, score: score });
    saveCourses();
    nameEl.value = '';
    weightEl.value = '';
    scoreEl.value = '';
    renderGradebook();
    announceGb('Assessment added to ' + course.name + ': ' + name);
}

function deleteAssessment(courseId, assessmentId) {
    const course = courses.find(function (c) { return c.id === courseId; });
    if (!course) return;
    const index = course.assessments.findIndex(function (a) { return a.id === assessmentId; });
    if (index === -1) return;
    course.assessments.splice(index, 1);
    saveCourses();
    renderGradebook();
    announceGb('Assessment deleted');
}

// --- Rendering ---
function gbTargetText(course, calc) {
    if (calc.remainingWeight <= 0) {
        // Everything is graded: target is met or it is not
        return calc.current !== null && calc.current >= course.target
            ? '🎉 Target met — course complete'
            : 'Course complete — target missed';
    }
    if (calc.need === null) return '';
    if (calc.need <= 0) {
        return '🎉 Target secured — any result on the rest keeps it';
    }
    if (calc.need > 100) {
        return 'Out of reach — even 100% on the rest gives about ' +
            gbRound1(calc.bestPossible) + '%';
    }
    return 'Need about ' + gbRound1(calc.need) + '% on the remaining ' +
        Math.round(calc.remainingWeight) + '% of work';
}

function buildCourseEditor(course) {
    const editor = document.createElement('div');
    editor.className = 'gb-course-editor';

    const form = document.createElement('div');
    form.className = 'fc-add-form';

    const name = document.createElement('input');
    name.type = 'text';
    name.id = 'gbAssessName';
    name.className = 'task-input';
    name.maxLength = GB_MAX_NAME;
    name.placeholder = 'Assessment… (e.g. Midterm)';
    name.setAttribute('aria-label', 'Assessment name for ' + course.name);
    name.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAssessment(course.id);
        }
    });

    const weight = document.createElement('input');
    weight.type = 'number';
    weight.id = 'gbAssessWeight';
    weight.className = 'gb-weight-input';
    weight.min = String(GB_MIN_WEIGHT);
    weight.max = String(GB_MAX_WEIGHT);
    weight.step = '1';
    weight.inputMode = 'numeric';
    weight.placeholder = 'Weight %';
    weight.setAttribute('aria-label', 'Weight in percent for ' + course.name);
    weight.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAssessment(course.id);
        }
    });

    const score = document.createElement('input');
    score.type = 'number';
    score.id = 'gbAssessScore';
    score.className = 'gb-weight-input';
    score.min = String(GB_MIN_SCORE);
    score.max = String(GB_MAX_SCORE);
    score.step = '0.5';
    score.inputMode = 'decimal';
    score.placeholder = 'Score % (optional)';
    score.setAttribute('aria-label', 'Score in percent for ' + course.name);
    score.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAssessment(course.id);
        }
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add Assessment';
    addBtn.addEventListener('click', function () { addAssessment(course.id); });

    form.appendChild(name);
    form.appendChild(weight);
    form.appendChild(score);
    form.appendChild(addBtn);
    editor.appendChild(form);

    const list = document.createElement('ul');
    list.className = 'gb-assess-list';
    course.assessments.forEach(function (a) {
        const row = document.createElement('li');
        row.className = 'gb-assess-row';
        row.dataset.id = a.id;

        const n = document.createElement('span');
        n.className = 'gb-assess-name';
        n.textContent = a.name; // textContent: user input is never parsed as HTML

        const w = document.createElement('span');
        w.className = 'gb-assess-weight';
        w.textContent = Math.round(a.weight) + '%';

        const s = document.createElement('span');
        s.className = 'gb-assess-score' + (a.score === null ? ' pending' : '');
        s.textContent = a.score === null ? 'Not graded' : Math.round(a.score) + '%';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'task-delete';
        del.textContent = '🗑';
        del.setAttribute('aria-label', 'Delete assessment: ' + a.name);

        row.appendChild(n);
        row.appendChild(w);
        row.appendChild(s);
        row.appendChild(del);
        list.appendChild(row);
    });
    editor.appendChild(list);
    return editor;
}

function renderGradebook() {
    gbCourseListEl.innerHTML = ''; // textContent-only nodes below: no injection risk

    if (courses.length === 0) {
        gbCourseListEl.hidden = true;
        gbCourseEmptyEl.hidden = false;
        gbOverallLineEl.textContent = 'Add a course to start tracking your grades';
        return;
    }
    gbCourseListEl.hidden = false;
    gbCourseEmptyEl.hidden = true;

    let gradedCourseCount = 0;
    let currentSum = 0;

    courses.forEach(function (course, index) {
        const calc = gbCompute(course);
        const li = document.createElement('li');
        li.className = 'gb-course-row';
        li.style.setProperty('--delay', (index * 0.05) + 's'); // staggered pop-in
        li.dataset.id = course.id;

        const top = document.createElement('div');
        top.className = 'gb-course-top';

        const name = document.createElement('span');
        name.className = 'gb-course-name';
        name.textContent = course.name;

        const meta = document.createElement('span');
        const gradedCount = course.assessments.filter(function (a) { return a.score !== null; }).length;
        meta.className = 'gb-course-meta';
        meta.textContent = gradedCount + ' of ' + course.assessments.length + ' graded';

        top.appendChild(name);
        top.appendChild(meta);

        if (calc.current !== null) {
            const badge = document.createElement('span');
            const band = gbGradeBand(calc.current);
            badge.className = 'gb-grade-badge band-' + band;
            badge.textContent = gbRound1(calc.current) + '%';
            badge.title = 'Current grade over graded work';
            top.appendChild(badge);
            currentSum += calc.current;
            gradedCourseCount += 1;
        }

        const target = document.createElement('span');
        target.className = 'gb-target-chip gb-target-static';
        target.textContent = 'Target ' + Math.round(course.target) + '%';
        top.appendChild(target);

        const actions = document.createElement('div');
        actions.className = 'fc-deck-actions';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'task-delete';
        if (gbConfirmDeleteId === course.id) {
            delBtn.textContent = '✓';
            delBtn.classList.add('confirm');
            delBtn.setAttribute('aria-label', 'Confirm delete course: ' + course.name);
        } else {
            delBtn.textContent = '🗑';
            delBtn.setAttribute('aria-label', 'Delete course: ' + course.name);
        }
        actions.appendChild(delBtn);
        top.appendChild(actions);
        li.appendChild(top);

        // Status line: current standing + what the target requires
        const status = document.createElement('p');
        status.className = 'gb-status';
        const parts = [];
        if (calc.current !== null) {
            parts.push('Current ' + gbRound1(calc.current) + '% over ' + Math.round(calc.gradedWeight) + '% of the weight');
        } else {
            parts.push('Nothing graded yet');
        }
        if (calc.totalWeight > 0 && calc.totalWeight !== 100) {
            parts.push('⚠️ weights total ' + Math.round(calc.totalWeight) + '%, not 100%');
        }
        const targetText = gbTargetText(course, calc);
        if (targetText) parts.push(targetText);
        status.textContent = parts.join(' · ');
        li.appendChild(status);

        if (expandedCourseId === course.id) {
            li.appendChild(buildCourseEditor(course));
        }

        gbCourseListEl.appendChild(li);
    });

    // Overall line across courses with at least one graded assessment
    if (gradedCourseCount > 0) {
        const overall = currentSum / gradedCourseCount;
        const band = gbGradeBand(overall);
        gbOverallLineEl.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = 'Overall ' + gbRound1(overall) + '%';
        gbOverallLineEl.appendChild(strong);
        gbOverallLineEl.appendChild(document.createTextNode(
            ' across ' + gradedCourseCount + (gradedCourseCount === 1 ? ' course' : ' courses') +
            ' · ' + (courses.length - gradedCourseCount) + ' without grades yet'));
        gbOverallLineEl.classList.remove('band-good', 'band-mid', 'band-low');
        gbOverallLineEl.classList.add('gb-overall', 'band-' + band);
    } else {
        gbOverallLineEl.classList.remove('gb-overall', 'band-good', 'band-mid', 'band-low');
        gbOverallLineEl.textContent = 'Grades will appear once you enter scores';
    }
}

// Event delegation: course-level buttons, assessment deletes, editor toggle.
// (Rows are re-rendered on each change, so per-row listeners would leak.)
gbCourseListEl.addEventListener('click', function (e) {
    const assessRow = e.target.closest('.gb-assess-row');
    if (assessRow) {
        if (e.target.classList.contains('task-delete')) {
            const courseRow = assessRow.closest('.gb-course-row');
            if (courseRow) deleteAssessment(courseRow.dataset.id, assessRow.dataset.id);
        }
        return;
    }
    // Clicks inside an open editor (inputs, its Add button) never toggle the editor
    if (e.target.closest('.gb-course-editor')) return;
    const courseRow = e.target.closest('.gb-course-row');
    if (!courseRow) return;
    if (e.target.classList.contains('task-delete')) {
        deleteCourse(courseRow.dataset.id);
    } else if (e.target.closest('button') === null) {
        // Clicking the row itself (not a button) expands/collapses the editor
        expandedCourseId = (expandedCourseId === courseRow.dataset.id) ? null : courseRow.dataset.id;
        gbConfirmDeleteId = null;
        renderGradebook();
    }
});

gbAddCourseBtn.addEventListener('click', addCourse);
gbCourseInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addCourse();
    }
});

gbTargetChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
        const value = Number(chip.dataset.target);
        if (isFinite(value) && value >= GB_MIN_SCORE && value <= GB_MAX_SCORE) {
            gbSelectedTarget = value;
        }
        gbTargetChips.forEach(function (other) {
            other.setAttribute('aria-pressed', String(other === chip));
        });
    });
});

// Escape collapses the open editor or disarms a pending delete
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (expandedCourseId !== null || gbConfirmDeleteId !== null) {
        expandedCourseId = null;
        gbConfirmDeleteId = null;
        renderGradebook();
    }
});

// Initialise the gradebook section from restored state
renderGradebook();

// ===== Exam Countdown (additive: Day 13) =====
// Students track upcoming exams and deadlines with a day countdown, optionally
// linked to gradebook courses so the current standing sits next to the days
// remaining. Reads course names/grades via the Day 12 module; writes only its
// own 'exams' key. The timer is reused through loadDuration() exactly the way
// the flashcards' timer suggestion already does — the timer itself is untouched.
const EXAMS_KEY = 'exams';  // additive: [{id, name, courseId, date, createdAt}]
const MAX_EXAMS = 20;
const EXAM_MAX_NAME = 60;
const EXAM_URGENT_DAYS = 3;   // red band: 0-3 days
const EXAM_SOON_DAYS = 7;     // amber band: 4-7 days

const examNameInputEl = document.getElementById('examNameInput');
const examCourseSelectEl = document.getElementById('examCourseSelect');
const examDateInputEl = document.getElementById('examDateInput');
const addExamBtn = document.getElementById('addExamBtn');
const examListEl = document.getElementById('examList');
const examEmptyEl = document.getElementById('examEmpty');
const examAnnounceEl = document.getElementById('examAnnounce');

let exams = loadExams();
let examConfirmDeleteId = null; // two-step exam delete (click again to confirm)

function announceExam(text) {
    // New content in the live region is read out by screen readers
    examAnnounceEl.textContent = text;
}

// --- Storage: exams (defensive load, coerces what it can, drops the rest) ---
function loadExams() {
    try {
        const parsed = JSON.parse(localStorage.getItem(EXAMS_KEY));
        if (!Array.isArray(parsed)) return [];
        // Gradebook ids for the link check: dangling courseIds are coerced to
        // null instead of dropping the exam (recoverable corruption, Day 9 style)
        let courseIds = null;
        try {
            const parsedCourses = JSON.parse(localStorage.getItem(COURSES_KEY));
            if (Array.isArray(parsedCourses)) {
                courseIds = {};
                parsedCourses.forEach(function (c) {
                    if (c && typeof c === 'object' && typeof c.id === 'string') {
                        courseIds[c.id] = true;
                    }
                });
            }
        } catch (err) { /* courses unreadable: leave links as stored */ }

        const clean = [];
        parsed.forEach(function (raw) {
            if (!raw || typeof raw !== 'object') return;
            const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, EXAM_MAX_NAME) : '';
            const date = typeof raw.date === 'string' ? raw.date : '';
            if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
            let courseId = (typeof raw.courseId === 'string' && raw.courseId.length > 0) ? raw.courseId : null;
            if (courseId !== null && courseIds && !courseIds[courseId]) courseId = null;
            clean.push({
                id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : gbMakeId('e'),
                name: name,
                courseId: courseId,
                date: date,
                createdAt: isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0
            });
        });
        return clean.slice(0, MAX_EXAMS);
    } catch (err) {
        return []; // missing or corrupt data -> start fresh
    }
}

function saveExams() {
    try {
        localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
    } catch (err) {
        // Storage full or unavailable: keep showing the in-memory exams
    }
}

// --- Countdown math (reuses daysBetween() from the streak module) ---
function examDaysLeft(dateStr) {
    return daysBetween(todayDateString(), dateStr);
}

function examUrgency(daysLeft) {
    if (daysLeft < 0) return 'past';
    if (daysLeft <= EXAM_URGENT_DAYS) return 'urgent';
    if (daysLeft <= EXAM_SOON_DAYS) return 'soon';
    return 'later';
}

function examDaysLabel(daysLeft) {
    if (daysLeft < 0) {
        const ago = Math.abs(daysLeft);
        return ago === 1 ? 'Passed 1 day ago' : 'Passed ' + ago + ' days ago';
    }
    if (daysLeft === 0) return 'Today — good luck!';
    if (daysLeft === 1) return 'Tomorrow';
    return daysLeft + ' days left';
}

// --- Course dropdown (populated from the Day 12 gradebook) ---
function refreshExamCourseOptions() {
    if (!examCourseSelectEl) return; // markup missing: fail silently
    const previous = examCourseSelectEl.value;
    examCourseSelectEl.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No course link';
    examCourseSelectEl.appendChild(none);
    courses.forEach(function (course) {
        const option = document.createElement('option');
        option.value = course.id;
        option.textContent = course.name;
        examCourseSelectEl.appendChild(option);
    });
    // Restore the previous selection if that course still exists
    if (previous && courses.some(function (c) { return c.id === previous; })) {
        examCourseSelectEl.value = previous;
    }
}

// --- CRUD ---
function addExam() {
    const name = examNameInputEl.value.trim().replace(/\s+/g, ' ').slice(0, EXAM_MAX_NAME);
    const date = examDateInputEl.value;
    const courseId = examCourseSelectEl.value || null;
    if (name.length === 0) {
        announceExam('Please give the exam a name');
        examNameInputEl.focus();
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        announceExam('Please pick a date for the exam');
        examDateInputEl.focus();
        return;
    }
    if (exams.length >= MAX_EXAMS) {
        announceExam('Exam list is full — delete an exam first');
        return;
    }
    exams.push({ id: gbMakeId('e'), name: name, courseId: courseId, date: date, createdAt: Date.now() });
    saveExams();
    examNameInputEl.value = '';
    examDateInputEl.value = '';
    renderExams();
    announceExam('Exam added: ' + name + ' on ' + date);
    examNameInputEl.focus();
}

function deleteExam(id) {
    const index = exams.findIndex(function (e) { return e.id === id; });
    if (index === -1) return;
    if (examConfirmDeleteId !== id) {
        examConfirmDeleteId = id; // first click arms the confirm
        renderExams();
        announceExam('Press delete again to confirm removing this exam');
        return;
    }
    examConfirmDeleteId = null;
    const removed = exams.splice(index, 1)[0];
    saveExams();
    renderExams();
    announceExam('Exam deleted: ' + removed.name);
}

// --- Rendering ---
function examCourseLabel(exam) {
    if (!exam.courseId) return null;
    const course = courses.find(function (c) { return c.id === exam.courseId; });
    if (!course) return null;
    const calc = gbCompute(course);
    if (calc.current === null) return course.name;
    return course.name + ' · current ' + gbRound1(calc.current) + '%';
}

function renderExams() {
    examListEl.innerHTML = ''; // textContent-only nodes below: no injection risk

    if (exams.length === 0) {
        examListEl.hidden = true;
        examEmptyEl.hidden = false;
        return;
    }
    examListEl.hidden = false;
    examEmptyEl.hidden = true;

    // Soonest future exams first; past exams sink to the bottom (kept until
    // deleted). Sort key = days left, with past days mapped after everything.
    const sorted = exams.slice().sort(function (a, b) {
        const da = examDaysLeft(a.date);
        const db = examDaysLeft(b.date);
        const ka = da < 0 ? Number.MAX_SAFE_INTEGER : da;
        const kb = db < 0 ? Number.MAX_SAFE_INTEGER : db;
        return (ka - kb) || a.date.localeCompare(b.date);
    });

    sorted.forEach(function (exam, index) {
        const li = document.createElement('li');
        li.className = 'exam-row';
        li.style.setProperty('--delay', (index * 0.05) + 's'); // staggered pop-in
        li.dataset.id = exam.id;

        const daysLeft = examDaysLeft(exam.date);
        const urgency = examUrgency(daysLeft);
        li.classList.add('urgency-' + urgency);

        const top = document.createElement('div');
        top.className = 'exam-top';

        const name = document.createElement('span');
        name.className = 'exam-name';
        name.textContent = exam.name;

        const badge = document.createElement('span');
        badge.className = 'exam-badge';
        badge.textContent = examDaysLabel(daysLeft);
        badge.title = 'Exam date: ' + exam.date;

        top.appendChild(name);
        top.appendChild(badge);

        const courseLabel = examCourseLabel(exam);
        if (courseLabel) {
            const course = document.createElement('span');
            course.className = 'exam-course';
            course.textContent = courseLabel;
            top.appendChild(course);
        }

        const actions = document.createElement('div');
        actions.className = 'fc-deck-actions';

        const focusBtn = document.createElement('button');
        focusBtn.type = 'button';
        focusBtn.className = 'btn btn-soft exam-focus-btn';
        focusBtn.textContent = '⏱️ Focus on this';
        focusBtn.setAttribute('aria-label', 'Set the timer to 25 minutes for ' + exam.name);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'task-delete';
        if (examConfirmDeleteId === exam.id) {
            delBtn.textContent = '✓';
            delBtn.classList.add('confirm');
            delBtn.setAttribute('aria-label', 'Confirm delete exam: ' + exam.name);
        } else {
            delBtn.textContent = '🗑';
            delBtn.setAttribute('aria-label', 'Delete exam: ' + exam.name);
        }
        actions.appendChild(focusBtn);
        actions.appendChild(delBtn);
        top.appendChild(actions);
        li.appendChild(top);

        const dateLine = document.createElement('p');
        dateLine.className = 'exam-date-line';
        const dateObj = new Date(exam.date + 'T00:00:00');
        dateLine.textContent = dateObj.toLocaleDateString(undefined,
            { weekday: 'long', month: 'long', day: 'numeric' });
        li.appendChild(dateLine);

        examListEl.appendChild(li);
    });
}

// Event delegation: row buttons (rows re-render on each change, so per-row
// listeners would leak)
examListEl.addEventListener('click', function (e) {
    const row = e.target.closest('.exam-row');
    if (!row) return;
    if (e.target.classList.contains('exam-focus-btn')) {
        // Reuses the existing Study Timer unchanged: load 25 minutes; the user
        // presses Start as usual (same flow as the preset buttons).
        loadDuration(25 * 60 * 1000);
        announceExam('Timer set to 25:00 — press Start');
    } else if (e.target.classList.contains('task-delete')) {
        deleteExam(row.dataset.id);
    }
});

addExamBtn.addEventListener('click', addExam);
examNameInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addExam();
    }
});

// Initialise the exam section from restored state
refreshExamCourseOptions();
renderExams();
