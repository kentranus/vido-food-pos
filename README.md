# Vido Food

**Modern restaurant POS for boba/coffee/fast food shops.**
Yellow-orange Food branding · Dark mode default · Web + Android APK from one codebase.

> **One app, two modes.** POS and Kiosk are now the **same app** (`com.vido.food`).
> Every tablet installs the identical APK; each device is set to run as a **POS
> terminal** or a customer **Kiosk** from **Settings → Device Mode** (saved
> per-device). No separate kiosk build. See [Device Mode](#device-mode-pos--kiosk).

## Features

### Selling
- 🛒 Multi-order tabs (handle 3+ orders simultaneously)
- 🍔 Customize items: size, sugar %, ice %, toppings
- 🏠 Order types: Dine In / To Go / Delivery
- 🏷️ Discount ($ or %, manager PIN required)
- 📝 Order notes
- 🔍 Search menu items

### Payments
- 💵 **Cash** with quick amounts + change calculator
- 💳 **Card Payment** (BroadPOS TCP, port 10009)
- 🎁 **Gift Card** (mark as paid)
- ✨ Customer chooses tip on the card terminal

### Reports
- 📅 Date range filter (Today / Week / Month / Custom)
- 💰 Stats: Sales, Tips, Orders, AOV, Tax
- 📊 Hourly sales chart
- 🥧 Payment method donut
- 🏆 Top sellers
- 📤 **Export CSV** for accounting

### Menu Management
- Add/Edit/Delete items + categories
- Mark items "Sold Out" temporarily
- Image URL or emoji+gradient
- Reset to defaults

### Staff & Security
- 🔐 PIN-based login (4-digit)
- 👤 Roles: Manager / Cashier
- 🔒 Manager-only: discounts, payment settings, Staff management
- Default: Manager `1234` / Cashier `0000`

### System
- 🌑 Dark mode default + ☀️ Light mode toggle
- 💾 Persistent storage (orders, menu, settings)
- 📊 Order history with search
- 🧾 POS Hub for kiosk/online orders, shared order numbers, and auto kitchen ticket print
- 🌐 **Web preview** for debugging (open DevTools F12)
- ℹ️ About page with version + build info

## Brand

- **Primary**: `#F59E0B` (Food yellow)
- **Accent**: `#FBBF24` (lighter yellow)
- **Logo**: White **F** on yellow-orange gradient

## Quick Start

### 1. Create GitHub repo
1. [github.com/new](https://github.com/new)
2. Name: `vido-food`
3. **Public** (required for free GitHub Pages)
4. Don't add README
5. Create

### 2. Upload code
Use [GitHub Desktop](https://desktop.github.com) — handles hidden `.github` folder.

1. **File → Add Local Repository** → select `vido-pos-final` folder
2. **Publish repository**

### 3. Enable GitHub Pages
1. Repo → **Settings → Pages**
2. Source: **GitHub Actions**
3. Save

### 4. Wait for build (~5-10 min)
Tab **Actions** → workflow runs automatically, 3 jobs in parallel:
- ✅ Build web bundle
- ✅ Deploy to GitHub Pages → `https://USERNAME.github.io/vido-food/`
- ✅ Build APK → Artifacts

### 5. Use it
- **Web preview**: open the GitHub Pages URL on any browser → see all errors in DevTools
- **Tablet APK**: Actions → latest run → download `vido-food-apk-build-N`

### 6. Payment Terminal Setup
1. Open Vantiv/BroadPOS on the card terminal → note the IP
2. Vido Food → **Settings → Payment Settings** (Manager PIN required)
3. Enter IP, port `10009`
4. **Test Connection** → should say Connected

### 7. Kiosk / Online Order Hub
Use this when kiosks or the online ordering website run on separate devices.

1. On the POS/hub computer, run:
   ```bash
   cd pos-hub
   npm start
   ```
2. POS app → **Settings → Kiosk / Online**
3. Enable POS Hub and set URL to the hub IP, for example:
   `http://192.168.68.55:8787`
4. Use the same Store ID on POS and all kiosks.
5. Each kiosk sets its own **Settings → Payment Settings** for its own PAX terminal.

Flow:
Kiosk → kiosk PAX terminal approves payment → POS Hub assigns the shared order number → POS Operations receives it → POS prints the kitchen/drink ticket.

## Device Mode (POS / Kiosk)

POS and Kiosk are the **same app** — the mode is a per-device runtime setting,
not a separate build. A brand-new install defaults to **POS**.

**Make a device a Kiosk**
1. Sign in as Manager → **Menu → Device Mode** (or Settings → Device Mode).
2. Tap **Switch this device to Kiosk mode** → confirm.
3. The screen locks into the full-screen customer self-order view (no sign-in).
   The chosen mode is saved on the device and survives restarts.

**Turn a Kiosk back into a POS** (intentionally hidden from customers)
1. Tap the **top-left corner 5 times** within 3 seconds.
2. Enter the **Manager PIN** → the kiosk settings open.
3. Under **Device mode**, tap **Switch to POS mode** → confirm.
   The device drops back to the POS Manager sign-in.

> Technically: the mode lives in storage key `vido_device_mode`
> (`src/services/modeStorage.js`). `VITE_APP_MODE` in `.env.production` only sets
> the *initial* default for a fresh install.

## Staff identity & activity audit

- **Sign-in identity.** After entering a PIN, the signed-in staff is shown in the
  top bar as a compact pill — profile picture (or auto initials, manager gets the
  brand gradient), name, and role.
- **Profile pictures.** Settings → Staff → edit a member → **Profile picture**:
  upload a photo or type an emoji. Blank = auto initials.
- **Activity audit log.** Every staff action is recorded per-device so the owner
  can review/control later, in **Reports**:
  - **Staff Performance** — per-staff: orders, net sales, tips, # discounts, # voids/refunds, sign-ins.
  - **Staff Activity Log** — chronological feed: sign-in/out, sales, discounts,
    voids, refunds, device-mode changes — with who, what, and when.
  - Filtered by the same date range as the rest of Reports. Stored in
    `vido_activity` (`src/services/activityStorage.js`), capped at 5k entries.

## Branding

The Vido Food icon (`tablet-app/src/assets/brand-icon.png`) is used for the PIN
screen, top bar, kiosk header, and About page. The web favicon points at
`public/brand-icon.png`. The Android launcher icon + splash are generated from
`resources/logo.png` during CI (`@capacitor/assets`). The PIN screen uses a
**Liquid Glass** treatment (frosted card, floating color blobs, glass keypad).

## Default Credentials

| Role     | PIN  |
|----------|------|
| Manager  | 1234 |
| Cashier  | 0000 |

**Change these in Settings → Staff after first sign in.**

## First-time setup for a NEW shop

When installing this app for a new customer/shop:

1. **Install APK** on the tablet
2. Sign in with Manager PIN (default `1234`)
3. **Settings → Shop Info** — Configure for this specific shop:
   - Shop name, branch, address, phone
   - Tax rate (e.g., 8.75%)
   - Currency symbol
   - Tip percentages
   - Receipt footer
4. **Settings → Menu Editor** — Customize menu for this shop
5. **Settings → Staff** — Change default PINs, add staff
6. **Settings → Payment Settings** — Connect the card terminal by IP
7. Ready to sell!

All settings are saved on-device. Different tablets = different shops.

## Project Structure

```
vido-pos-final/
├── .github/workflows/build.yml      # Builds APK + deploys web
├── README.md
├── pos-hub/                         # Local/cloud order hub for kiosk + online orders
└── tablet-app/
    ├── package.json
    ├── vite.config.js
    ├── capacitor.config.ts
    ├── index.html
    ├── android-config/network_security_config.xml
    ├── android-plugin/              # Custom Java TCP plugin
    └── src/
        ├── main.jsx
        ├── App.jsx                  # Main shell + nav
        ├── theme.js                 # Food yellow theme
        ├── config.js                # Shop info
        ├── version.js               # Build info (auto-injected)
        ├── components/Shared.jsx    # Modal, PIN, Button, Input
        ├── data/defaultMenu.js
        ├── services/
        │   ├── storage.js
        │   ├── menuStorage.js
        │   ├── orderStorage.js
        │   ├── staffStorage.js
        │   ├── paxBridge.js         # TCP + web simulation
        │   └── orderHubService.js   # Kiosk/online order sync
        └── views/
            ├── OrderView.jsx        # Selling (main)
            ├── HistoryView.jsx
            ├── ReportsView.jsx
            └── SettingsView.jsx
```

## Customization

### Change shop info
Edit `tablet-app/src/config.js`:
```js
export const SHOP = {
  name: 'Your Shop',
  branch: 'Branch',
  address: '...',
  tax: 0.0875,  // 8.75%
};
```

### Change brand colors
Edit `tablet-app/src/theme.js` and `tablet-app/index.html` (for splash). Search and replace `#F59E0B` (primary) and `#FBBF24` (accent) with your brand colors.

### Change menu
In-app: **Settings → Menu Editor**. Or edit `tablet-app/src/data/defaultMenu.js`.

## Web vs Native

| Feature | Web preview | Tablet APK |
|---|---|---|
| Sell, cart, customize | ✅ | ✅ |
| Cash, Gift Card | ✅ | ✅ |
| **Card Payment** | 🤖 Simulated | ✅ Real TCP |
| Reports, History | ✅ | ✅ |
| Menu Editor | ✅ | ✅ |
| Storage | localStorage | Capacitor Preferences |

## Built with

- React 18 + Vite 5
- Capacitor 5 (Android)
- Lucide React icons
- Custom Java TCP plugin for BroadPOS

## License

Built for Vido Food · Kenny · 2026
