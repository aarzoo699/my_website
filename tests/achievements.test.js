// FocusFlow achievements logic harness (no test framework — plain asserts).
// Stubs just enough DOM + localStorage for app.js to evaluate, then drives the
// real unlock flows: sessions, tasks, night owl, goal reached, persistence.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ---------- Stub helpers ----------
function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
        _map: map
    };
}

function makeElement(tag) {
    return {
        tagName: tag,
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        style: { setProperty: () => {}, removeProperty: () => {} },
        dataset: {},
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) { this._set.add(c); } else { this._set.delete(c); } },
            contains(c) { return this._set.has(c); }
        },
        attributes: {},
        listeners: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        appendChild(child) { (this.children = this.children || []).push(child); return child; },
        append(...args) { args.forEach((c) => (this.children = this.children || []).push(c)); },
        prepend(...args) { args.forEach((c) => (this.children = this.children || []).unshift(c)); },
        remove() {},
        focus() {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelectorAll: () => [],
        closest: () => null
    };
}

function makeSandbox() {
    const storage = makeStorage();
    const elements = new Map();
    const getEl = (id) => {
        if (!elements.has(id)) elements.set(id, makeElement('div'));
        return elements.get(id);
    };
    const sandbox = {
        console,
        setTimeout: (fn) => { fn(); return 0; },       // run immediately
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        requestAnimationFrame: (fn) => { fn(); return 0; },
        localStorage: storage,
        document: {
            documentElement: makeElement('html'),
            body: makeElement('body'),
            getElementById: getEl,
            querySelector: () => makeElement('div'),
            querySelectorAll: () => [],
            createElement: (tag) => makeElement(tag),
            createTextNode: (text) => ({ textContent: text }),
            addEventListener: () => {}
        },
        window: {
            matchMedia: () => ({ matches: false, addEventListener: () => {} }),
            AudioContext: undefined,
            webkitAudioContext: undefined
        }
    };
    sandbox.window.window = sandbox.window;
    sandbox.Date = Date; // real Date so hour-based Night Owl logic can be controlled below
    return { sandbox, storage, getEl };
}

// ---------- Test runner ----------
let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.log('  ✗ ' + name); }
}

function loadApp(sandbox) {
    vm.createContext(sandbox);
    vm.runInContext(APP_SOURCE, sandbox, { filename: 'app.js' });
}

// One Date stub class so tests control the wall clock (for Night Owl + today keys)
function makeFakeDateClass(isoString) {
    return class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(isoString);
            else super(...args);
        }
        static now() { return new Date(isoString).getTime(); }
    };
}

console.log('\n— Load with fresh storage —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00'); // 2 PM: not night
    loadApp(sandbox);
    check('app evaluates without throwing', true);
    check('12 achievement cards rendered', getEl('achvGrid').children.length === 12);
    check('summary says 0 of 12', getEl('achvSummary').children[0].textContent === '0 of 12 unlocked');
    check('no achievements key written on load', sandbox.localStorage.getItem('achievements') === null);
}

console.log('\n— Complete one 25-minute session at 2 PM —');
{
    const { sandbox, getEl, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);

    // Simulate a completed timer run the way completeTimer() does:
    // selectedMs=25min -> recordCompletedSession(25*60*1000)
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    sandbox.runInGlobal('selectedMs = 25 * 60 * 1000; recordCompletedSession(selectedMs);');

    const achv = JSON.parse(storage.getItem('achievements') || '{}');
    check('First Focus unlocked', !!(achv.unlocked && achv.unlocked.firstFocus));
    check('session count is 1', storage.getItem('studySessions') === '1');
    check('nightSessions stays 0 at 2 PM', achv.counters && achv.counters.nightSessions === 0);
    check('unlock toast queued', getEl('achvToastStack').children.length === 1);

    // Re-render must not double-unlock or duplicate toasts
    sandbox.runInGlobal('achvEvaluate(false); achvEvaluate(false);');
    check('re-evaluation does not duplicate unlocks', Object.keys(JSON.parse(storage.getItem('achievements')).unlocked).length === 1);
}

console.log('\n— Night Owl: session finished at 11:30 PM —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T23:30:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    sandbox.runInGlobal('selectedMs = 5 * 60 * 1000; recordCompletedSession(selectedMs);');
    const achv = JSON.parse(storage.getItem('achievements'));
    check('Night Owl unlocked at 23:30', !!(achv.unlocked && achv.unlocked.nightOwl));
    check('nightSessions counted', achv.counters.nightSessions === 1);
}

console.log('\n— Night Owl edge hours (22:00 unlocks, 05:00 does not) —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T22:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    sandbox.runInGlobal('recordCompletedSession(60000);');
    check('22:00 unlocks Night Owl', !!JSON.parse(storage.getItem('achievements')).unlocked.nightOwl);
}
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T05:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    sandbox.runInGlobal('recordCompletedSession(60000);');
    check('05:00 does NOT unlock Night Owl', !JSON.parse(storage.getItem('achievements')).unlocked.nightOwl);
}

