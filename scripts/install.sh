#!/usr/bin/env bash
# Installs trakarr on a Debian or Ubuntu machine, such as a Proxmox LXC: Node.js
# 24, the latest release in /opt/trakarr and a systemd service. Settings, rules
# and the database are kept in /var/lib/trakarr. Run it again to update.
# Usage, as root: bash -c "$(curl -fsSL https://raw.githubusercontent.com/blacktower-lab/trakarr/main/scripts/install.sh)"
#
# TRAKARR_TARBALL, a URL to a tarball made by package.sh, installs that instead
# of the latest release, to try a build before it's released.
set -eu

repo=blacktower-lab/trakarr
dir=/opt/trakarr
data=/var/lib/trakarr

say() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root"
command -v apt-get >/dev/null || die "this needs Debian or Ubuntu"
command -v systemctl >/dev/null || die "this needs systemd"
export DEBIAN_FRONTEND=noninteractive

# The server runs its TypeScript directly, which takes Node.js 24. Debian's own
# package is older, so it comes from NodeSource.
if ! node -e 'process.exit(+(process.versions.node.split(".")[0] < 24))' 2>/dev/null; then
  say "Installing Node.js 24"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi

if [ -n "${TRAKARR_TARBALL:-}" ]; then
  version=custom
  url=$TRAKARR_TARBALL
else
  # GitHub redirects /releases/latest to the tag's page, which gives the version
  # without the API. With no release it stays on /releases.
  version=$(curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") || die "could not look up the latest release"
  version=${version##*/}
  case $version in v[0-9]*) ;; *) die "$repo has no release yet" ;; esac
  if [ "$(cat "$dir/VERSION" 2>/dev/null)" = "$version" ]; then
    say "trakarr $version is already installed"
    exit 0
  fi
  url=https://github.com/$repo/releases/download/$version/trakarr-$version.tar.gz
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
say "Downloading trakarr $version"
curl -fsSL "$url" -o "$tmp/release.tar.gz" || die "could not download $url"
mkdir "$tmp/app"
tar -xzf "$tmp/release.tar.gz" --no-same-owner --strip-components=1 -C "$tmp/app"
[ -f "$tmp/app/server/src/main.ts" ] || die "that is not a trakarr release"
echo "$version" >"$tmp/app/VERSION"

say "Installing trakarr"
install -d -m 0700 "$data"
cat >/etc/systemd/system/trakarr.service <<EOF
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

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "trakarr $version is running at http://${ip:-localhost}:7478"
