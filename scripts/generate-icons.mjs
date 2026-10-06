// Renders build/icon.svg into every icon the apps need.
//
// Desktop (electron-builder):   build/icon.png, build/icon.ico, build/icon.icns
// Mobile source art (used by `npm run icons:mobile` / @capacitor/assets):
//   assets/icon-only.png        full-bleed square (iOS, legacy Android)
//   assets/icon-foreground.png  glyph only, shrunk into the adaptive-icon safe zone
//   assets/icon-background.png  gradient only
//   assets/splash.png, assets/splash-dark.png
//
// Usage: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import png2icons from 'png2icons';
import sharp from 'sharp';

mkdirSync('build', { recursive: true });
mkdirSync('assets', { recursive: true });

const source = readFileSync('build/icon.svg', 'utf8');
const part = (re, name) => {
  const match = source.match(re);
  if (!match) throw new Error(`build/icon.svg is missing ${name}`);
  return match[1];
};
const defs = part(/<defs>([\s\S]*?)<\/defs>/, '<defs>');
const plate = part(/<g id="plate">([\s\S]*?)<\/g>/, 'the "plate" group');
const glyph = part(/<g id="glyph">([\s\S]*?)<\/g>/, 'the "glyph" group');

const fullBleedPlate = plate.replaceAll('x="64" y="64" width="896" height="896" rx="210"', 'x="0" y="0" width="1024" height="1024" rx="0"');
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>${defs}</defs>${body}</svg>`;

const render = (markup, size = 1024) =>
  sharp(Buffer.from(markup), { density: 384 }).resize(size, size).png().toBuffer();

// ------------------------------------------------------------------ desktop
const desktop = await render(source);
writeFileSync('build/icon.png', desktop);

const ico = png2icons.createICO(desktop, png2icons.BICUBIC2, 0, false, true);
const icns = png2icons.createICNS(desktop, png2icons.BICUBIC2, 0);
if (!ico || !icns) throw new Error('Icon conversion failed');
writeFileSync('build/icon.ico', ico);
writeFileSync('build/icon.icns', icns);

// ------------------------------------------------------------------- mobile
writeFileSync('assets/icon-only.png', await render(svg(fullBleedPlate + `<g id="glyph">${glyph}</g>`)));
// Adaptive icons are masked to a circle/squircle, so keep the glyph inside the central safe zone.
writeFileSync(
  'assets/icon-foreground.png',
  await render(svg(`<g transform="translate(512 512) scale(0.86) translate(-512 -512)">${glyph}</g>`))
);
writeFileSync('assets/icon-background.png', await render(svg(fullBleedPlate)));

const splashBackground = '#1e1f22';
const logo = await sharp(desktop).resize(520, 520).toBuffer();
const splash = await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: splashBackground }
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toBuffer();
writeFileSync('assets/splash.png', splash);
writeFileSync('assets/splash-dark.png', splash);

console.log('Generated desktop icons in build/ and mobile source art in assets/');
