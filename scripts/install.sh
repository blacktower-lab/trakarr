#!/usr/bin/env bash
# Installs trakarr on a Debian or Ubuntu machine, such as a Proxmox LXC: Node.js
# 24, the latest release in /opt/trakarr and a systemd service. Settings, rules
# and the database are kept in /var/lib/trakarr.
# Run it again to upgrade or to remove trakarr: it finds the installation and asks,
# with whiptail dialogs.
# Usage, as root: bash -c "$(curl -fsSL https://raw.githubusercontent.com/blacktower-lab/trakarr/main/scripts/install.sh)"
#
# TRAKARR_TARBALL, a URL to a tarball made by package.sh, installs that instead
# of the latest release, to try a build before it's released.
# TRAKARR_UNINSTALL=1 removes trakarr and all its data without asking.
set -eu

repo=blacktower-lab/trakarr
dir=/opt/trakarr
data=/var/lib/trakarr
unit=/etc/systemd/system/trakarr.service

say() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# Questions go to the terminal, not to stdin: with "curl ... | bash" stdin is
# the script. With no terminal the script asks nothing and upgrades.
if ( : </dev/tty ) 2>/dev/null; then interactive=1; else interactive=0; fi

# The menus are whiptail dialogs. Without whiptail, or with a terminal that
# cannot draw them, the script asks in plain text.
ui=text

# Asks a question in plain text and leaves the reply in $answer. A closed
# terminal is a q, so it never takes the default.
ask() {
  printf '%s' "$1" >/dev/tty
  read -r answer </dev/tty || answer=q
}

# Succeeds when the menus can be whiptail dialogs. A minimal machine can lack
# whiptail, so it is installed when it is missing.
use_whiptail() {
  [ "${TERM:-dumb}" != dumb ] || return 1
  if ! command -v whiptail >/dev/null; then
    command -v apt-get >/dev/null || return 1
    say "Installing whiptail"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq whiptail >/dev/null 2>&1 || return 1
  fi
}

# Shows a menu and leaves the chosen tag in $answer, or q when the user quits.
# The arguments are the message, then each tag and its label. The first option
# is the default. Quit is not an option: it is the Cancel button, or Esc.
pick() {
  local text=$1 default=$2 items
  shift
  items=$(($# / 2))
  if [ "$ui" = whiptail ]; then
    # whiptail prints the chosen tag on stderr, so it is swapped with stdout. The
    # tags are only for the script, so the menu shows the labels alone.
    answer=$(whiptail --title trakarr --notags --ok-button Select --cancel-button Quit --menu "$text" \
      $(($(printf '%s\n' "$text" | wc -l) + items + 7)) 72 "$items" "$@" 3>&1 1>&2 2>&3 </dev/tty) || answer=q
  else
    say "$text"
    while [ $# -gt 0 ]; do
      printf '  %s  %s\n' "$1" "$2"
      shift 2
    done
    printf '  q  Quit\n'
    ask "Select [default: $default]: "
    answer=$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')
    [ -n "$answer" ] || answer=$default
  fi
}

# Shows a step of the work. In a whiptail run it is an infobox, which stays on
# the screen until the next dialog, and it draws on the terminal itself because
# the output of the work goes to a log. Without whiptail it is a line.
step() {
  if [ "$ui" = whiptail ]; then
    whiptail --title trakarr --infobox "$*" 7 72 </dev/tty >/dev/tty
  else
    say "$*"
  fi
}

# Tells the result. In a whiptail run it is a message box that clears the screen
# when it closes. The line is printed too, so it stays in the terminal.
result() {
  if [ "$ui" = whiptail ]; then
    whiptail --title trakarr --clear --msgbox "$*" 8 72 </dev/tty >/dev/tty || true
  fi
  say "$*"
}

# Ends with no change. The dialog is cleared first, so the line is not under it.
nothing() {
  if [ "$ui" = whiptail ]; then clear || true; fi
  say "Nothing changed"
}

[ "$(id -u)" = 0 ] || die "run this as root"
command -v systemctl >/dev/null || die "this needs systemd"

# Removes the service, the application and the data. Node.js stays: other
# programs can use it, and the script cannot know if it installed it.
uninstall() {
  step "Removing trakarr"
  systemctl disable --now trakarr >/dev/null 2>&1 || true
  rm -f "$unit"
  systemctl daemon-reload
  rm -rf "$dir" "$data"
  result "trakarr is removed"
  printf 'Node.js is still installed. To remove it, run:\n'
  printf '  apt-get remove nodejs && rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg\n'
}

# Says what the removal deletes and removes it after a yes. No is the default.
remove() {
  local text
  text=$(cat <<EOF
This deletes trakarr and all its data:

  $dir (the application)
  $unit (the service)
  $data (the settings, the rules and the database)

The data includes the API keys of qBittorrent and Prowlarr. You cannot restore it.

trakarr does not release what it holds. After it is gone, a held torrent stays held, and a Prowlarr indexer stays on its held sync profile.
EOF
)
  if [ "$ui" = whiptail ]; then
    if whiptail --title "Remove trakarr" --defaultno --scrolltext --yes-button Remove --no-button Cancel --yesno "$text" 20 72 </dev/tty; then
      answer=y
    else
      answer=n
    fi
  else
    printf '\n%s\n\n' "$text"
    ask "Delete trakarr and all its data? [y/N] "
  fi
  case $answer in
    y | Y | yes | YES) uninstall ;;
    *) nothing ;;
  esac
  exit 0
}

# The newest release. GitHub redirects /releases/latest to the tag's page, which
# gives the version without the API. With no release it stays on /releases.
latest() {
  local version
  version=$(curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") || die "could not look up the latest release"
  version=${version##*/}
  case $version in v[0-9]*) ;; *) die "$repo has no release yet" ;; esac
  printf '%s' "$version"
}

found=0
if [ -d "$dir" ] || [ -f "$unit" ] || [ -d "$data" ]; then found=1; fi
current=$(cat "$dir/VERSION" 2>/dev/null || true)

if [ "${TRAKARR_UNINSTALL:-}" = 1 ]; then
  [ "$found" = 1 ] || { say "trakarr is not installed"; exit 0; }
  uninstall
  exit 0
fi

if [ -n "${TRAKARR_TARBALL:-}" ]; then
  version=custom
  target="the custom build"
  url=$TRAKARR_TARBALL
else
  version=$(latest) || exit 1
  target=$version
  url=https://github.com/$repo/releases/download/$version/trakarr-$version.tar.gz
fi

if [ "$found" = 1 ]; then
  # A tarball is always installed, since its version says nothing about its content.
  same=0
  if [ -z "${TRAKARR_TARBALL:-}" ] && [ "$current" = "$version" ]; then same=1; fi

  if [ "$interactive" = 0 ]; then
    if [ "$same" = 1 ]; then
      say "trakarr $version is already installed"
      exit 0
    fi
  elif [ "$same" = 1 ]; then
    if use_whiptail; then ui=whiptail; fi
    pick "trakarr $current is installed, and it is the latest release." \
      i "Install it again" r "Remove trakarr and all its data"
    case $answer in
      i) ;;
      r) remove ;;
      *) nothing; exit 0 ;;
    esac
  else
    if use_whiptail; then ui=whiptail; fi
    if [ -n "$current" ]; then
      header="trakarr $current is installed. The new version is $target."
      label="Upgrade to $target"
    else
      header="Found the files of an earlier trakarr install."
      label="Install $target"
    fi
    pick "$header" u "$label" r "Remove trakarr and all its data"
    case $answer in
      u) ;;
      r) remove ;;
      *) nothing; exit 0 ;;
    esac
  fi
  if [ "$same" = 1 ]; then
    step "Installing trakarr $version again"
  elif [ -n "$current" ]; then
    step "Upgrading trakarr from $current to $version"
  fi
