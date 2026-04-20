# Writer Wiki

Writer Wiki is a local-first desktop web app for novelists. You run it on your own computer, store your project locally, and use your own OpenAI or Anthropic API key only when you choose to scan chapters or ask canon questions.

This guide is written for someone with no engineering background.

## What This App Needs

Before the app can run, your computer needs:

- Node.js 20 LTS
- npm
- A web browser such as Chrome, Edge, Firefox, or Safari
- This project folder on your computer

You do not need Homebrew. You do not need Git if you already have the project folder downloaded.

## What You Will Do

At a high level, you will:

1. Install Node.js
2. Open Terminal on Mac or PowerShell on Windows
3. Go into the project folder
4. Install the app's required files with `npm install`
5. Set up the local database with `npm run db:migrate`
6. Start the app with `npm run start`
7. Open the local address shown in your browser

## If You Do Not Have the Project Folder Yet

You need a copy of this repository on your computer first.

The easiest non-technical options are:

1. Download the repository as a ZIP from GitHub, then unzip it.
2. Use GitHub Desktop and clone the repository.

If someone already gave you the folder, you can skip this section.

Repository: `https://github.com/gwanunig14/writer-wiki`

## Mac Setup

### Step 1: Install Node.js

1. Open your browser.
2. Go to `https://nodejs.org`
3. Download the `LTS` version for macOS.
4. Open the downloaded installer.
5. Click through the installer until it finishes.

When this is done, both `node` and `npm` should be installed.

### Step 2: Open Terminal

1. Press `Command + Space`
2. Type `Terminal`
3. Press `Enter`

### Step 3: Go to the Project Folder

If your project folder is already in `Downloads`, `Desktop`, or another easy location, use the `cd` command to move into it.

Example:

```bash
cd "/Users/YOUR-NAME/Desktop/Writer Wiki/Writer Wiki"
```

If your folder path contains spaces, keep the quotation marks.

If you do not know the folder path:

1. Open Finder
2. Find the project folder
3. Drag the folder into the Terminal window after typing `cd `
4. Press `Enter`

### Step 4: Confirm Node.js Installed Correctly

Run:

```bash
node -v
npm -v
```

You should see version numbers. If you do, continue.

### Step 5: Install the App Dependencies

Run:

```bash
npm install
```

This can take a few minutes the first time.

### Step 6: Create the Local Database

Run:

```bash
npm run db:migrate
```

This prepares the local SQLite database the app uses.

### Step 7: Start the App

Run:

```bash
npm run start
```

This command builds the app and launches the local server.

### Step 8: Open the App in Your Browser

After the app starts, open this address in your browser:

```text
http://localhost:3000
```

If the app prints a different local address, use that one instead.

## Windows Setup

### Step 1: Install Node.js

1. Open your browser.
2. Go to `https://nodejs.org`
3. Download the `LTS` version for Windows.
4. Open the downloaded installer.
5. Accept the default options unless you have a specific reason not to.
6. Finish the installer.

When this is done, both `node` and `npm` should be installed.

### Step 2: Open PowerShell

1. Click the Start menu.
2. Type `PowerShell`
3. Open `Windows PowerShell` or `PowerShell`

### Step 3: Go to the Project Folder

Example:

```powershell
cd "C:\Users\YOUR-NAME\Desktop\Writer Wiki\Writer Wiki"
```

If your folder path contains spaces, keep the quotation marks.

If you do not know the folder path:

1. Open File Explorer.
2. Find the project folder.
3. Click the folder path bar.
4. Copy the full path.
5. Use it after `cd` in PowerShell.

### Step 4: Confirm Node.js Installed Correctly

Run:

```powershell
node -v
npm -v
```

You should see version numbers. If you do, continue.

### Step 5: Install the App Dependencies

Run:

```powershell
npm install
```

This can take a few minutes the first time.

### Step 6: Create the Local Database

Run:

```powershell
npm run db:migrate
```

This prepares the local SQLite database the app uses.

### Step 7: Start the App

Run:

```powershell
npm run start
```

This command builds the app and launches the local server.

### Step 8: Open the App in Your Browser

After the app starts, open this address in your browser:

```text
http://localhost:3000
```

If the app prints a different local address, use that one instead.

## First Launch Inside the App

When the app opens for the first time:

1. Choose `OpenAI` or `Anthropic`
2. Enter your API key
3. Click `Test connection`
4. Create your project

Important:

- The app can open without scanning anything yet.
- You only need an API key if you want to use scanning or canon chat.
- Your project files stay local unless you explicitly trigger a provider-backed action.

## Normal Daily Startup After the First Time

Each time you want to use the app again:

