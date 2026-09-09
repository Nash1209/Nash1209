#!/bin/sh
# Impeccable エンジン（self-contained binary）を npm から取得して
# ランチャー (.claude/skills/impeccable/scripts/impeccable) が探す
# バージョン固定キャッシュ ${IMPECCABLE_HOME:-~/.impeccable}/bin/<version>/ に置く。
#
# 公式ランチャーは GitHub Releases から取得するが、この環境（Claude Code on the web）
# では GitHub Releases への egress が 403 で塞がれているため、
# 同じバイナリを配布している npm パッケージ @impeccable/cli-<os>-<arch> を使う。
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill="$dir/../skills/impeccable"
version=$(tr -d '[:space:]' < "$skill/scripts/VERSION")
cache_root="${IMPECCABLE_HOME:-${HOME:-/nonexistent}/.impeccable}"
dest="$cache_root/bin/$version/impeccable"

if [ -x "$dest" ] && [ "$("$dest" engine-probe 2>/dev/null || true)" = "impeccable-engine $version" ]; then
  echo "impeccable engine $version already installed: $dest"
  exit 0
fi

case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "unsupported OS" >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
pkg="@impeccable/cli-$os-$arch@$version"

command -v npm >/dev/null 2>&1 || { echo "npm is required to fetch $pkg" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "fetching $pkg ..."
tgz=$(cd "$tmp" && npm pack "$pkg" --silent 2>/dev/null | tail -1)
tar xzf "$tmp/$tgz" -C "$tmp"
mkdir -p "$cache_root/bin/$version"
install -m 755 "$tmp/package/bin/impeccable" "$dest"
probe=$("$dest" engine-probe 2>/dev/null || true)
[ "$probe" = "impeccable-engine $version" ] || { echo "engine probe failed: $probe" >&2; exit 1; }
echo "installed $probe -> $dest"