fi

command -v apt-get >/dev/null || die "this needs Debian or Ubuntu"
export DEBIAN_FRONTEND=noninteractive

# Installs Node.js when it is missing, then the release, and starts the service.
install_release() {
  # The server runs its TypeScript directly, which takes Node.js 24. Debian's own
  # package is older, so it comes from NodeSource.
  if ! node -e 'process.exit(+(process.versions.node.split(".")[0] < 24))' 2>/dev/null; then
    step "Installing Node.js 24"
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg >/dev/null
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs >/dev/null
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  step "Downloading trakarr $version"
  curl -fsSL "$url" -o "$tmp/release.tar.gz" || die "could not download $url"
  mkdir "$tmp/app"
  tar -xzf "$tmp/release.tar.gz" --no-same-owner --strip-components=1 -C "$tmp/app"
  [ -f "$tmp/app/server/src/main.ts" ] || die "that is not a trakarr release"
  echo "$version" >"$tmp/app/VERSION"

  step "Installing trakarr"
  install -d -m 0700 "$data"
  cat >"$unit" <<EOF
[Unit]
Description=trakarr
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$dir/server
Environment=NODE_ENV=production
Environment=PORT=7478
Environment=CONFIG_DIRECTORY=$data
ExecStart=/usr/bin/node src/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
  systemctl stop trakarr 2>/dev/null || true
  rm -rf "$dir"
  mv "$tmp/app" "$dir"
  systemctl daemon-reload
  systemctl enable -q trakarr
  systemctl restart trakarr
  sleep 2
  systemctl is-active -q trakarr || die "trakarr did not start, see: journalctl -u trakarr"
}

if [ "$ui" = whiptail ]; then
  # The output of the work goes to a log, so it does not draw over the dialogs.
  # A failure shows the end of the log. set -e is turned off around the call,
  # because it has no effect in a command that is part of a test.
  log=$(mktemp)
  set +e
  (set -e; install_release) >"$log" 2>&1
  status=$?
  set -e
  if [ "$status" != 0 ]; then
    whiptail --title "Installation failed" --clear --scrolltext --msgbox "$(tail -n 12 "$log")" 20 78 </dev/tty >/dev/tty || true
    tail -n 12 "$log" >&2
    rm -f "$log"
    exit 1
  fi
  rm -f "$log"
else
  install_release
fi

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
result "trakarr $version is running at http://${ip:-localhost}:7478"
