// Ritocchi al progetto android/ generato da "npx cap add android".
// Si può eseguire più volte. Uso: node scripts/android-setup.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

const res = "android/app/src/main/res";
if (!existsSync(res)) { console.error("Cartella android/ assente: esegui prima npx cap add android"); process.exit(1); }

// 1) Splash di sistema (Android 12+): sfondo bianco e logo ridimensionato,
//    così il cerchio di Android non lo taglia.
mkdirSync(`${res}/drawable-nodpi`, { recursive: true });
copyFileSync("assets/android/splash_icon.png", `${res}/drawable-nodpi/splash_icon.png`);

const stylesPath = `${res}/values/styles.xml`;
let styles = readFileSync(stylesPath, "utf8");
const launch = `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">#FFFFFF</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`;
const re = /<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/;
if (!re.test(styles)) { console.error("Stile AppTheme.NoActionBarLaunch non trovato in styles.xml"); process.exit(1); }
styles = styles.replace(re, launch);
writeFileSync(stylesPath, styles);
console.log("Splash Android 12+: sfondo bianco e icona configurati.");
