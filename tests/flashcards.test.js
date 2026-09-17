// FocusFlow flashcards logic harness (no test framework — plain asserts).
// Stubs just enough DOM + localStorage for app.js to evaluate, then drives the
// real flows: deck CRUD, Leitner grading, due scheduling, persistence,
// achievements integration and isolation from Reset Sessions.
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
        append(...args) { args.forEach((c) => this.children.push(c)); },
        prepend(...args) { args.forEach((c) => this.children.unshift(c)); },
        remove() {},
        focus() {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelectorAll: () => [],
        closest: () => null
    };
    // Match real DOM semantics: assigning innerHTML replaces all children
    // (app.js re-renders lists via innerHTML = '' + appendChild loops).
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

// Helper: build a deck with n cards via the real addDeck/addCard path
function buildDeck(run, deckName, cardCount) {
    run(`fcDeckInputEl.value = ${JSON.stringify(deckName)}; addDeck();`);
    run(`expandedDeckId = decks[decks.length - 1].id; renderDecks();`);
    for (let i = 1; i <= cardCount; i++) {
        run(`document.getElementById('fcFrontInput').value = 'Q${i}';`);
        run(`document.getElementById('fcBackInput').value = 'A${i}';`);
        run('addCard(decks[decks.length - 1].id);');
    }
}

console.log('\n— Load with fresh storage —');
{
    const { sandbox, getEl, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    check('app evaluates without throwing', true);
    check('no decks key written on load', storage.getItem('flashcardDecks') === null);
    check('deck list hidden and empty state shown', getEl('fcDeckList').hidden === true && getEl('fcDeckEmpty').hidden === false);
}

console.log('\n— Create deck and add cards (real UI path) —');
{
    const { sandbox, storage, getEl } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);

    buildDeck(run, 'Biology — Chapter 4', 3);
    check('one deck persisted', storage.getItem('flashcardDecks') !== null && JSON.parse(storage.getItem('flashcardDecks')).length === 1);
    const saved = JSON.parse(storage.getItem('flashcardDecks'));
    check('deck name stored', saved[0].name === 'Biology — Chapter 4');
    check('3 cards stored', saved[0].cards.length === 3);
    check('new cards start in box 1', saved[0].cards.every((c) => c.box === 1));
    check('new cards are due immediately (due=0)', saved[0].cards.every((c) => c.due === 0));
    check('deck row rendered', getEl('fcDeckList').children.length === 1);

    // Blank card faces must be rejected
    run(`document.getElementById('fcFrontInput').value = '   ';`);
    run(`document.getElementById('fcBackInput').value = 'A4';`);
    run('addCard(decks[decks.length - 1].id);');
    check('blank front rejected', JSON.parse(storage.getItem('flashcardDecks'))[0].cards.length === 3);
}

console.log('\n— Study round: grading updates Leitner boxes and stats —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'History', 4);

    run('startStudy(decks[0].id);');
    check('study view replaces deck view', vm.runInContext('fcStudyViewEl.hidden === false && fcDeckViewEl.hidden === true', sandbox));
    let data = JSON.parse(storage.getItem('flashcardDecks'));

    // Card 1: got it -> box 2, due tomorrow (grade requires a flip first —
    // the app refuses to grade an unflipped card, so flip every time)
    run('flipStudyCard(); gradeStudyCard(true);');
    data = JSON.parse(storage.getItem('flashcardDecks'));
    check('correct card promoted to box 2', data[0].cards.some((c) => c.box === 2));

    // Card 2: again -> stays box 1
    run('flipStudyCard(); gradeStudyCard(false);');
    data = JSON.parse(storage.getItem('flashcardDecks'));
    check('missed card stays in box 1', data[0].cards.filter((c) => c.box === 1).length === 3);

    // Finish the round: cards 3 and 4
    run('flipStudyCard(); gradeStudyCard(true);');
    run('flipStudyCard(); gradeStudyCard(true);');
    check('round auto-ends after last card', vm.runInContext('study', sandbox) === null);
    const stats = JSON.parse(storage.getItem('flashcardStats'));
    check('lifetime reviewed counted', stats.reviewed === 4);
    check('lifetime correct counted', stats.correct === 3);
    check('due badge math: 3 promoted cards not due today', JSON.parse(storage.getItem('flashcardDecks'))[0].cards.filter((c) => c.due > Date.now()).length === 3);
}

console.log('\n— Due-date scheduling after grading —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'Vocab', 2);
    run('startStudy(decks[0].id);');
    run('gradeStudyCard(true);');
    run('flipStudyCard(); gradeStudyCard(true);');
    const now = new Date('2026-09-17T14:00:00').getTime();
    const cards = JSON.parse(storage.getItem('flashcardDecks'))[0].cards;
    const oneDay = 86400000;
    check('box 2 due ≈ +1 day', Math.abs(cards[0].due - (now + 1 * oneDay)) < 1000);
    // Drive one card to box 3 and check the +3 day interval
    // (interval is indexed by the NEW box after grading: 2→+1d, 3→+3d, 4→+7d)
    run('decks[0].cards[1].box = 2; decks[0].cards[1].due = 0; saveDecks();');
    run('startStudy(decks[0].id);');
    run('flipStudyCard(); gradeStudyCard(true);'); // box 2 -> 3
    const cards2 = JSON.parse(storage.getItem('flashcardDecks'))[0].cards;
    check('box 3 due ≈ +3 days', Math.abs(cards2[1].due - (now + 3 * oneDay)) < 1000);
}

