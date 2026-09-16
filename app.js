// ============================================================
// FocusFlow — app.js
// All original features preserved: theme toggle, click counter,
// study timer, session tracking, session history, completion
// sound. Additive: today's sessions + total focus time stats.
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
