/**
 * Turns the launcher-icon art in `assets/app-icons/` into everything the two
 * platforms and the admin panel read, and wires the list into the native
 * projects:
 *
 *   Android  mipmap-<density>/ic_launcher_<key>_background.webp — the art,
 *              as the background layer of an adaptive icon (see below)
 *            mipmap-anydpi-v26/ic_launcher_<key>.xml — one per icon, plus
 *              ic_launcher(.xml|_round.xml) for the default, which is what
 *              <application> and every library that asks for "the app
 *              icon" read
 *            mipmap-<density>/ic_launcher_monochrome.png — the V alone, for
 *              Android 13's themed icons
 *            drawable-<density>/ic_notification.png — the white V the
 *              status bar draws
 *            AndroidManifest.xml — one <activity-alias> per icon, between
 *              the app-icons markers
 *   iOS      Images.xcassets/AppIcon.appiconset — the default, one 1024 px
 *              opaque square (Xcode draws every other size from it)
 *            Images.xcassets/AppIcon-<key>.appiconset — each alternate
 *            project.pbxproj — ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES
 *   Panel    vokve-crm/public/app-icons/<key>-(square|circle).webp
 *   Store    assets/app-icons/store/google-play-512.png
 *
 * Run it after adding or changing art: `npm run icons:app`. Then add the
 * key to the backend's catalog (`src/modules/devices/appIcons.ts`),
 * and ship a build — an icon has to be inside the app to be shown, so the
 * server can only choose among the ones a build carries.
 *
 * Why the art is the *background* of the adaptive icon. Android 8+ (and
 * this app starts at 8) never draws a square or a round PNG: it takes a
 * 108 dp two-layer icon and cuts it with the launcher's own mask — a circle
 * on a Pixel, a squircle on a Samsung — showing the middle 72 dp. The art
 * is flat, with no separate layers, so the whole square is put in that
 * middle 72 dp and the 18 dp border around it is the art mirrored, which a
 * mask only reveals during the launcher's parallax. Every festive Circle
 * file is the Square file cut by a circle, pixel for pixel, so a circle
 * launcher shows exactly the Circle art and a square one the Square art.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const art = path.join(root, 'assets/app-icons');
const res = path.join(root, 'android/app/src/main/res');
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
const catalogDir = path.join(root, 'ios/vokve/Images.xcassets');
const pbxprojPath = path.join(root, 'ios/vokve.xcodeproj/project.pbxproj');
const infoPlistPath = path.join(root, 'ios/vokve/Info.plist');
const panel = path.join(root, 'vokve-crm/public/app-icons');

/**
 * sharp comes with the admin panel's install (Next.js depends on it), so the
 * app does not carry a native image library for a script run a few times a
 * year. Either install will do.
 */
function loadSharp() {
  for (const from of [root, path.join(root, 'vokve-crm')]) {
    try {
      return createRequire(path.join(from, 'package.json'))('sharp');
    } catch {
      // try the next one
    }
  }
  throw new Error('sharp is not installed. Run `npm install` in vokve-crm (or add sharp to this app) and try again.');
}
const sharp = loadSharp();

