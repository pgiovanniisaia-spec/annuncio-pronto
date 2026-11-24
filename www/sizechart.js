// Scheda misure: disegna sul telefono (senza AI, gratis) un'immagine 3:4 con la sagoma del capo,
// le frecce delle misure e i numeri in cm. LLSizeChart.make({measures:{shoulders,pit,length,sleeve}, title}) → Blob JPEG.
(function () {
  "use strict";
  const W = 1536, H = 2048, INK = "#23584A", BG = "#E8F3EC", BODY = "#FFFFFF", LINE = "#9DB8AC";

  // sagoma del cappotto (punti del contorno, in senso orario partendo dal collo)
  const COAT = [[700, 360], [836, 360], [1056, 420], [1262, 1220], [1150, 1252], [1010, 650], [1092, 1660], [444, 1660], [526, 650], [386, 1252], [274, 1220], [480, 420]];

  function arrow(x, a, b, c, d) {
    const ang = Math.atan2(d - b, c - a), L = 34;
    x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke();
    [[a, b, ang], [c, d, ang + Math.PI]].forEach(([px, py, t]) => {
      x.beginPath();
      x.moveTo(px, py); x.lineTo(px + L * Math.cos(t - 0.45), py + L * Math.sin(t - 0.45));
      x.moveTo(px, py); x.lineTo(px + L * Math.cos(t + 0.45), py + L * Math.sin(t + 0.45));
      x.stroke();
    });
  }
  function pill(x, text, cx, cy) {
    x.font = "700 58px system-ui, -apple-system, Roboto, sans-serif";
    const w = x.measureText(text).width + 56, h = 92;
    x.fillStyle = INK; x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, 46); x.fill();
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, cx, cy + 3);
  }
  const fmt = v => String(v).replace(".", ",") + " cm";

  async function make(o) {
    const m = (o && o.measures) || {};
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = BG; x.fillRect(0, 0, W, H);

    // titolo
    x.fillStyle = INK; x.textAlign = "center"; x.textBaseline = "alphabetic";
    x.font = "800 92px system-ui, -apple-system, Roboto, sans-serif"; x.fillText("Misure", W / 2, 170);
    x.font = "500 46px system-ui, -apple-system, Roboto, sans-serif"; x.fillStyle = "#4E6E62";
    x.fillText("in cm, misurate a capo steso", W / 2, 240);

    // sagoma
    x.beginPath(); COAT.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath();
    x.fillStyle = BODY; x.fill(); x.lineWidth = 8; x.strokeStyle = LINE; x.lineJoin = "round"; x.stroke();
    // collo, abbottonatura, bottoni
    x.beginPath(); x.moveTo(700, 360); x.lineTo(768, 520); x.lineTo(836, 360); x.stroke();
    x.beginPath(); x.moveTo(768, 520); x.lineTo(768, 1660); x.lineWidth = 5; x.stroke();
    x.fillStyle = LINE; [700, 880, 1060, 1240].forEach(y => { x.beginPath(); x.arc(810, y, 14, 0, 7); x.fill(); });

    // frecce
    x.strokeStyle = INK; x.lineWidth = 9; x.lineCap = "round";
    if (m.shoulders) { arrow(x, 486, 330, 1050, 330); pill(x, "Spalle " + fmt(m.shoulders), W / 2, 330 - 2); }
    if (m.pit) { arrow(x, 540, 700, 996, 700); pill(x, "Ascella-ascella " + fmt(m.pit), W / 2, 800); }
    if (m.length) { arrow(x, 600, 470, 600, 1650); pill(x, "Lunghezza " + fmt(m.length), 600, 1300); }
    if (m.sleeve) {
      arrow(x, 1090, 412, 1290, 1200);
      x.save(); x.translate(1200, 840); x.rotate(Math.atan2(788, 200) - Math.PI / 2);
      pill(x, "Manica " + fmt(m.sleeve), 0, 0); x.restore();
    }

    // riepilogo in basso
    const rows = [["Spalle", m.shoulders], ["Ascella-ascella", m.pit], ["Lunghezza", m.length], ["Manica", m.sleeve]].filter(r => r[1]);
    x.font = "600 54px system-ui, -apple-system, Roboto, sans-serif"; x.fillStyle = INK; x.textAlign = "center";
    x.fillText(rows.map(r => r[0] + " " + fmt(r[1])).join("   ·   "), W / 2, 1810, W - 120);
    if (o && o.title) { x.font = "500 40px system-ui, -apple-system, Roboto, sans-serif"; x.fillStyle = "#4E6E62"; x.fillText(String(o.title).slice(0, 60), W / 2, 1900, W - 120); }

    return await new Promise(res => c.toBlob(res, "image/jpeg", 0.95));
  }
  window.LLSizeChart = { make };
})();
