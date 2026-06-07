import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appGradle = path.join(root, 'android/app/build.gradle');
const manifest = path.join(root, 'android/app/src/main/AndroidManifest.xml');

function patchFile(file, patcher) {
  const before = fs.readFileSync(file, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(file, after);
}

patchFile(appGradle, (text) => {
  let out = text;

  if (!out.includes("dirs 'libAars'")) {
    out = out.replace(
      /repositories\s*\{\s*flatDir\s*\{\s*dirs ([^\n]+)\n\s*\}\s*\}/,
      (match, dirs) => match.replace(dirs, `${dirs.trim()}, 'libAars'`)
    );
  }

  if (!out.includes("dir: 'libAars'")) {
    out = out.replace(
      /dependencies\s*\{/,
      "dependencies {\n    implementation fileTree(include: ['*.jar', '*.aar'], dir: 'libAars')\n    implementation 'androidx.multidex:multidex:2.0.1'"
    );
  }

  if (!out.includes('multiDexEnabled true')) {
    out = out.replace(
      /defaultConfig\s*\{/,
      "defaultConfig {\n        multiDexEnabled true"
    );
  }

  return out;
});

patchFile(manifest, (text) => {
  let out = text;
  const permissionBlock = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />',
    '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />',
    '    <uses-feature android:name="android.hardware.usb.host" android:required="false" />',
    '',
    '    <queries>',
    '        <intent>',
    '            <action android:name="com.pax.us.std.poslink.aidl" />',
    '        </intent>',
    '    </queries>',
    '',
  ].join('\n');

  if (!out.includes('com.pax.us.std.poslink.aidl')) {
    out = out.replace(/<application\b/, `${permissionBlock}    <application`);
  }

  return out;
});

console.log('POSLink Android build configuration applied.');
