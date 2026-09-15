'use strict';

const fs = require('fs');
const path = require('path');

describe('Mobile Hardening & Readability Verification (P1.6-M)', () => {
  const root = path.join(__dirname, '..');
  const mobileCss = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
  const enhancementsCss = fs.readFileSync(path.join(root, 'enhancements.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  test('1. No global scale or zoom workarounds in stylesheets', () => {
    expect(mobileCss).not.toMatch(/zoom\s*:\s*0\.[0-9]+/);
    expect(mobileCss).not.toMatch(/transform\s*:\s*scale\(0\.[0-9]+\)/);
    expect(enhancementsCss).not.toMatch(/html\s*\{[^}]*zoom/);
    expect(enhancementsCss).not.toMatch(/body\s*\{[^}]*zoom/);
  });

  test('2. Header Action Pill micro-font workaround is removed', () => {
    expect(enhancementsCss).not.toContain('font-size: 10px !important;');
  });

  test('3. Mobile Header has 3-tier architecture', () => {
    expect(mobileCss).toContain('.topbar-main');
    expect(mobileCss).toContain('.header-actions-primary');
    expect(mobileCss).toMatch(/grid-template-columns:\s*1fr\s+1fr/);
    expect(mobileCss).toContain('.header-actions-secondary');
    expect(mobileCss).toMatch(/overflow-x:\s*auto/);
  });

  test('4. Primary mobile touch targets meet >= 40-44px standard', () => {
    expect(mobileCss).toMatch(/\.header-actions-primary\s+\.header-action-pill\s*\{[^}]*min-height:\s*4[4-8]px/);
    expect(mobileCss).toMatch(/\.fab-quick-add\s*\{[^}]*width:\s*56px/);
    expect(mobileCss).toMatch(/\.fab-quick-add\s*\{[^}]*height:\s*56px/);
    expect(mobileCss).toMatch(/\.round-button\.notification\s*\{[^}]*min-width:\s*44px/);
    expect(mobileCss).toMatch(/\.profile-shortcut\s*\{[^}]*min-width:\s*44px/);
  });

  test('5. AI Time Assistant widget stacks vertically with >= 16px input font', () => {
    expect(mobileCss).toMatch(/\.ai-input-group,\s*\.ask-ai-input-bar\s*\{[^}]*flex-direction:\s*column/);
    expect(mobileCss).toMatch(/#aiAskInput[^{]*\{[^}]*height:\s*48px/);
    expect(mobileCss).toMatch(/#aiAskInput[^{]*\{[^}]*font-size:\s*16px/);
    expect(mobileCss).toMatch(/#aiAskBtn[^{]*\{[^}]*min-height:\s*46px/);
  });

  test('6. Native file input overlay pattern is preserved for upload reliability', () => {
    expect(mobileCss).toMatch(/\.dropzone\s+input\[type="file"\][^{]*\{[^}]*opacity:\s*0/);
    expect(mobileCss).toMatch(/\.dropzone\s+input\[type="file"\][^{]*\{[^}]*position:\s*absolute/);
  });

  test('7. Cache-busting version tags present in index.html for stylesheets', () => {
    expect(indexHtml).toMatch(/mobile\.css\?v=/);
    expect(indexHtml).toMatch(/enhancements\.css\?v=/);
  });
});
