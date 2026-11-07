// Ritocchi al progetto android/ generato da "npx cap add android".
// Si può eseguire più volte. Uso: node scripts/android-setup.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

const res = "android/app/src/main/res";
if (!existsSync(res)) { console.error("Cartella android/ assente: esegui prima npx cap add android"); process.exit(1); }
const config = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "\\'");

// Colori della barra di stato e di navigazione: verde salvia chiaro, verde molto scuro col tema scuro.
const BAR_LIGHT = "#E8F3EC", BAR_DARK = "#0E1A14";

// 1) Nome sotto l'icona (strings.xml) = appName di capacitor.config.json
const stringsPath = `${res}/values/strings.xml`;
if (existsSync(stringsPath)) {
  let st = readFileSync(stringsPath, "utf8");
  for (const key of ["app_name", "title_activity_main"]) {
    st = st.replace(new RegExp(`(<string name="${key}">)[^<]*(</string>)`), `$1${xmlEsc(config.appName)}$2`);
  }
  writeFileSync(stringsPath, st);
  console.log(`Nome dell'app: ${config.appName}`);
}

// 2) Colori (chiaro e scuro)
const colors = (bar, light) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="listlab_bar">${bar}</color>
    <bool name="listlab_light_bars">${light}</bool>
</resources>
`;
writeFileSync(`${res}/values/listlab_colors.xml`, colors(BAR_LIGHT, "true"));
mkdirSync(`${res}/values-night`, { recursive: true });
writeFileSync(`${res}/values-night/listlab_colors.xml`, colors(BAR_DARK, "false"));

// 3) Splash di sistema (Android 12+): sfondo bianco e logo ridimensionato, così il cerchio
//    di Android non lo taglia. Tema dell'app: barre di sistema nel verde dell'app.
mkdirSync(`${res}/drawable-nodpi`, { recursive: true });
copyFileSync("assets/android/splash_icon.png", `${res}/drawable-nodpi/splash_icon.png`);

const stylesPath = `${res}/values/styles.xml`;
let styles = readFileSync(stylesPath, "utf8");
const replaceStyle = (name, body) => {
  const re = new RegExp(`<style name="${name.replace(/\./g, "\\.")}"[\\s\\S]*?<\\/style>`);
  if (!re.test(styles)) { console.error(`Stile ${name} non trovato in styles.xml`); process.exit(1); }
  styles = styles.replace(re, body);
};
replaceStyle("AppTheme.NoActionBar", `<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/listlab_bar</item>
        <item name="android:statusBarColor">@color/listlab_bar</item>
        <item name="android:navigationBarColor">@color/listlab_bar</item>
        <item name="android:windowLightStatusBar">@bool/listlab_light_bars</item>
        <item name="android:windowLightNavigationBar">@bool/listlab_light_bars</item>
    </style>`);
replaceStyle("AppTheme.NoActionBarLaunch", `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">#FFFFFF</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`);
writeFileSync(stylesPath, styles);
console.log("Splash Android 12+ e colori delle barre di sistema configurati.");
