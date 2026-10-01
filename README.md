<p align="center">
  <img src="assets/banner.svg" alt="trakarr: Keep your ratio guarded!" />
</p>

trakarr holds downloads when your ratio drops and releases them once seeding
brings it back.

Rules pick torrents by tag or tracker domain. A rule can also switch a Prowlarr
indexer's sync profile while it holds, and each tracker can count upload bought
with bonus points and freeleech windows. Only downloading torrents are ever
held: completed and stopped ones are left alone, and nothing is deleted. A fresh
install runs in test mode, which only logs what it would do.

## Install

On Debian or Ubuntu, such as a Proxmox LXC, as root:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/blacktower-lab/trakarr/main/scripts/install.sh)"
```

It installs Node.js 24, the latest release in `/opt/trakarr` and a systemd
service, with settings, rules and the database in `/var/lib/trakarr`. The
dashboard is on port 7478. Run it again to update.

Then connect qBittorrent in Settings, add a rule, and turn test mode off once
its events look right.

## Development

Needs Node.js 24.

```sh
npm ci
npm run dev     # the app on http://localhost:5173, the server on 7478
npm test
npm run build
```

In development, settings, rules and the database go in `config/`.

| Folder     | What's in it                                                                      |
| ---------- | --------------------------------------------------------------------------------- |
| `server/`  | The server, TypeScript that Node runs with no build                               |
| `app/`     | The dashboard: React, Vite, Tailwind and HeroUI                                   |
| `site/`    | The landing page, published to GitHub Pages                                       |
| `assets/`  | The logo and wordmark, shared by the app and the site                             |
| `scripts/` | `run.sh` for development, `package.sh` builds a release, `install.sh` installs it |
