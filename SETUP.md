# VibeMeter — Setup Guide for a Friend

> This guide assumes you are **not a developer**. Every step is explained in plain English. Follow each part in order and you'll have the app running on your iPhone.

---

## Before You Start — Checklist

Make sure you have all of these before beginning:

- [ ] A **Mac** (MacBook or iMac) running macOS 13 Ventura or newer
- [ ] An **iPhone** running iOS 16 or newer
- [ ] The **USB cable** that came with your iPhone (needed for first install only)
- [ ] An **Apple ID** — the free one you use for the App Store
- [ ] At least **15 GB of free disk space** on your Mac (Xcode is large)
- [ ] An **internet connection** on your iPhone (the app talks to a cloud server — no local setup required)

---

## Part 1 — Open the Terminal App

Almost everything in this guide is done by typing commands in the Terminal — a text-based window that lets you control your Mac.

**How to open it:**
1. Press **Cmd + Space** on your keyboard
2. Type `Terminal`
3. Press **Enter**

A black or white window will open with a blinking cursor. This is where you will type commands.

> **Tip:** When you see a command in a grey box like `this`, click the box to highlight it, then copy and paste it into Terminal. Press Enter after each command to run it.

---

## Part 2 — Install Homebrew (the Mac Tool Installer)

**What it is:** Homebrew is a free program that makes it easy to install developer tools on a Mac. Think of it as a special App Store for developer software — one command and it installs what you need.

**Why it's needed:** We'll use it to install Git and Node.js in the next steps.

**How to install:**

1. In Terminal, paste this command and press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. It will ask for your **Mac login password**. Type it and press Enter.
   - Nothing appears on screen while you type — this is normal and intentional for security.
3. It may ask you to press Enter a second time to confirm.
4. Wait for it to finish (2–5 minutes).

**Verify it worked:**

```
brew --version
```

You should see something like `Homebrew 4.x.x`. If you do, move to the next step.

---

## Part 3 — Install Git

**What it is:** Git is a tool for downloading code from the internet. When a project is stored on GitHub, Git is how you "clone" (download) it to your Mac.

**Why it's needed:** We need it to download the VibeMeter project code.

**Install it:**

```
brew install git
```

**Verify it worked:**

```
git --version
```

You should see something like `git version 2.x.x`.

---

## Part 4 — Install Node.js

**What it is:** Node.js is a JavaScript runtime. The VibeMeter mobile app is built with a tool called Expo, which uses Node.js to package the app code and install it on your iPhone.

**Why it's needed:** Required to run the Expo build tool and install the app's JavaScript dependencies.

**Install it:**

```
brew install node
```

**Verify it worked:**

```
node --version
npm --version
```

Both should show version numbers (e.g. `v20.x.x` and `10.x.x`).

---

## Part 5 — Install Xcode

**What it is:** Xcode is Apple's official app for building iPhone and Mac apps. It includes the tools needed to compile code into an app that can run on your phone.

**Why it's needed:** The VibeMeter app uses Google Sign-In, which requires a native (real) build installed via Xcode. You cannot use the generic Expo Go app for this.

**How to install:**