1. Open Terminal on Mac or PowerShell on Windows
2. Go to the project folder
3. Run:

```bash
npm run start
```

4. Open `http://localhost:3000`

## How To Get App Updates Later

There are two common ways people get updates.

### Option 1: You Have a Git-Based Copy of the Project

If you originally got the project by cloning it with Git or GitHub Desktop, you can usually update it with `git pull`.

Before pulling updates:

1. Stop the app if it is currently running
2. Open Terminal on Mac or PowerShell on Windows
3. Go to the project folder

Then run:

```bash
git pull
```

After `git pull` finishes, run these commands to make sure everything is up to date:

```bash
npm install
npm run db:migrate
npm run start
```

Then open:

```text
http://localhost:3000
```

### Option 2: You Downloaded the Project as a ZIP

If you downloaded a ZIP file from GitHub, `git pull` will not work because that copy is not connected to Git.

In that case, to get updates:

1. Download a fresh ZIP from GitHub
2. Unzip it
3. Open the new folder
4. Run:

```bash
npm install
npm run db:migrate
npm run start
```

### If `git pull` Says Git Is Not Installed

That means your computer does not have Git yet.

You have two choices:

1. Install Git and then use `git pull` in the future
2. Keep using the ZIP download method instead

For most non-technical users, the ZIP method is simpler.

## How to Stop the App

In the same Terminal or PowerShell window where the app is running:

1. Click that window
2. Press `Ctrl + C`

That stops the local server.

## Important Local Files the App Creates

After setup and usage, the app creates local working files such as:

- `.local-data/` for the local database and local secrets storage
- `project-data/` for projected chapter and wiki files

These are expected.

## Commands Summary

From inside the project folder:

```bash
npm install
npm run db:migrate
npm run start
```

## Troubleshooting

### `node` is not recognized

Cause: Node.js is not installed, or the installer did not finish correctly.

Fix:

1. Reinstall Node.js from `https://nodejs.org`
2. Fully close Terminal or PowerShell
3. Open it again
4. Run:

```bash
node -v
npm -v
```

### `npm install` fails

Try these steps:

1. Make sure you are inside the project folder
2. Make sure Node.js is the LTS version
3. Close Terminal or PowerShell and reopen it
4. Run `npm install` again

### `npm run db:migrate` fails

Usually this means dependencies were not installed correctly.

Try:

```bash
npm install
npm run db:migrate
```

### `npm run start` fails

Try this order:

```bash
npm install
npm run db:migrate
npm run start
```

If it still fails:

1. Copy the full error text
2. Check whether another app is already using port `3000`
3. Try closing other local development tools or local servers

### `npm run start` looks like it failed, but the app actually started

Sometimes the Terminal window may look confusing because the app keeps running instead of returning to a normal command prompt.

If you see a line like this:

```text
Listening on http://0.0.0.0:3000
```

that means the app is running correctly.

Open this in your browser:

```text
http://localhost:3000
```

Do not close that Terminal or PowerShell window while you are using the app.

### `EADDRINUSE` or `address already in use`

If you see an error like this:

```text
Error: listen EADDRINUSE: address already in use
```

it means that port is already being used by another running app, or by another copy of Writer Wiki that is already open.

This is common if:

- you started the app twice
- another local server is already using port `3000`
- another local server is already using port `3001`

Fix:

1. Go back to any other Terminal or PowerShell windows where Writer Wiki may already be running
2. Press `Ctrl + C` in those windows
3. Wait a few seconds
4. Run `npm run start` again

If it still happens, restart your computer and try again.

### `git pull` fails because you have local changes

Sometimes `git pull` will stop if files in your folder were changed locally.

If that happens, the safest non-technical option is:

1. Make a copy of anything important in the folder
2. Download a fresh ZIP of the latest project instead

If you are comfortable with Git, you can inspect the changed files first before deciding what to keep.

### The browser says the site cannot be reached

This usually means the app is not actually running yet.

Check the Terminal or PowerShell window:

- If it shows an error, fix that first
- If it is running normally, retry `http://localhost:3000`

### I entered an API key and scanning still does not work

Check:

1. You selected the correct provider
2. The API key is active
3. You clicked `Test connection`
4. Your internet connection is working at the time you scan or ask canon questions

## Notes for Non-Technical Users

- You do not need to understand the code to use the app locally.
- You do need to keep the Terminal or PowerShell window open while the app is running.
- Closing that window stops the app.
- Do not share your API key.
- Do not upload local secret files such as `provider-secrets.json`.

## Optional Development Commands

These are mainly for technical users, but listed here for completeness:

```bash
npm run build
npm run test
npm run test:e2e
```

`npm run start` is the main command most users need.
