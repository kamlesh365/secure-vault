# Secure Vault

A beautiful, client-side password manager built with plain HTML, CSS, and JavaScript. No backend, no database — everything runs in your browser and data stays on your device.

## Features

- **Encrypted storage** — Each user's vault is encrypted with AES-256-GCM using their master password (PBKDF2 key derivation)
- **Real-time editing** — Click any application name or field to edit inline
- **Multiple fields per app** — Username, password, URL, notes, and custom fields
- **Search** — Filter applications by name or field content (press `/` to focus search)
- **Password tools** — Generate strong passwords, show/hide secrets, copy to clipboard
- **Export / import** — Download and restore encrypted backups
- **GitHub Pages ready** — Static files only, deploy in one step

## Quick start

Open `index.html` in any modern browser, or serve locally:

```bash
npx serve .
```

Create a username and master password on first launch (username min 2 chars, password min 8). Each user gets a completely separate encrypted vault — no server, no database, all in `localStorage`.

## Build for deployment (single HTML file)

For GitHub Pages or any static host, bundle everything into **one self-contained file**:

```bash
node build.mjs
```

This creates `dist/index.html` (~43 KB) with all CSS and JavaScript inlined. No external files needed except Google Fonts (loaded from CDN).

You can also open `dist/index.html` directly in a browser — it works standalone.

## Deploy to GitHub Pages

**Option A — Deploy the built file (recommended)**

1. Build the single file:
   ```bash
   node build.mjs
   ```
2. Create a GitHub repo and push the `dist` folder contents as your site root:

   ```bash
   cd dist
   git init
   git add index.html
   git commit -m "Deploy Secure Vault"
   git remote add origin https://github.com/YOUR_USERNAME/secure-vault.git
   git push -u origin main
   ```

3. Go to **Settings → Pages → Deploy from branch → `main` / root**

**Option B — Deploy from the full repo**

1. Build, then copy the output to root:
   ```bash
   node build.mjs
   cp dist/index.html index.html   # or Copy-Item on Windows
   ```
2. Push the repo and enable GitHub Pages on the `main` branch.

Your site will be live at `https://YOUR_USERNAME.github.io/secure-vault/`

## Development vs deployment

| | Development | Deployment |
|---|---|---|
| Files | `index.html` + `css/` + `js/` | Single `dist/index.html` |
| Edit | Change source files | Re-run `node build.mjs` after changes |

## Security notes

This is a **client-side only** password manager. Your data is encrypted before being stored in `localStorage`, but keep these limitations in mind:

- If you forget your master password, **data cannot be recovered**
- Anyone with access to your unlocked browser session can view entries
- Malicious browser extensions could potentially read page content
- For high-security use cases, consider dedicated password managers with hardware security modules

Always export regular backups using the download button in the app header.

## File structure

```
secure-vault/
├── index.html      # Source page
├── css/styles.css  # Source styles
├── js/app.js       # Source logic & encryption
├── build.mjs       # Bundles into single HTML
├── dist/
│   └── index.html  # ← Deploy this file
└── README.md
```

## Browser support

Works in all modern browsers that support the [Web Crypto API](https://caniuse.com/cryptography) (Chrome, Firefox, Safari, Edge).

## License

MIT
