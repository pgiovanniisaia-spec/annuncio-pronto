// Icona della splash di Android 12+: tela 1152px trasparente, logo arrotondato 600px al centro
// (il sistema ritaglia un cerchio di diametro 2/3 della tela: 768px).
const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = process.argv[2];
(async () => {
  const logo = fs.readFileSync(ROOT + '/www/logo.svg', 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1152, height: 1152 } });
  await p.setContent(`<html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;width:1152px;height:1152px">
    <div style="width:600px;height:600px">${logo.replace('<svg ', '<svg width="600" height="600" ')}</div></body></html>`);
  await p.screenshot({ path: ROOT + '/assets/android/splash_icon.png', omitBackground: true });
  await b.close();
})();
