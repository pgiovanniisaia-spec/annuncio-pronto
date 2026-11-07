// Disegna il logo SVG nelle varie dimensioni con Chromium headless.
// uso: node render-logo.js <cartella progetto> <cartella anteprime>
const { chromium } = require('playwright');
const fs = require('fs');
const [, , ROOT, OUT] = process.argv;
const mark = fs.readFileSync(ROOT + '/assets/logo-mark.svg', 'utf8');
const markInner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const BG = '#E8F3EC';
// scale = quanto è grande il simbolo rispetto alla tela
const svg = ({ bg, scale, radius }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${bg ? `<rect width="1024" height="1024" rx="${radius || 0}" fill="${bg}"/>` : ''}
  <g transform="translate(${512 - 512 * scale} ${512 - 512 * scale}) scale(${scale})">${markInner}</g></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  const shot = async (s, file) => {
    await p.setContent(`<html><body style="margin:0;background:transparent">${s}</body></html>`);
    await p.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  };
  // icona completa (Play/legacy): sfondo verde chiaro pieno
  await shot(svg({ bg: BG, scale: 0.78 }), ROOT + '/assets/icon.png');
  // icona adattiva: primo piano entro la zona sicura (66% centrale), sfondo a parte
  // capacitor-assets inserisce il primo piano con un margine del 16,7% per lato (resta il 66% centrale):
  // qui il simbolo può quindi riempire quasi tutta la tela restando nella zona sicura di Android.
  await shot(svg({ scale: 0.95 }), ROOT + '/assets/icon-foreground.png');
  await shot(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${BG}"/></svg>`, ROOT + '/assets/icon-background.png');
  // logo per l'app (riquadro arrotondato) in SVG
  fs.writeFileSync(ROOT + '/www/logo.svg', svg({ bg: BG, scale: 0.78, radius: 230 }).replace(' width="1024" height="1024"', ''));
  // anteprima: icona finale ritagliata a cerchio come fa Android (simbolo al 95% del 66% centrale = ~62%)
  await shot(`<div style="width:1024px;height:1024px;border-radius:50%;overflow:hidden">${svg({ bg: BG, scale: 0.62 })}</div>`, OUT + '/icon-round-preview.png');
  await b.close();
})();
