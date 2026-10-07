const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/preview.css'), 'utf8');
const styles = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  .contributes.configuration.properties['markdownLens.style'].enum;
// Read literal palette declarations; browser QA checks the computed CSS cascade.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
  selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  declarations,
  colors: Object.fromEntries([...declarations.matchAll(/--([\w-]+):\s*(#[\da-f]{6}|#[\da-f]{3})\b/g)]
    .map(([, name, value]) => [name, value]))
}));
const defaults = Object.assign({}, ...rules.filter(r => r.selector === ':root').map(r => r.colors));
const lightSelector = 'body:not(:is([data-appearance="dark"],[data-appearance="auto"].vscode-dark,[data-appearance="auto"].vscode-high-contrast))';
const lightColors = rules.find(r => r.selector === lightSelector).colors;
const channels = hex => (hex.length === 4 ? hex.slice(1).split('').map(n => n + n).join('') : hex.slice(1))
  .match(/../g).map(n => parseInt(n, 16) / 255);
const luminance = rgb => rgb.map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const mix = (a, b, weight) => a.map((n, i) => n * weight + b[i] * (1 - weight));

for (const style of styles) {
  test(`${style}: light text, syntax, callouts, and controls have readable contrast`, () => {
    const colors = { ...defaults, ...rules.find(r => r.selector === `body[data-style="${style}"]`)?.colors, ...lightColors };
    const palette = Object.fromEntries(Object.entries(colors).map(([name, hex]) => [name, channels(hex)]));
    const surfaces = [palette.bg, palette.surface, palette.code,
      mix(palette.code, palette.surface, .65), mix(palette.accent, palette.surface, .12)];
    for (const name of ['text', 'muted', 'accent', 'syntax-keyword', 'syntax-string', 'syntax-number']) {
      for (const surface of surfaces) {
        const ratio = contrast(palette[name], surface);
        assert.ok(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)} is below 4.5:1`);
      }
    }
    assert.ok(contrast(palette.bg, palette.accent) >= 4.5, 'table header text');
    const controlBorder = mix(palette.muted, palette.surface, .8);
    for (const surface of [palette.surface, palette.bg]) {
      assert.ok(contrast(controlBorder, surface) >= 3, 'control boundary contrast');
    }
    for (const rule of rules.filter(r => r.selector.startsWith(lightSelector) && r.colors['alert-color'])) {
      assert.ok(contrast(channels(rule.colors['alert-color']), palette.code) >= 4.5, rule.selector);
    }
    const error = rules.find(r => r.selector === `${lightSelector} .diagram-error`).declarations.match(/color:\s*(#[\da-f]{6})/)[1];
    assert.ok(contrast(channels(error), palette.surface) >= 4.5, 'diagram error');
  });
}