console.log('\n— Goal Getter: session pushes focus over the daily goal —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    // Default goal 60m: three 25-min sessions => 75m >= 60m on the third
    sandbox.runInGlobal('selectedMs = 25 * 60 * 1000;');
    sandbox.runInGlobal('recordCompletedSession(selectedMs);');
    sandbox.runInGlobal('recordCompletedSession(selectedMs);');
    let achv = JSON.parse(storage.getItem('achievements'));
    check('no goal badge before crossing the goal', !achv.unlocked.goalGetter);
    sandbox.runInGlobal('recordCompletedSession(selectedMs);');
    achv = JSON.parse(storage.getItem('achievements'));
    check('Goal Getter unlocked on the crossing session', !!achv.unlocked.goalGetter);
    check('goalsReached counted once', achv.counters.goalsReached === 1);
    check('lastGoalDate set to today', achv.lastGoalDate === '2026-09-17');
    sandbox.runInGlobal('recordCompletedSession(selectedMs);');
    achv = JSON.parse(storage.getItem('achievements'));
    check('same-day extra sessions do not re-count', achv.counters.goalsReached === 1);
}

console.log('\n— Task completion achievements —');
{
    const { sandbox, getEl, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);

    sandbox.runInGlobal('taskInputEl.value = "Read chapter 4"; addTask();');
    sandbox.runInGlobal('toggleTaskDone(tasks[0].id);'); // complete it
    const achv = JSON.parse(storage.getItem('achievements') || '{}');
    check('First Task Done unlocked', !!(achv.unlocked && achv.unlocked.firstTaskDone));
    check('tasksCompleted counter = 1', achv.counters && achv.counters.tasksCompleted === 1);

    // Un-checking (reopening) must NOT decrement — unlock-only design
    sandbox.runInGlobal('toggleTaskDone(tasks[0].id);'); // reopen
    const achv2 = JSON.parse(storage.getItem('achievements'));
    check('reopening a task does not decrement the lifetime counter', achv2.counters.tasksCompleted === 1);

    // Deleting tasks must not touch achievements either
    sandbox.runInGlobal('deleteTask(tasks[0].id);');
    const achv3 = JSON.parse(storage.getItem('achievements'));
    check('deleting tasks does not touch achievements', achv3.counters.tasksCompleted === 1);
    check('First Task Done stays unlocked', !!achv3.unlocked.firstTaskDone);
}

console.log('\n— Streak badge from existing dayStreak data —');
{
    const { sandbox, storage } = makeSandbox();
    // Pre-seed a 5-day streak (yesterday's last activity keeps it "alive")
    storage.setItem('dayStreak', JSON.stringify({ last: '2026-09-16', current: 5, best: 5 }));
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const achv = JSON.parse(storage.getItem('achievements') || 'null');
    check('streak3 badge auto-unlocks from existing streak data', !!(achv && achv.unlocked && achv.unlocked.streak3));
    check('streak7 stays locked', !(achv && achv.unlocked && achv.unlocked.streak7));
}

console.log('\n— Corrupt storage falls back to fresh state —');
{
    const { sandbox, storage } = makeSandbox();
    storage.setItem('achievements', '{not json');
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    // App must recover in memory (fresh state) without throwing, and only
    // rewrite the key when it next has something real to save.
    check('corrupt key recovers to fresh in-memory state',
        sandbox.runInGlobal('Object.keys(achvState.unlocked).length') === 0);
    sandbox.runInGlobal('recordCompletedSession(60000);');
    const achv = JSON.parse(storage.getItem('achievements')); // must be valid JSON now
    check('next save overwrites the corrupt key with valid JSON', !!achv.unlocked.firstFocus);
}

console.log('\n— Reset Sessions keeps achievements (permanent record) —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    sandbox.runInGlobal = (expr) => vm.runInContext(expr, sandbox);
    sandbox.runInGlobal('recordCompletedSession(60000);');
    sandbox.runInGlobal('sessionResetBtn.listeners.click[0]();'); // real Reset Sessions handler
    const achv = JSON.parse(storage.getItem('achievements'));
    check('badge survives Reset Sessions', !!achv.unlocked.firstFocus);
}

console.log('\n— Persistence: reload does not re-toast —');
{
    // First "visit": unlock First Focus
    const first = makeSandbox();
    first.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(first.sandbox);
    first.sandbox.runInGlobal = (expr) => vm.runInContext(expr, first.sandbox);
    first.sandbox.runInGlobal('recordCompletedSession(60000);');

    // Second "visit": fresh sandbox sharing the same storage
    const second = makeSandbox();
    second.sandbox.Date = makeFakeDateClass('2026-09-17T15:00:00');
    second.sandbox.localStorage = first.storage; // same browser profile
    loadApp(second.sandbox);
    // getEl is lazy — materialise the stack, then confirm nothing was appended to it
    const toastStack = second.getEl('achvToastStack');
    check('reload renders 1 of 12 with no toast', (toastStack.children || []).length === 0);
    check('reload keeps the unlock', Object.keys(JSON.parse(first.storage.getItem('achievements')).unlocked).length === 1);
}

console.log('\n================================');
console.log(' ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
