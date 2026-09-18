// FocusFlow gradebook logic harness (no test framework — plain asserts).
// Stubs just enough DOM + localStorage for app.js to evaluate, then drives the
// real flows: course CRUD, weighted math, target solver, validation, caps,
// persistence, and isolation from Reset Sessions.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ---------- Stub helpers (mirrors tests/achievements.test.js) ----------
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
    const docListeners = {};
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
            addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
            dispatchEvent(ev) { (docListeners[ev.type] || []).forEach((fn) => fn(ev)); }
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

// Helper: create a course with n assessments via the real UI path.
// scoreFor(i): score % for assessment i (1-based), or null to leave ungraded.
function buildCourse(run, courseName, target, assessments) {
    run(`gbSelectedTarget = ${target};`);
    run(`gbCourseInputEl.value = ${JSON.stringify(courseName)}; addCourse();`);
    run(`expandedCourseId = courses[courses.length - 1].id; renderGradebook();`);
    assessments.forEach(([name, weight, score]) => {
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
    check('no courses key written on load', storage.getItem('courses') === null);
    check('course list hidden and empty state shown', getEl('gbCourseList').hidden === true && getEl('gbCourseEmpty').hidden === false);
    check('overall line shows the starter copy', getEl('gbOverallLine').textContent.indexOf('Add a course') !== -1);
}

console.log('\n— Create course and add assessments (real UI path) —');
{
    const { sandbox, storage, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Biology 101', 80, [
        ['Midterm', 30, 80],
        ['Quiz', 20, 90],
        ['Final', 50, null]
    ]);
    check('one course persisted', storage.getItem('courses') !== null && JSON.parse(storage.getItem('courses')).length === 1);
    const saved = JSON.parse(storage.getItem('courses'))[0];
    check('course name stored', saved.name === 'Biology 101');
    check('target stored', saved.target === 80);
    check('3 assessments stored', saved.assessments.length === 3);
    check('ungraded score stored as null', saved.assessments[2].score === null);
    check('course row rendered', getEl('gbCourseList').children.length === 1);

    // Blank names must be rejected
    run(`document.getElementById('gbAssessName').value = '   ';`);
    run(`document.getElementById('gbAssessWeight').value = '25';`);
    run(`addAssessment(courses[0].id);`);
    check('blank assessment name rejected', JSON.parse(storage.getItem('courses'))[0].assessments.length === 3);
}

console.log('\n— Weighted current grade math —');
{
    const { sandbox, storage, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    // 80x30 + 90x20 = 2400+1800 = 4200 over 50 graded weight => 84%
    buildCourse(run, 'Math', 80, [['Midterm', 30, 80], ['Quiz', 20, 90], ['Final', 50, null]]);
    const calc = vm.runInContext('gbCompute(courses[0])', sandbox);
    check('current = 84% over graded weight', Math.abs(calc.current - 84) < 1e-9);
    check('gradedWeight = 50', calc.gradedWeight === 50);
    check('remainingWeight = 50', calc.remainingWeight === 50);
    check('totalWeight = 100', calc.totalWeight === 100);
    check('status line shows current grade', getEl('gbCourseList').children[0].children.length >= 2);
}

console.log('\n— Target solver: reachable, secured, impossible —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    // Reachable: 80x30 + 90x20 graded (84% so far), target 80, final 50% left
    // need = (80*100 - 4200) / 50 = 76
    buildCourse(run, 'Reachable', 80, [['Midterm', 30, 80], ['Quiz', 20, 90], ['Final', 50, null]]);
    let status = getEl('gbCourseList').children[0].children[1].textContent;
    check('reachable case shows needed score', status.indexOf('Need about 76%') !== -1);

    // Secured: 90x90 graded (8100 contribution), target 80, 10% left
    // need = (80*100 - 8100) / 10 < 0
    const secured = makeSandbox();
    secured.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(secured.sandbox);
    const runS = (expr) => vm.runInContext(expr, secured.sandbox);
    buildCourse(runS, 'Secured', 80, [['Midterm', 90, 90], ['Final', 10, null]]);
    status = secured.getEl('gbCourseList').children[0].children[1].textContent;
    check('secured case shows target secured', status.indexOf('Target secured') !== -1);

    // Impossible: 10x50 graded (500 contribution), target 90, 50% left
    // need = (90*100 - 500) / 50 = 170; best possible = (500 + 50*100) / 100 = 55
    const hopeless = makeSandbox();
    hopeless.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(hopeless.sandbox);
    const runH = (expr) => vm.runInContext(expr, hopeless.sandbox);
    buildCourse(runH, 'Hopeless', 90, [['Midterm', 50, 10], ['Final', 50, null]]);
    status = hopeless.getEl('gbCourseList').children[0].children[1].textContent;
    check('impossible case shows out of reach', status.indexOf('Out of reach') !== -1);
    check('impossible case shows best possible ~55%', status.indexOf('55%') !== -1);
}

console.log('\n— Course complete: target met and missed —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    // All graded: 85 average vs target 80 -> met
    run(`gbCourseInputEl.value = 'Done Course'; addCourse();`);
    run(`expandedCourseId = courses[0].id; renderGradebook();`);
    run(`document.getElementById('gbAssessName').value = 'Everything';`);
    run(`document.getElementById('gbAssessWeight').value = '100';`);
    run(`document.getElementById('gbAssessScore').value = '85';`);
    run(`addAssessment(courses[0].id);`);
    let status = getEl('gbCourseList').children[0].children[1].textContent;
    check('fully graded above target shows target met', status.indexOf('Target met') !== -1);

    // Below target -> missed
    run(`courses[0].assessments[0].score = 50; saveCourses(); renderGradebook();`);
    status = getEl('gbCourseList').children[0].children[1].textContent;
    check('fully graded below target shows target missed', status.indexOf('target missed') !== -1);
}

console.log('\n— Weight-total warning —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Odd weights', 80, [['Midterm', 30, 80], ['Final', 50, null]]);
    const status = getEl('gbCourseList').children[0].children[1].textContent;
    check('warns when weights total 80%', status.indexOf('total 80%') !== -1);

    // No warning when weights total exactly 100
    run(`gbCourseInputEl.value = 'Exact weights'; addCourse();`);
    run(`expandedCourseId = courses[1].id; renderGradebook();`);
    run(`document.getElementById('gbAssessName').value = 'All';`);
    run(`document.getElementById('gbAssessWeight').value = '100';`);
    run(`addAssessment(courses[1].id);`);
    const status2 = getEl('gbCourseList').children[1].children[1].textContent;
    check('no warning at exactly 100%', status2.indexOf('⚠️') === -1);
}

console.log('\n— Overall average across courses —');
{
    const { sandbox, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Course A', 80, [['Midterm', 100, 80]]);
    buildCourse(run, 'Course B', 80, [['Midterm', 100, 90]]);
    // The stub keeps textContent assignments literal: the composed line is
    // strong (children[0]) + text node (children[1]).
    const overallStrong = getEl('gbOverallLine').children[0].textContent;
    const overallTail = getEl('gbOverallLine').children[1].textContent;
    check('overall averages graded courses (85%)', overallStrong.indexOf('Overall 85%') !== -1);
    check('overall notes courses without grades', overallTail.indexOf('without grades') !== -1);

    // Add an ungraded course: average must not change
    run(`gbCourseInputEl.value = 'Course C'; addCourse();`);
    run(`expandedCourseId = courses[2].id; renderGradebook();`);
    run(`document.getElementById('gbAssessName').value = 'Final';`);
    run(`document.getElementById('gbAssessWeight').value = '100';`);
    run(`addAssessment(courses[2].id);`);
    check('ungraded course excluded from overall',
        getEl('gbOverallLine').children[0].textContent.indexOf('Overall 85%') !== -1);
    check('overall count says 2 courses',
        getEl('gbOverallLine').children[1].textContent.indexOf('across 2 courses') !== -1);
}

console.log('\n— Input validation: weight and score bounds —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    run(`gbCourseInputEl.value = 'Validated'; addCourse();`);
    run(`expandedCourseId = courses[0].id; renderGradebook();`);

    // Weight 0 rejected
    run(`document.getElementById('gbAssessName').value = 'A';`);
    run(`document.getElementById('gbAssessWeight').value = '0';`);
    run(`addAssessment(courses[0].id);`);
    check('weight 0 rejected', courses_len(storage) === 0);

    // Weight 150 rejected
    run(`document.getElementById('gbAssessWeight').value = '150';`);
    run(`addAssessment(courses[0].id);`);
    check('weight 150 rejected', courses_len(storage) === 0);

    // Score 150 rejected
    run(`document.getElementById('gbAssessWeight').value = '50';`);
    run(`document.getElementById('gbAssessScore').value = '150';`);
    run(`addAssessment(courses[0].id);`);
    check('score 150 rejected', courses_len(storage) === 0);

    // Valid row lands
    run(`document.getElementById('gbAssessScore').value = '72.5';`);
    run(`addAssessment(courses[0].id);`);
    const saved = JSON.parse(storage.getItem('courses'))[0];
    check('valid assessment saved with fractional score', saved.assessments.length === 1 && saved.assessments[0].score === 72.5);
}
function courses_len(storage) {
    const raw = storage.getItem('courses');
    if (raw === null) return 0;
    const arr = JSON.parse(raw);
    return arr.length > 0 ? arr[0].assessments.length : 0;
}

console.log('\n— Caps enforced —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    // MAX_COURSES = 10
    for (let i = 1; i <= 11; i++) {
        run(`gbCourseInputEl.value = 'C${i}'; addCourse();`);
    }
    check('course cap of 10 enforced', JSON.parse(storage.getItem('courses')).length === 10);

    // MAX_ASSESSMENTS_PER_COURSE = 15
    run(`expandedCourseId = courses[0].id; renderGradebook();`);
    for (let i = 1; i <= 16; i++) {
        run(`document.getElementById('gbAssessName').value = 'A${i}';`);
        run(`document.getElementById('gbAssessWeight').value = '10';`);
        run(`addAssessment(courses[0].id);`);
    }
    check('assessment cap of 15 enforced', JSON.parse(storage.getItem('courses'))[0].assessments.length === 15);
}

console.log('\n— Two-step course delete + Escape disarm —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    run(`gbCourseInputEl.value = 'Doomed'; addCourse();`);
    check('course created', JSON.parse(storage.getItem('courses')).length === 1);

    // Simulate the delegated click path by invoking the real handler
    run(`deleteCourse(courses[0].id);`);
    check('first delete only arms confirm', JSON.parse(storage.getItem('courses')).length === 1 &&
        vm.runInContext('gbConfirmDeleteId === courses[0].id', sandbox) === true);

    // Escape disarms (real document keydown handler via the stub dispatcher)
    run(`document.dispatchEvent({ type: 'keydown', key: 'Escape' });`);
    check('Escape disarms confirm', vm.runInContext('gbConfirmDeleteId', sandbox) === null);
    check('course still there after Escape', JSON.parse(storage.getItem('courses')).length === 1);

    // Arm again, confirm removes it
    run(`deleteCourse(courses[0].id); deleteCourse(courses[0].id);`);
    check('second delete removes the course', JSON.parse(storage.getItem('courses')).length === 0);
}

console.log('\n— Corrupt storage falls back to fresh state —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    storage.setItem('courses', '{not json');
    check('corrupt key loads to empty list', vm.runInContext('loadCourses().length', sandbox) === 0);
    run(`gbCourseInputEl.value = 'Rebuilt'; addCourse();`);
    check('next save overwrites corrupt key with valid JSON',
        Array.isArray(JSON.parse(storage.getItem('courses'))) &&
        JSON.parse(storage.getItem('courses'))[0].name === 'Rebuilt');

    // Recoverable corruption inside entries is coerced, not dropped
    storage.setItem('courses', JSON.stringify([{
        id: 'c1', name: '  Spaced   Out  ', target: 999, // bad target
        assessments: [{ id: 'a1', name: 'Midterm', weight: '30', score: '80' }, { id: 'a2', name: '', weight: 10, score: null }]
    }]));
    const loaded = vm.runInContext('loadCourses()', sandbox);
    check('course name trimmed and whitespace-collapsed', loaded[0].name === 'Spaced Out');
    check('bad target coerced to default 80', loaded[0].target === 80);
    check('string weight coerced to number', loaded[0].assessments[0].weight === 30);
    check('assessment with empty name dropped', loaded[0].assessments.length === 1);
}

console.log('\n— Persistence: courses reload across visits —');
{
    const first = makeSandbox();
    first.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(first.sandbox);
    const run1 = (expr) => vm.runInContext(expr, first.sandbox);
    buildCourse(run1, 'Durable', 80, [['Midterm', 30, 80], ['Final', 50, null]]);

    const second = makeSandbox();
    second.sandbox.Date = makeFakeDateClass('2026-09-17T15:00:00');
    second.sandbox.localStorage = first.storage; // same browser profile
    loadApp(second.sandbox);
    check('course restored on reload', vm.runInContext('courses.length', second.sandbox) === 1);
    check('assessments restored with scores', vm.runInContext('courses[0].assessments.filter(function (a) { return a.score === 80; }).length', second.sandbox) === 1);
    check('target restored', vm.runInContext('courses[0].target', second.sandbox) === 80);
}

console.log('\n— Reset Sessions does NOT touch the gradebook —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildCourse(run, 'Persistent', 80, [['Midterm', 30, 80]]);
    run('sessionResetBtn.listeners.click[0]();'); // real Reset Sessions handler
    const after = JSON.parse(storage.getItem('courses'));
    check('courses survive Reset Sessions', Array.isArray(after) && after.length === 1 && after[0].assessments.length === 1);
    check('gradebook untouched by session reset', after[0].assessments[0].score === 80);
}

console.log('\n================================');
console.log(' ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
