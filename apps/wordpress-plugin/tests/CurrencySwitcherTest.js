const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'currency-switcher.js'), 'utf8');

function element(attributes, text) {
    const attrs = Object.assign({}, attributes);
    return {
        textContent: text || '',
        classList: { contains: () => false, toggle() {}, add() {}, remove() {} },
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        setAttribute: (name, value) => { attrs[name] = String(value); },
        hasAttribute: (name) => name in attrs,
        removeAttribute: (name) => { delete attrs[name]; },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        contains: () => false
    };
}

async function run(storedCurrency) {
    const price = element({ 'data-amount': '330.00', 'data-currency': 'EUR' }, '330.00 €');
    const switcher = element({ 'data-currencies': 'EUR,ALL', 'data-default': 'EUR', 'data-note': 'Approximate prices.' });
    const options = [];
    function option() {
        const node = element({});
        node.labels = { '.must-currency-code': element({}), '.must-currency-name': element({}) };
        node.querySelector = (selector) => node.labels[selector];
        node.cloneNode = option;
        return node;
    }
    const template = option();
    const menu = element({});
    menu.querySelector = () => template;
    menu.appendChild = (node) => options.push(node);
    switcher.querySelector = (selector) => selector === '.must-currency-menu' ? menu : null;
    switcher.querySelectorAll = () => options;
    const context = {
        window: {
            mustCurrencyConfig: { ajaxUrl: '/ajax', currencyNames: { EUR: 'Euro', ALL: 'Albanian Lek' } },
            localStorage: { getItem: () => storedCurrency, setItem() {} },
            fetch: () => Promise.resolve({
                json: () => Promise.resolve({ success: true, data: { base: 'EUR', rates: { ALL: 100 }, displayCurrencies: ['ALL', 'XYZ'] } })
            })
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
    return { price, options };
}

(async () => {
    const { price: converted, options } = await run('ALL');
    assert.deepEqual(options.map((node) => node.labels['.must-currency-name'].textContent), ['Euro', 'Albanian Lek', 'XYZ'], 'rebuilt options use PHP-provided names and fall back to the code for unknown names');
    assert.equal(options[0].labels['.must-currency-code'].textContent, 'EUR', 'the code remains visible beside the readable name');
    assert.match(converted.textContent, /^≈ .*33,?000/, 'a converted price shows the amount in the chosen currency');
    assert.ok(converted.textContent.endsWith('(330.00 €)'), 'what the guest really pays stays in brackets: ' + converted.textContent);

    const { price: own } = await run('EUR');
    assert.equal(own.textContent, '330.00 €', 'a price in the hotel currency is left exactly as it is');
    process.stdout.write('Currency switcher test passed.\n');
})().catch((error) => { console.error(error); process.exit(1); });
