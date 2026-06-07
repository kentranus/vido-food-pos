# PAX POSLink Card Payment Integration

## Current app status

The tablet app now includes the official PAX POSLink Android SDK files and a native Capacitor plugin wrapper:

- POSLink plugin: `tablet-app/android-plugin/PosLinkPaymentPlugin.java`
- POSLink Android libraries: `tablet-app/android-libs/poslink/`
- Build setup script: `tablet-app/scripts/configure-poslink-android.mjs`
- GitHub Actions integration: `.github/workflows/build.yml`

The app still keeps the custom BroadPOS TCP bridge as a fallback/debug path:

- Frontend service: `tablet-app/src/services/paxBridge.js`
- Native TCP plugin: `tablet-app/android-plugin/TcpSocketPlugin.java`
- Settings screen: `tablet-app/src/views/SettingsView.jsx`, tab label `Payment Settings`

On Android, `Card Payment` now tries the official POSLink SDK first when `Use official POSLink SDK for Card Payment` is enabled.

## Required PAX SDK files

The PDF files are documentation only. To compile the Android app with official POSLink, the developer needs the actual Java/Android POSLink SDK package from the PAX resource portal.

Ask PAX support or download from:

- POSLink resources
- `Java/Android POSLink`

Expected files inside the SDK package:

- One or more Android libraries: `*.aar` or `*.jar`
- Sample Android project or sample Java code
- POSLink integration documentation
- Version notes

The POSLink README confirms the full SDK package should include these folders:

- `libs/android`
- `Sample/android`
- `Guide`
- `Reference/doc_android`

If the full zip is too large to send, unzip it on the Mac and provide only `libs/android` first. That folder should contain the Android library needed by the APK build.

Files that are not enough for Android integration:

- `Full-Integration Implementation Guide_*.pdf`
- `POSLink Integration Setup Guide*.pdf`
- Windows `.dll` packages
- Windows USB driver installers

## Recommended communication type

Use network communication, not USB, for this setup.

Reason: the PAX resource page notes a known Android POSLink USB issue for Java Android SDK `V1.15.00_20240425` with Q20 network behavior. PAX recommends either downgrading to `V1.14.00_20231101` for USB or using network communication types such as TCP, HTTP, HTTPS, or SSL.

Current known network values:

- POS tablet IP: `192.168.68.55`
- PAX terminal IP: `192.168.68.59`
- PAX ECR port: `10009`
- Terminal app: `BroadPOS Vantiv V1.02.28E_20251027`
- ECR communication: Ethernet / TCP-IP

## PAX terminal settings to verify

On the PAX terminal, verify:

- `ECR Comm Settings`
- Ethernet enabled
- Protocol Type: `TCP/IP`
- Host Port: `10009`
- ECR-Terminal Integration Mode: `External POS`
- Dedicated Device Mode: enabled
- BroadPOS/POSLink listening on network
- Sale app is not in demo mode

If the terminal shows "Listen timeout", the POS app connected but did not send the exact request format the terminal expects, or the terminal-side ECR mode/protocol does not match the POS app.

## Android implementation plan

Implemented integration:

1. SDK libraries copied into:

   `tablet-app/android-libs/poslink/`

2. GitHub Actions copies the libraries into the generated Capacitor Android project:

   `.github/workflows/build.yml`

3. Capacitor plugin wrapper:

   `tablet-app/android-plugin/PosLinkPaymentPlugin.java`

4. Plugin registration:

   `tablet-app/android-plugin/MainActivity.java`

5. Current JavaScript/native method:

   - `sale({ amount, host, port, timeout, refNum })`

Future methods to add after live terminal validation:

   - `void({ transactionId })`
   - `refund({ amount, transactionId })`
   - `batchClose()`

6. `tablet-app/src/services/paxBridge.js` uses POSLink SDK on Android and keeps the raw TCP bridge for fallback/debug.

Local verification completed:

- Web build passes with `npm run build`.
- Android project generation and POSLink build configuration script run successfully.
- Local APK build could not be completed on this Mac because Java Runtime is not installed. GitHub Actions installs Java 17 before building.

## POSLink Android API shape from README

The SDK README shows this TCP setup pattern:

```java
CommSetting commSetting = new CommSetting();
commSetting.setType(CommSetting.TCP);
commSetting.setDestIP("192.168.68.59");
commSetting.setDestPort("10009");
commSetting.setTimeOut("60000");
```

Android initialization must happen when the app starts:

```java
POSLinkAndroid.init(application);
```

Then each sale should create a POSLink instance and payment request:

```java
PosLink poslink = new PosLink(context);
poslink.SetCommSetting(commSetting);

PaymentRequest request = new PaymentRequest();
request.TenderType = request.ParseTenderType("CREDIT");
request.TransType = request.ParseTransType("SALE");
request.ECRRefNum = orderId;
request.Amount = amountInCents;

poslink.PaymentRequest = request;
ProcessTransResult result = poslink.ProcessTrans();
```

Important: `ProcessTrans()` is slow and must run on a background thread, not the Android UI thread.

## Minimum sale flow

The POS app should:

1. Cashier selects `Card Payment`.
2. App sends Sale request to POSLink SDK.
3. PAX terminal prompts customer for card/tap/insert/swipe.
4. Terminal returns approved or declined response.
5. App saves:

   - approval status
   - auth code
   - host reference number
   - card type
   - last 4 digits
   - approved amount
   - tip amount
   - raw response for troubleshooting

6. App prints receipt only after approval.

## What to send to the developer

Send the developer:

- This full project folder or latest project zip
- The Java/Android POSLink SDK zip from PAX
- The four PDF guides
- PAX terminal IP, port, and screenshots of ECR settings
- Current error screenshots from `Payment Settings > Test Sale`

Without the actual Java/Android POSLink SDK library (`.aar` or `.jar`), the developer cannot complete the official SDK integration.
