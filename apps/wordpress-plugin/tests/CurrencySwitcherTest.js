const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'currency-switcher.js'), 'utf8');

function element(attributes, text) {
    const attrs = Object.assign({}, attributes);
    const listeners = {};
    return {
        textContent: text || '',
        listeners,
        style: {},
        focus() {},
        classList: { contains: () => false, toggle() {}, add() {}, remove() {} },
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        setAttribute: (name, value) => { attrs[name] = String(value); },
        hasAttribute: (name) => name in attrs,
        removeAttribute: (name) => { delete attrs[name]; },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener(name, handler) { listeners[name] = handler; },
        contains: () => false
    };
}

async function run(storedCurrency, payload, amount = '330.00', currency = 'EUR', menuCurrencies = 'EUR,ALL,USD,GBP,XYZ') {
    const original = amount + (currency === 'EUR' ? ' \u20ac' : ' ' + currency);
    const price = element({ 'data-amount': amount, 'data-currency': currency }, original);
    const switcher = element({ 'data-currencies': menuCurrencies, 'data-default': 'EUR', 'data-note': 'Approximate prices.' });
    const options = [];
    function option() {
        const node = element({});
        node.labels = { '.must-currency-code': element({}), '.must-currency-name': element({}) };
        node.querySelector = (selector) => node.labels[selector];
        node.cloneNode = option;
        node.closest = () => node;
        return node;
    }
    const template = option();
    const menu = element({});
    menu.querySelector = () => template;
    menu.appendChild = (node) => options.push(node);
    const trigger = element({});
    menu.contains = (node) => options.includes(node);
    switcher.querySelector = (selector) => selector === '.must-currency-menu' ? menu : selector === '.must-currency-trigger' ? trigger : null;
    switcher.querySelectorAll = () => options;
    let requestedUrl;
    const context = {
        window: {
            mustCurrencyConfig: { ajaxUrl: '/ajax', currencyNames: { EUR: 'Euro', ALL: 'Albanian Lek' } },
            localStorage: { getItem: () => storedCurrency, setItem() {} },
            fetch: (url) => {
                requestedUrl = url;
                return Promise.resolve({
                    json: () => Promise.resolve({ success: true, data: payload || { base: 'EUR', rates: { ALL: 100 }, displayCurrencies: ['ALL', 'XYZ'] } })
                });
            }
        },
        document: {
            documentElement: { lang: 'en' },
            querySelectorAll: (selector) => {
                if (selector === '.must-currency-switcher') return [switcher];
                if (selector === '.must-price[data-amount]') return [price];
                return [];
            },
            querySelector: (selector) => (selector === '.must-price[data-converted]' && price.hasAttribute('data-converted') ? price : null),
            createElement: () => element({}),
            addEventListener() {}
        },
        Intl, parseFloat, isFinite, Array, console
    };
    context.window.document = context.document;
    vm.runInNewContext(source, context);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { price, options, requestedUrl, choose(code) {
        const chosen = options.find((node) => node.getAttribute('data-value') === code);
        assert.ok(chosen, 'the chosen currency exists in the rebuilt menu');
        menu.listeners.click({ target: chosen });
    } };
}