const catalog = JSON.parse(readFileSync(path.join(art, 'catalog.json'), 'utf8'));
const icons = catalog.icons;
const DEFAULT = catalog.default;
if (!icons.some(icon => icon.key === DEFAULT)) throw new Error(`catalog.default '${DEFAULT}' is not an icon`);
for (const icon of icons) {
  if (!/^[a-z][a-z0-9]*$/.test(icon.key)) {
    throw new Error(`'${icon.key}': a key is lower-case letters and digits — it becomes an Android resource name and an iOS asset name`);
  }
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const square = icon => path.join(art, `${icon.art}_Square_1024.png`);
const circle = icon => path.join(art, `${icon.art}_Circle_1024.png`);
const aliasName = icon => `.AppIcon${icon.key[0].toUpperCase()}${icon.key.slice(1)}`;
const iosName = icon => (icon.key === DEFAULT ? 'AppIcon' : `AppIcon-${icon.key}`);

function fresh(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Android ────────────────────────────────────────────────────────────────

/** The art in the middle 72 dp of a 108 dp layer, the border mirrored out of it. */
async function backgroundLayer(file, scale) {
  const viewport = Math.round(72 * scale);
  const layer = Math.round(108 * scale);
  const margin = Math.floor((layer - viewport) / 2);
  return sharp(await sharp(file).resize(viewport, viewport, { kernel: 'lanczos3' }).toBuffer())
    .extend({ top: margin, left: margin, bottom: layer - viewport - margin, right: layer - viewport - margin, extendWith: 'mirror' })
    .webp({ quality: 92, effort: 6 })
    .toBuffer();
}

/**
 * The V on its own, white on transparent, from the red-field art: the field
 * is (230, 0, 0) and the V is white, so the green channel *is* the V's
 * coverage, antialiased edges included.
 */
async function vMask() {
  const redfield = icons.find(icon => icon.key === 'redfield');
  const { data, info } = await sharp(square(redfield)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
    out[j] = 255;
    out[j + 1] = 255;
    out[j + 2] = 255;
    out[j + 3] = data[i + 1];
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function monochromeLayer(mask, scale) {
  const viewport = Math.round(72 * scale);
  const layer = Math.round(108 * scale);
  const margin = Math.floor((layer - viewport) / 2);
  return sharp(await sharp(mask).resize(viewport, viewport, { kernel: 'lanczos3' }).toBuffer())
    .extend({ top: margin, left: margin, bottom: layer - viewport - margin, right: layer - viewport - margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The box the V's opaque pixels occupy, so the status-bar glyph is the V and no margin. */
async function opaqueBox(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] < 128) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** 24 dp, the V fitted inside the middle 20 dp as the status-bar icon guidance asks. */
async function notificationIcon(mask, scale) {
  const size = Math.round(24 * scale);
  const inner = Math.round(20 * scale);
  const glyph = await sharp(mask)
    .extract(await opaqueBox(mask))
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const pad = Math.floor((size - inner) / 2);
  return sharp(glyph)
    .extend({ top: pad, left: pad, bottom: size - inner - pad, right: size - inner - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const adaptiveXml = background => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/write-app-icons.mjs from assets/app-icons — edit the art, not this. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/${background}" />
    <foreground android:drawable="@android:color/transparent" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

function aliasesXml() {
  const lines = [
    '      <!-- app-icons:start — written by scripts/write-app-icons.mjs; edit assets/app-icons/catalog.json, not this. -->',
  ];
  for (const icon of icons) {
    const isDefault = icon.key === DEFAULT;
    const mipmap = isDefault ? 'ic_launcher' : `ic_launcher_${icon.key}`;
    lines.push(
      `      <activity-alias`,
      `        android:name="${aliasName(icon)}"`,
      `        android:targetActivity=".MainActivity"`,
      `        android:label="@string/app_name"`,
      `        android:icon="@mipmap/${mipmap}"`,
      `        android:roundIcon="@mipmap/${isDefault ? 'ic_launcher_round' : mipmap}"`,
      `        android:enabled="${isDefault}"`,
      `        android:exported="true">`,
      `        <intent-filter>`,
      `          <action android:name="android.intent.action.MAIN" />`,
      `          <category android:name="android.intent.category.LAUNCHER" />`,
      `        </intent-filter>`,
      `        <meta-data android:name="com.vokve.appicon.KEY" android:value="${icon.key}" />`,
      `      </activity-alias>`,
    );
  }
  lines.push('      <!-- app-icons:end -->');
  return lines.join('\n');
}

async function writeAndroid() {
  const mask = await vMask();
  const stale = ['ic_launcher.png', 'ic_launcher_round.png'];
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const mipmap = fresh(path.join(res, `mipmap-${density}`));
    // React Native's template robot. Android 8+ never draws a density PNG
    // when an adaptive icon of the same name exists, and this app starts at 8.
    for (const name of stale) rmSync(path.join(mipmap, name), { force: true });
    for (const icon of icons) {
      writeFileSync(path.join(mipmap, `ic_launcher_${icon.key}_background.webp`), await backgroundLayer(square(icon), scale));
    }
    writeFileSync(path.join(mipmap, 'ic_launcher_monochrome.png'), await monochromeLayer(mask, scale));
    const drawable = fresh(path.join(res, `drawable-${density}`));
    writeFileSync(path.join(drawable, 'ic_notification.png'), await notificationIcon(mask, scale));
  }

  const anydpi = fresh(path.join(res, 'mipmap-anydpi-v26'));
  for (const icon of icons) {
    if (icon.key === DEFAULT) continue;
    writeFileSync(path.join(anydpi, `ic_launcher_${icon.key}.xml`), adaptiveXml(`ic_launcher_${icon.key}_background`));
  }
  writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptiveXml(`ic_launcher_${DEFAULT}_background`));
  writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptiveXml(`ic_launcher_${DEFAULT}_background`));

  const manifest = readFileSync(manifestPath, 'utf8');
  const block = /[ \t]*<!-- app-icons:start[\s\S]*?<!-- app-icons:end -->/;
  if (!block.test(manifest)) throw new Error('AndroidManifest.xml has no app-icons:start/end markers to write the aliases between');
  writeFileSync(manifestPath, manifest.replace(block, aliasesXml()));
}

// ─── iOS ────────────────────────────────────────────────────────────────────

const appIconContents = file => `${JSON.stringify(
  {
    images: [{ filename: file, idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  },
  null,
  2,
)}\n`;

async function writeIos() {
  for (const icon of icons) {
    const set = fresh(path.join(catalogDir, `${iosName(icon)}.appiconset`));
    const file = `${iosName(icon)}.png`;
    // The App Store refuses an icon with an alpha channel, even a fully opaque one.
    await sharp(square(icon)).flatten({ background: '#ffffff' }).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(set, file));
    writeFileSync(path.join(set, 'Contents.json'), appIconContents(file));
  }

  const alternates = icons.filter(icon => icon.key !== DEFAULT).map(iosName).join(' ');
  const setting = `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "${alternates}";`;
  let pbxproj = readFileSync(pbxprojPath, 'utf8');
  pbxproj = pbxproj.replace(/^\s*ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = .*;\n/gm, '');
  pbxproj = pbxproj.replace(/^(\s*)ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n/gm, (line, indent) => `${line}${indent}${setting}\n`);
  writeFileSync(pbxprojPath, pbxproj);

  const plist = readFileSync(infoPlistPath, 'utf8');
  if (!plist.includes(`<key>VokveAppIconDefault</key>\n\t<string>${DEFAULT}</string>`)) {
    throw new Error(`Info.plist must carry <key>VokveAppIconDefault</key> <string>${DEFAULT}</string> — the iOS module reads which key the primary icon is from it`);
  }
}

// ─── The admin panel's previews, and the store ─────────────────────────────

async function writePanelAndStore() {
  fresh(panel);
  for (const icon of icons) {
    await sharp(square(icon)).resize(256, 256).webp({ quality: 88 }).toFile(path.join(panel, `${icon.key}-square.webp`));
    await sharp(circle(icon)).resize(256, 256).webp({ quality: 88 }).toFile(path.join(panel, `${icon.key}-circle.webp`));
  }
  const store = fresh(path.join(art, 'store'));
  const fallback = icons.find(icon => icon.key === DEFAULT);
  await sharp(square(fallback)).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(store, 'google-play-512.png'));
}

for (const icon of icons) {
  for (const file of [square(icon), circle(icon)]) {
    if (!existsSync(file)) throw new Error(`Missing art: ${path.relative(root, file)}`);
  }
}
await writeAndroid();
await writeIos();
await writePanelAndStore();
console.log(`Wrote ${icons.length} icons (default ${DEFAULT}) for Android, iOS, the panel and the store.`);
