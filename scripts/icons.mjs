// Render public/icon.svg to the PNG sizes a PWA needs. Uses Playwright's Chromium (PW_CHROMIUM may point at a local build).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
// Apple and maskable icons are full-bleed squares: iOS paints transparent corners black, and launchers crop maskable icons.
for (const [name, size, pad, bleed] of [
  ['icon-192.png', 192, 0, false],
  ['icon-512.png', 512, 0, false],
  ['icon-maskable-512.png', 512, 0, true],
  ['apple-touch-icon.png', 180, 0, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style><div style="width:${size}px;height:${size}px;padding:${pad}px">${(bleed ? svg.replace('rx="112"', 'rx="0"') : svg).replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`,
  );
  await page.screenshot({
    path: new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    omitBackground: true,
  });
}
await browser.close();
console.log('icons written');