(async () => {
    const { price: converted, options } = await run('ALL');
    assert.deepEqual(options.map((node) => node.labels['.must-currency-name'].textContent), ['Euro', 'Albanian Lek', 'XYZ'], 'rebuilt options use PHP-provided names and fall back to the code for unknown names');
    assert.equal(options[0].labels['.must-currency-code'].textContent, 'EUR', 'the code remains visible beside the readable name');
    assert.match(converted.textContent, /^≈ .*33,?000/, 'a converted price shows the amount in the chosen currency');
    assert.ok(converted.textContent.endsWith('(330.00 €)'), 'what the guest really pays stays in brackets: ' + converted.textContent);

    const { price: own } = await run('EUR');
    assert.equal(own.textContent, '330.00 €', 'a price in the hotel currency is left exactly as it is');
    const hotelRates = { base: 'ALL', rates: { EUR: 1 / 90, GBP: 1 / 108, USD: 1 / 81.4 }, displayCurrencies: ['EUR', 'GBP', 'USD'] };
    function expected(amount, currency, original = '411.12 \u20ac') {
        return '\u2248 ' + new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount) + ' (' + original + ')';
    }
    const cross = await run('USD', hotelRates, '411.12');
    assert.equal(cross.price.textContent, expected(454.56, 'USD'), 'a euro price converts to dollars through the lek base using the hotel rates');
    cross.choose('ALL');
    assert.equal(cross.price.textContent, expected(37000.80, 'ALL'), 'the hotel base needs no explicit rate entry and converts the euro price to lek');
    cross.choose('GBP');
    assert.equal(cross.price.textContent, expected(342.60, 'GBP'), 'switching again converts from the original euro amount, not the previous display');
    cross.choose('EUR');
    assert.equal(cross.price.textContent, '411.12 \u20ac', 'returning to euros restores the original payable amount exactly');
    assert.equal(cross.price.hasAttribute('data-converted'), false, 'returning to the original currency removes the conversion marker');
    assert.equal(cross.price.getAttribute('data-amount'), '411.12', 'conversion never mutates the original amount');
    assert.equal(cross.price.getAttribute('data-currency'), 'EUR', 'conversion never mutates the original currency');

    const hiddenSource = await run('USD', Object.assign({}, hotelRates, { displayCurrencies: ['USD'] }), '411.12', 'EUR', 'ALL,USD');
    assert.ok(new URL(hiddenSource.requestedUrl, 'https://example.test').searchParams.get('currencies').split(',').includes('EUR'), 'request the original price currency even when it is absent from the menu');
    assert.deepEqual(hiddenSource.options.map((node) => node.getAttribute('data-value')), ['ALL', 'USD'], 'the original price currency is not added to the hotel-selected menu');
    assert.equal(hiddenSource.price.textContent, expected(454.56, 'USD'), 'a hidden original currency still supplies the conversion leg');

    // The payload PHP really emits (shared fixture, asserted in CurrencySwitcherRatesTest.php) converts a euro
    // room price into dollars through the lek base, with only USD in the hotel-selected menu.
    const emitted = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'currency-switcher-ajax.json'), 'utf8'));
    const fromPhp = await run('USD', emitted, '411.12', 'EUR', 'ALL,USD');
    assert.equal(fromPhp.price.textContent, expected(454.56, 'USD'), 'the payload emitted by the PHP handler drives the converter');
    assert.deepEqual(fromPhp.options.map((node) => node.getAttribute('data-value')), ['ALL', 'USD'], 'the menu follows the emitted displayCurrencies');

    const basePrice = await run('USD', hotelRates, '37000.80', 'ALL');
    assert.equal(basePrice.price.textContent, expected(454.56, 'USD', '37000.80 ALL'), 'a price already in the lek base still converts normally');
    for (const missing of ['EUR', 'USD']) {
        for (const invalid of [undefined, 0, -1, Infinity, 'bad']) {
            const rates = Object.assign({}, hotelRates.rates, { [missing]: invalid });
            const unavailable = await run('USD', Object.assign({}, hotelRates, { rates }), '411.12');
            assert.equal(unavailable.price.textContent, '411.12 \u20ac', 'a missing or invalid ' + missing + ' rate preserves the original price');
            assert.equal(unavailable.price.hasAttribute('data-converted'), false, 'an unavailable conversion is never marked converted');
        }
    }
    process.stdout.write('Currency switcher tests passed (legacy conversion, readable names, cross-currency switching, original price preservation, base-currency prices, and 10 invalid-rate cases).\n');
})().catch((error) => { console.error(error); process.exit(1); });