console.log('\n— Preview round when nothing is due —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'Preview', 2);
    // Push every card into the future (box 2, due tomorrow)
    run('decks[0].cards.forEach(function (c) { c.box = 2; c.due = Date.now() + 86400000; }); saveDecks();');
    run('startStudy(decks[0].id);');
    check('preview round offered when nothing is due', vm.runInContext('study.roundSize', sandbox) === 2);
    run('flipStudyCard(); gradeStudyCard(true); flipStudyCard(); gradeStudyCard(true);');
    check('preview round still grades normally', JSON.parse(storage.getItem('flashcardStats')).reviewed === 2);
}

console.log('\n— Card Sharp badge at 50 reviews —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'Grind', 2);
    for (let i = 0; i < 49; i++) {
        // Keep cards due so every round has work
        run('decks[0].cards.forEach(function (c) { c.due = 0; }); saveDecks();');
        run('startStudy(decks[0].id);');
        run('flipStudyCard(); gradeStudyCard(true);');
        run('flipStudyCard(); gradeStudyCard(true);');
        i++; // two grades per loop
    }
    const achv = JSON.parse(storage.getItem('achievements'));
    check('Card Sharp unlocked at 50 reviews', !!(achv.unlocked && achv.unlocked.cardSharp));
    check('flashcardsReviewed counter = 50', achv.counters.flashcardsReviewed === 50);
    check('Perfect Recall NOT unlocked (rounds of 2 < 5 min)', !achv.unlocked.perfectRecall);
}

console.log('\n— Perfect Recall badge (5+ cards, 100% correct) —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'Sprint', 5);
    run('startStudy(decks[0].id);');
    for (let i = 0; i < 5; i++) run('flipStudyCard(); gradeStudyCard(true);');
    const achv = JSON.parse(storage.getItem('achievements'));
    check('Perfect Recall unlocked on 5/5 round', !!(achv.unlocked && achv.unlocked.perfectRecall));
    check('perfectRounds counted once', achv.counters.perfectRounds === 1);

    // A 4/5 round must NOT add another perfect round
    run('decks[0].cards.forEach(function (c) { c.due = 0; }); saveDecks();');
    run('startStudy(decks[0].id);');
    run('flipStudyCard(); gradeStudyCard(false);');
    run('flipStudyCard(); gradeStudyCard(true);');
    run('flipStudyCard(); gradeStudyCard(true);');
    run('flipStudyCard(); gradeStudyCard(true);');
    run('flipStudyCard(); gradeStudyCard(true);');
    const achv2 = JSON.parse(storage.getItem('achievements'));
    check('imperfect round does not increment perfectRounds', achv2.counters.perfectRounds === 1);
}

console.log('\n— Reset Sessions does NOT touch flashcards —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    buildDeck(run, 'Persistent', 2);
    run('startStudy(decks[0].id);');
    run('flipStudyCard(); gradeStudyCard(true); flipStudyCard(); gradeStudyCard(true);');
    run('sessionResetBtn.listeners.click[0]();'); // real Reset Sessions handler
    const decksAfter = JSON.parse(storage.getItem('flashcardDecks'));
    const statsAfter = JSON.parse(storage.getItem('flashcardStats'));
    check('decks survive Reset Sessions', Array.isArray(decksAfter) && decksAfter.length === 1 && decksAfter[0].cards.length === 2);
    check('flashcard stats survive Reset Sessions', statsAfter.reviewed === 2 && statsAfter.correct === 2);
    check('Card Sharp progress survives Reset Sessions',
        JSON.parse(storage.getItem('achievements')).counters.flashcardsReviewed === 2);
}

console.log('\n— Corrupt storage falls back to fresh state —');
{
    const { sandbox, storage } = makeSandbox();
    sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(sandbox);
    const run = (expr) => vm.runInContext(expr, sandbox);
    storage.setItem('flashcardDecks', '{not json');
    storage.setItem('flashcardStats', 'also bad');
    // Re-load: loaders must recover without throwing
    check('corrupt decks key loads to empty list', vm.runInContext('loadDecks().length', sandbox) === 0);
    check('corrupt stats key loads to zeros', vm.runInContext('loadFcStats().reviewed', sandbox) === 0);
    // A subsequent save must overwrite with valid JSON
    run('fcDeckInputEl.value = "Rebuilt"; addDeck();');
    check('next save overwrites corrupt key with valid JSON',
        Array.isArray(JSON.parse(storage.getItem('flashcardDecks'))) &&
        JSON.parse(storage.getItem('flashcardDecks'))[0].name === 'Rebuilt');
}

console.log('\n— Persistence: decks and stats reload across visits —');
{
    const first = makeSandbox();
    first.sandbox.Date = makeFakeDateClass('2026-09-17T14:00:00');
    loadApp(first.sandbox);
    const run1 = (expr) => vm.runInContext(expr, first.sandbox);
    buildDeck(run1, 'Durable', 3);
    run1('startStudy(decks[0].id);');
    run1('flipStudyCard(); gradeStudyCard(true); flipStudyCard(); gradeStudyCard(true); flipStudyCard(); gradeStudyCard(true);');

    const second = makeSandbox();
    second.sandbox.Date = makeFakeDateClass('2026-09-17T15:00:00');
    second.sandbox.localStorage = first.storage; // same browser profile
    loadApp(second.sandbox);
    const run2 = (expr) => vm.runInContext(expr, second.sandbox);
    check('deck restored on reload', vm.runInContext('decks.length', second.sandbox) === 1);
    check('cards restored with box positions', vm.runInContext('decks[0].cards.filter(function (c) { return c.box === 2; }).length', second.sandbox) === 3);
    check('stats restored on reload', vm.runInContext('fcStats.reviewed', second.sandbox) === 3);
    run2('startStudy(decks[0].id);');
    check('only non-due filtering works after reload: nothing due for 1 day', vm.runInContext('study.roundSize', second.sandbox) === 3); // preview mode kicks in
}

console.log('\n================================');
console.log(' ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
