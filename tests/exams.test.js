// FocusFlow exam countdown logic harness (no test framework — plain asserts).
// Stubs just enough DOM + localStorage for app.js to evaluate, then drives the
// real flows: exam CRUD, countdown math, urgency bands, course linking,
// dropdown sync, timer suggestion, persistence and Reset Sessions isolation.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ---------- Stub helpers (mirrors tests/gradebook.test.js) ----------
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
    const el = {
        tagName: tag,
        textContent: '',
        hidden: false,
        disabled: false,
        value: '',
        maxLength: 528,
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
        children: [],
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        appendChild(child) { this.children.push(child); return child; },
        append(...args) { args.forEach((c) => (this.children = this.children || []).push(c)); },
        prepend(...args) { args.forEach((c) => (this.children = this.children || []).unshift(c)); },
        remove() {},
        focus() {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelectorAll: () => [],
        closest: () => null
    };
    // Match real DOM semantics: assigning innerHTML replaces all children
    Object.defineProperty(el, 'innerHTML', {
        get: () => (el._innerHTML || ''),
        set(v) {
            el._innerHTML = String(v);
            if (el._innerHTML === '') el.children.length = 0;
        }
    });
    return el;
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
        setTimeout: (fn) => { fn(); return 0; },
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
    sandbox.Date = Date;
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

function makeFakeDateClass(isoString) {
    return class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(isoString);
            else super(...args);
        }
        static now() { return new Date(isoString).getTime(); }
    };
}

// Helper: add one exam through the real form path
function addExamViaForm(run, name, courseId, date) {
    run(`examNameInputEl.value = ${JSON.stringify(name)};`);
    run(`examCourseSelectEl.value = ${JSON.stringify(courseId || '')};`);
    run(`examDateInputEl.value = ${JSON.stringify(date)};`);
    run('addExam();');
}

// Helper: create a gradebook course via the real path, return its id expression
function buildCourse(run, courseName, assessments) {
    run(`gbSelectedTarget = 80;`);
    run(`gbCourseInputEl.value = ${JSON.stringify(courseName)}; addCourse();`);
    run(`expandedCourseId = courses[courses.length - 1].id; renderGradebook();`);
    (assessments || []).forEach(([name, weight, score]) => {
        run(`document.getElementById('gbAssessName').value = ${JSON.stringify(name)};`);
        run(`document.getElementById('gbAssessWeight').value = ${JSON.stringify(String(weight))};`);
        run(`document.getElementById('gbAssessScore').value = ${score === null ? '""' : JSON.stringify(String(score))};`);
        run(`addAssessment(courses[courses.length - 1].id);`);
    });
}

