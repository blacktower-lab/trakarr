# Changelog

## v1.1.1

### New features

- [2807182](https://github.com/blacktower-lab/trakarr/commit/2807182) Show a progress bar while installing
- [030abe5](https://github.com/blacktower-lab/trakarr/commit/030abe5) Show the steps and the result inside whiptail
- [c157b3e](https://github.com/blacktower-lab/trakarr/commit/c157b3e) Show the menus in whiptail dialogs
- [b9a070d](https://github.com/blacktower-lab/trakarr/commit/b9a070d) Find an installation and offer to upgrade or remove it

### Improvements

- [b13be3f](https://github.com/blacktower-lab/trakarr/commit/b13be3f) Use the whiptail buttons to select and quit
- [6854ada](https://github.com/blacktower-lab/trakarr/commit/6854ada) Hide the option letters in the whiptail menu

### Bug fixes

- [97a760e](https://github.com/blacktower-lab/trakarr/commit/97a760e) Clear the screen after the whiptail dialogs

## v1.1.0

### Breaking changes

- [e5cb596](https://github.com/blacktower-lab/trakarr/commit/e5cb596) Replace `addBought` with `addPurchases` and `deletePurchases` in the tracker update API
- [a8cc50b](https://github.com/blacktower-lab/trakarr/commit/a8cc50b) Match torrents by tracker domain only: tags are removed and a rule with no domain stops trakarr from starting

### New features

- [1230e40](https://github.com/blacktower-lab/trakarr/commit/1230e40) Keep the quota dialog's purchases until save and project the ratio from them
- [696ac8c](https://github.com/blacktower-lab/trakarr/commit/696ac8c) List a tracker's purchases in the quota dialog to add and delete them
- [e544603](https://github.com/blacktower-lab/trakarr/commit/e544603) Keep bought upload as dated purchases and let each one be deleted
- [08101cb](https://github.com/blacktower-lab/trakarr/commit/08101cb) Turn the Prowlarr sync profile switch on in Settings > Integrations, not per rule
- [b31fbbc](https://github.com/blacktower-lab/trakarr/commit/b31fbbc) Add a "Download based on buffer" option to rules

### Improvements

- [ddf2243](https://github.com/blacktower-lab/trakarr/commit/ddf2243) Hide the focus rings in the theme
- [dc34efe](https://github.com/blacktower-lab/trakarr/commit/dc34efe) Bring the buffer checkbox, buffer message and section spacing to the rule dialog
- [0b265b6](https://github.com/blacktower-lab/trakarr/commit/0b265b6) Move the tracker of the quota dialog from its title to a disabled field
- [f987d88](https://github.com/blacktower-lab/trakarr/commit/f987d88) Disable the ratio fields while the buffer switch is on
- [0aa3008](https://github.com/blacktower-lab/trakarr/commit/0aa3008) Move the buffer switch under the ratios in the rule editor
- [ed81cd8](https://github.com/blacktower-lab/trakarr/commit/ed81cd8) Drop the qBittorrent status from the header
- [8f37cf9](https://github.com/blacktower-lab/trakarr/commit/8f37cf9) Draw the hold action radios like the settings checkbox
- [a26735a](https://github.com/blacktower-lab/trakarr/commit/a26735a) Put the domains field beside the name in the rule editor

### Bug fixes

- [d90025e](https://github.com/blacktower-lab/trakarr/commit/d90025e) Show a field's error only after it has been left

### Maintenance

- [74cc9e1](https://github.com/blacktower-lab/trakarr/commit/74cc9e1) Ignore todo, agent and skills files
- [a914045](https://github.com/blacktower-lab/trakarr/commit/a914045) Publish the tag's message as the release notes

## v1.0.2

### Breaking changes

- [da3bc72](https://github.com/blacktower-lab/trakarr/commit/da3bc72) Replace the qbittorrent login with an api key

### New features

- [97311f0](https://github.com/blacktower-lab/trakarr/commit/97311f0) Add the time and language section and translate the interface to Spanish
- [0d99367](https://github.com/blacktower-lab/trakarr/commit/0d99367) Keep the time zone, clock and language in the settings
- [238602e](https://github.com/blacktower-lab/trakarr/commit/238602e) Add the sign-in screen and the security section
- [200f651](https://github.com/blacktower-lab/trakarr/commit/200f651) Guard the dashboard with a password and cookie sessions
- [daab122](https://github.com/blacktower-lab/trakarr/commit/daab122) Add the notifications section with an ntfy card
- [0c7ad5a](https://github.com/blacktower-lab/trakarr/commit/0c7ad5a) Send holds, releases, failures and ending freeleeches to ntfy
- [721ae8a](https://github.com/blacktower-lab/trakarr/commit/721ae8a) Build a larger checkbox for test mode
- [51f508c](https://github.com/blacktower-lab/trakarr/commit/51f508c) Rework the row tooltips and show unruled trackers as infinite
- [b2c7638](https://github.com/blacktower-lab/trakarr/commit/b2c7638) Explain the ratio, downloaded and buffer columns in tooltips
- [c75d803](https://github.com/blacktower-lab/trakarr/commit/c75d803) Pin trackers to the top of the dashboard
- [b987c44](https://github.com/blacktower-lab/trakarr/commit/b987c44) Filter trackers by name on the dashboard

### Improvements

- [c8cc5cf](https://github.com/blacktower-lab/trakarr/commit/c8cc5cf) Say coming soon on the API keys section
- [ca6cda0](https://github.com/blacktower-lab/trakarr/commit/ca6cda0) Move the time and language settings into System and drop their section
- [730206e](https://github.com/blacktower-lab/trakarr/commit/730206e) Put each time and language select back on its own row
- [a2c7977](https://github.com/blacktower-lab/trakarr/commit/a2c7977) Let the language and time zone selects share the whole row
- [037e90f](https://github.com/blacktower-lab/trakarr/commit/037e90f) Put the language and time zone selects on one row
- [903bba2](https://github.com/blacktower-lab/trakarr/commit/903bba2) Stretch the notifications card to the section's full width
- [c47d6bd](https://github.com/blacktower-lab/trakarr/commit/c47d6bd) Stretch the time and security cards to the section's full width
- [4a783f6](https://github.com/blacktower-lab/trakarr/commit/4a783f6) Draw the menus' active line in the text color, not the accent
- [7a9f45b](https://github.com/blacktower-lab/trakarr/commit/7a9f45b) Lighten the default color in the dark theme
- [a1e66a3](https://github.com/blacktower-lab/trakarr/commit/a1e66a3) Use a checkbox for test mode
- [852b97a](https://github.com/blacktower-lab/trakarr/commit/852b97a) Use the logo's orange as the accent
- [faafa66](https://github.com/blacktower-lab/trakarr/commit/faafa66) Lengthen the asterisks that stand for saved secrets
- [53116a4](https://github.com/blacktower-lab/trakarr/commit/53116a4) Show saved secrets as three asterisks
- [cf8161d](https://github.com/blacktower-lab/trakarr/commit/cf8161d) Add an integrations section and edit system settings in place

### Bug fixes

- [f0167dd](https://github.com/blacktower-lab/trakarr/commit/f0167dd) Center the checkbox on its text and toggle it from any of it
- [a7df81f](https://github.com/blacktower-lab/trakarr/commit/a7df81f) Change the filter placeholder to filter by name
- [14aae17](https://github.com/blacktower-lab/trakarr/commit/14aae17) Show tooltips after 400ms instead of 1500ms
- [a2681d1](https://github.com/blacktower-lab/trakarr/commit/a2681d1) Put the sort arrow left of the column label

### Maintenance

- [54c4bd9](https://github.com/blacktower-lab/trakarr/commit/54c4bd9) Explain where to run npm and what run.sh does

## v1.0.1

### Bug fixes

- [d819dc6](https://github.com/blacktower-lab/trakarr/commit/d819dc6) Rewrite asset links for the published site

## v1.0.0

### New features

- [8457d31](https://github.com/blacktower-lab/trakarr/commit/8457d31) Add the first version of trakarr

### Maintenance

- [11597f4](https://github.com/blacktower-lab/trakarr/commit/11597f4) Add a banner to the readme
- [039d922](https://github.com/blacktower-lab/trakarr/commit/039d922) Add readme