1. Open the **App Store** on your Mac (blue icon with the letter A)
2. In the search bar, type **Xcode**
3. Click **Install** (it's free, but large — about 10 GB)
4. This can take a long time depending on your internet speed. You can leave it to download overnight.

**First-time setup after install:**

1. Once installed, open **Xcode** from your Applications folder
2. It will say **"Installing additional components"** — let it finish (5–10 minutes)
3. Accept the licence agreement when prompted

**Verify it worked:**

```
xcode-select -p
```

The output should show a path ending in `Xcode.app/...`. If it shows `/Library/Developer/CommandLineTools`, run this to fix it:

```
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Enter your Mac password when asked.

---

## Part 6 — Download the Project Code

**What "cloning" means:** The project code lives on GitHub (a website that hosts code). Cloning means downloading a full copy of it to your Mac.

**Run these commands one by one:**

```
cd ~/Desktop
```
*(This moves your Terminal into your Desktop folder — the project files will be saved there)*

```
git clone https://github.com/Imhanda/vibemeter.git
```
*(This downloads the entire VibeMeter project from GitHub)*

```
cd vibemeter
```
*(This moves into the project folder you just downloaded)*

After this, a folder called `vibemeter` will appear on your Desktop with all the code inside.

> **No API keys needed.** The app connects to a shared cloud server that is already running. All configuration is included in the code you just downloaded.

---

## Part 7 — Install App Dependencies

The app uses many open-source JavaScript libraries. These aren't stored in the repo — they are downloaded on first use.

1. Navigate to the mobile folder:

```
cd ~/Desktop/vibemeter/mobile
```

2. Install all dependencies:

```
npm install
```

**What this does:** Reads the `package.json` file which lists all the libraries the app needs, then downloads them all into a folder called `node_modules`. This is a one-time step (~200 MB, 1–2 minutes).

---

## Part 8 — Connect Your iPhone and Build the App

1. **Plug your iPhone into your Mac** using the USB cable

2. **On your iPhone:** A popup will appear saying **"Trust This Computer?"**
   - Tap **Trust**
   - Enter your iPhone passcode

3. **In the same Terminal tab** (still in the `mobile/` folder), run:

```
npx expo run:ios --device
```

**What this command does:**
- Takes all the React Native / JavaScript code and compiles it into a real native iOS app
- Automatically opens Xcode in the background to handle the compilation
- Signs the app with your Apple ID so your iPhone accepts it
- Installs the app directly onto your connected iPhone

4. **Apple ID sign-in (first time only):**
   Xcode may open and show a message about needing an account. If it does:
   - Open Xcode from your Applications folder
   - Press **Cmd + ,** to open Settings
   - Click **Accounts**
   - Click the **+** button at the bottom left
   - Select **"Add Apple ID"** and sign in with your Apple ID

5. **Signing error fix:**
   If Xcode shows a red error that mentions "signing" or "provisioning":
   - Click on the error message
   - Click the **"Fix Issue"** or **"Enable Automatic Signing"** button that appears
   - Xcode will set everything up automatically

6. **Wait for the build** — first time takes 5–10 minutes. You'll see progress in Terminal. Subsequent builds are much faster.

7. **When it's done:** The VibeMeter app icon will appear on your iPhone home screen, and the app will open automatically.

---

## Part 9 — Use the App

1. **Open VibeMeter** on your iPhone (if it didn't open automatically)

2. **Sign in with Google:**
   - Tap the "Sign in with Google" button
   - Choose any Google account
   - Accept the permissions

3. **Home screen:** You'll see a list of venues (bars, clubs, restaurants in Bengaluru). Browse them and tap any one to see its vibe score.

4. **Check In:**
   - Tap a venue → tap **Check In**
   - Choose **🎤 Listen** mode: records 10 seconds of ambient audio, analyses it with AI, and scores the vibe
   - Or choose **⭐ Rate** mode: pick an emoji to manually rate the vibe
   - Tap **Submit Vibe** — your score is saved and the venue's overall score updates in real time

5. **Profile:** Tap the profile tab to see your check-in stats, trust score, and badges earned

---

## Troubleshooting

**"Network request failed" on the home screen**
→ The app connects to a cloud server — confirm your iPhone has an internet connection (Wi-Fi or mobile data).
→ If your internet is fine, the server may be temporarily down. Let the project owner know.

**"Trust" popup never appeared on iPhone**
→ Try a different USB cable — many cables only charge and don't carry data. The cable that came in the iPhone box always works.

**iPhone doesn't appear in Xcode**
→ Unplug and replug the cable. In Xcode: Window menu → Devices and Simulators. Your iPhone should appear. If it shows "Unavailable", try restarting your iPhone.

**App crashes when you tap the microphone button**
→ Go to iPhone **Settings** → scroll down to **VibeMeter** → enable **Microphone**.

**"Too far away" error when checking in**
→ This is disabled for testing — let the project owner know if you see it.

**Xcode says "No signing certificate" or "No accounts"**
→ Open Xcode → Settings (Cmd+,) → Accounts → click + → Add Apple ID. Sign in with the Apple ID you use for the App Store.

**`npm install` fails with permission errors**
→ Run this first: `sudo chown -R $(whoami) ~/.npm` then try `npm install` again.

**iPhone shows "Developer Mode required"**
→ On your iPhone: Settings → Privacy & Security → Developer Mode → Enable → restart iPhone → re-run the build command.

---

## The App is Already Installed — Opening It Next Time

Once the app is installed on your iPhone, you don't need to rebuild it each time.
Just open the **VibeMeter** app from your iPhone home screen — it connects to the cloud server automatically.

If the project owner pushes an update and asks you to update your app, repeat Parts 7 and 8 (the build command picks up any new code changes).