console.log('\n— Load with fresh storage —');
{
    const { sandbox, getEl, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    check('app evaluates without throwing', true);
    check('no exams key written on load', storage.getItem('exams') === null);
    check('exam list hidden and empty state shown', getEl('examList').hidden === true && getEl('examEmpty').hidden === false);
    check('course dropdown starts with the placeholder option', getEl('examCourseSelect').children.length === 1);
}

console.log('\n— Add exam via the real form path —');
{
    const { sandbox, storage, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    addExamViaForm(run, 'Biology final', '', '2026-09-20');
    check('exam persisted', storage.getItem('exams') !== null);
    const saved = JSON.parse(storage.getItem('exams'))[0];
    check('name stored', saved.name === 'Biology final');
    check('date stored', saved.date === '2026-09-20');
    check('no course link stored as null', saved.courseId === null);
    check('exam row rendered', getEl('examList').children.length === 1);
    check('inputs cleared after add', vm.runInContext('examNameInputEl.value', sandbox) === '');

    // Validation: blank name and missing date are rejected
    addExamViaForm(run, '   ', '', '2026-09-21');
    addExamViaForm(run, 'No date exam', '', '');
    check('blank name rejected', JSON.parse(storage.getItem('exams')).length === 1);
    check('missing date rejected', JSON.parse(storage.getItem('exams')).length === 1);
}

console.log('\n— Countdown math: tomorrow, today, passed —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    check('days-left math: +3 days = 3', vm.runInContext('examDaysLeft("2026-09-20")', sandbox) === 3);
    check('days-left math: today = 0', vm.runInContext('examDaysLeft("2026-09-17")', sandbox) === 0);
    check('days-left math: yesterday = -1', vm.runInContext('examDaysLeft("2026-09-16")', sandbox) === -1);
    check('urgency band: 3 days = urgent', vm.runInContext('examUrgency(3)', sandbox) === 'urgent');
    check('urgency band: 4 days = soon', vm.runInContext('examUrgency(4)', sandbox) === 'soon');
    check('urgency band: 7 days = soon', vm.runInContext('examUrgency(7)', sandbox) === 'soon');
    check('urgency band: 8 days = later', vm.runInContext('examUrgency(8)', sandbox) === 'later');
    check('urgency band: past = past', vm.runInContext('examUrgency(-1)', sandbox) === 'past');
    check('label: today', vm.runInContext('examDaysLabel(0)', sandbox).indexOf('Today') !== -1);
    check('label: tomorrow', vm.runInContext('examDaysLabel(1)', sandbox) === 'Tomorrow');
    check('label: 5 days', vm.runInContext('examDaysLabel(5)', sandbox) === '5 days left');
    check('label: passed 2 days ago', vm.runInContext('examDaysLabel(-2)', sandbox) === 'Passed 2 days ago');

    // Rendered row for a 3-day-out exam carries the urgent class and badge
    addExamViaForm(run, 'Soon exam', '', '2026-09-20');
    const row = getEl('examList').children[0];
    check('urgent row gets urgency-urgent class', row.classList.contains('urgency-urgent'));
    const badge = row.children[0].children[1]; // exam-top > badge
    check('badge shows 3 days left', badge.textContent === '3 days left');
}

console.log('\n— Sorting: soonest first, past sinks to the bottom —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    addExamViaForm(run, 'Later exam', '', '2026-10-01');
    addExamViaForm(run, 'Past exam', '', '2026-09-10');
    addExamViaForm(run, 'Soon exam', '', '2026-09-18');
    const names = getEl('examList').children.map((li) => li.children[0].children[0].textContent);
    check('order is soonest first with past last',
        names[0] === 'Soon exam' && names[1] === 'Later exam' && names[2] === 'Past exam');
    check('past row is muted with urgency-past', getEl('examList').children[2].classList.contains('urgency-past'));
}

console.log('\n— Course link shows name + current grade —');
{
    const { sandbox, getEl, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Biology 101', [['Midterm', 30, 80], ['Quiz', 20, 90], ['Final', 50, null]]);
    const courseId = vm.runInContext('courses[0].id', sandbox);
    check('course dropdown gained the course option', getEl('examCourseSelect').children.length === 2);

    addExamViaForm(run, 'Biology final', courseId, '2026-09-20');
    const courseChip = getEl('examList').children[0].children[0].children[2]; // exam-top > course chip
    check('linked row shows course name + current 84%', courseChip.textContent.indexOf('Biology 101') !== -1 &&
        courseChip.textContent.indexOf('84%') !== -1);

    // Ungraded course: name only, no percent
    buildCourse(run, 'Empty course', []);
    const courseId2 = vm.runInContext('courses[1].id', sandbox);
    addExamViaForm(run, 'Empty course exam', courseId2, '2026-09-25');
    const row2 = getEl('examList').children[1].children[0].children[2];
    check('ungraded link shows name without a grade', row2.textContent === 'Empty course');
}

console.log('\n— Deleting the course unlinks exams (loader coerces, exams survive) —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Doomed course', []);
    const courseId = vm.runInContext('courses[0].id', sandbox);
    addExamViaForm(run, 'Orphan exam', courseId, '2026-09-20');

    // Real two-step delete path for the course
    run(`deleteCourse(courses[0].id); deleteCourse(courses[0].id);`);
    check('course removed', vm.runInContext('courses.length', sandbox) === 0);
    check('exam still in memory after course delete', vm.runInContext('exams.length', sandbox) === 1);

    // Reload: the loader must null the dangling courseId in memory (and never
    // rewrite storage on load — same precedent as the achievements module);
    // the link is fully cleared the next time exams are saved.
    const second = makeSandbox();
    second.sandbox.Date = makeFakeDateClass('2026-09-17T15:00:00');
    second.sandbox.localStorage = storage;
    loadApp(second.sandbox);
    check('exam survives reload after course deletion',
        vm.runInContext('exams.length', second.sandbox) === 1);
    check('dangling courseId coerced to null in memory',
        vm.runInContext('exams[0].courseId', second.sandbox) === null);
    check('loader did not rewrite storage on load',
        JSON.parse(storage.getItem('exams'))[0].courseId === courseId);
    run2Clear(); // an exam save after the reload persists the coerced state
    function run2Clear() {
        const r = (expr) => vm.runInContext(expr, second.sandbox);
        r('examNameInputEl.value = "Another exam";');
        r('examCourseSelectEl.value = "";');
        r('examDateInputEl.value = "2026-09-22";');
        r('addExam();');
    }
    check('next exam save persists the nulled link',
        JSON.parse(storage.getItem('exams')).some((e) => e.name === 'Orphan exam' && e.courseId === null));
}

console.log('\n— Focus on this loads a 25-minute duration without starting —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    addExamViaForm(run, 'Focus target', '', '2026-09-20');
    run(`examListEl.listeners.click[0]({
        target: {
            classList: { contains: (c) => c === 'exam-focus-btn' },
            closest: () => examListEl.children[0]
        }
    });`);
    check('timerDuration key set to 25 minutes', storage.getItem('timerDuration') === String(25 * 60 * 1000));
    check('timer NOT started (interval untouched, state idle)', vm.runInContext('timerState', sandbox) === 'idle');
    check('selectedMs is 25 minutes', vm.runInContext('selectedMs', sandbox) === 25 * 60 * 1000);
}

console.log('\n— Two-step exam delete + cap of 20 —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    addExamViaForm(run, 'Doomed exam', '', '2026-09-20');
    run(`deleteExam(exams[0].id);`);
    check('first delete only arms confirm', JSON.parse(storage.getItem('exams')).length === 1 &&
        vm.runInContext('examConfirmDeleteId === exams[0].id', sandbox) === true);
    run(`deleteExam(exams[0].id);`);
    check('second delete removes the exam', JSON.parse(storage.getItem('exams')).length === 0);

    for (let i = 1; i <= 21; i++) {
        addExamViaForm(run, 'Exam ' + i, '', '2026-10-15');
    }
    check('exam cap of 20 enforced', JSON.parse(storage.getItem('exams')).length === 20);
}

console.log('\n— Corrupt storage falls back to fresh state —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    storage.setItem('exams', '{not json');
    check('corrupt key loads to empty list', vm.runInContext('loadExams().length', sandbox) === 0);
    addExamViaForm(run, 'Rebuilt', '', '2026-09-20');
    check('next save overwrites corrupt key with valid JSON',
        Array.isArray(JSON.parse(storage.getItem('exams'))) &&
        JSON.parse(storage.getItem('exams'))[0].name === 'Rebuilt');

    // Recoverable corruption inside entries is coerced, not dropped
    storage.setItem('exams', JSON.stringify([
        { id: 'e1', name: '  Extra   Spaces  ', courseId: 'ghost', date: '2026-09-20', createdAt: 123 },
        { id: 'e2', name: 'Bad date', date: '20/09/2026' },
        { id: 'e3', name: '', date: '2026-09-21' },
        'garbage'
    ]));
    const loaded = vm.runInContext('loadExams()', sandbox);
    check('name trimmed and whitespace-collapsed', loaded[0].name === 'Extra Spaces');
    check('valid exam kept', loaded.length === 1);
    check('bad date dropped', loaded.every((e) => e.name !== 'Bad date'));
}

console.log('\n— Persistence: exams reload across visits —');
{
    const first = makeSandbox();
    first.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(first.sandbox);
    const run1 = (expr) => vm.runInContext(expr, first.sandbox);
    addExamViaForm(run1, 'Durable exam', '', '2026-09-20');

    const second = makeSandbox();
    second.sandbox.Date = makeFakeDateClass('2026-09-17T15:00:00');
    second.sandbox.localStorage = first.storage; // same browser profile
    loadApp(second.sandbox);
    check('exam restored on reload', vm.runInContext('exams.length', second.sandbox) === 1);
    check('date restored exactly', vm.runInContext('exams[0].date', second.sandbox) === '2026-09-20');
}

console.log('\n— Reset Sessions does NOT touch exams —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    addExamViaForm(run, 'Persistent exam', '', '2026-09-20');
    run('sessionResetBtn.listeners.click[0]();'); // real Reset Sessions handler
    const after = JSON.parse(storage.getItem('exams'));
    check('exams survive Reset Sessions', Array.isArray(after) && after.length === 1 && after[0].name === 'Persistent exam');
}

console.log('\n================================');
console.log(' ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
