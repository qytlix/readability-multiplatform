# Maintainer: Shale Team
# PKGBUILD for Arch Linux
#
# Usage:
#   # 本地构建（需要仓库已 clone 到当前目录）
#   makepkg -f --noconfirm
#
# 对于 CI：makepkg 会自动执行 prepare() → build() → package()

pkgname=shale
pkgver=1.0.0
pkgrel=1
pkgdesc="Local-first AI-powered Feed reader — offline reading with AI summaries & translations"
arch=('x86_64')
url="https://github.com/qytlix/readability-multiplatform"
license=('MIT')
depends=(
  'gtk3'
  'libxss'
  'libxkbfile'
  'libxdamage'
  'libxcomposite'
  'libxrandr'
  'libxfixes'
  'libxrender'
  'libx11'
  'libxcursor'
  'libxi'
  'libxtst'
  'nss'
  'nspr'
  'alsa-lib'
  'libpulse'
  'cups'
  'dbus'
  'expat'
  'libdrm'
  'mesa'
  'libglvnd'
)
makedepends=(
  'git'
  'nodejs>=24'
  'npm'
)
conflicts=()
replaces=()
backup=()
install=shale.install
sha256sums=('SKIP')

# CI 直接使用本地目录，跳过 source 下载
# 本地用户也可以直接 build（假设已 clone 到 PKGBUILD 所在目录）
source=("shale.desktop")

prepare() {
  # 如果 node_modules 还不存在才安装（CI 已经 ci 过了也可以跳过）
  if [ ! -d node_modules ]; then
    echo "--> npm ci"
    npm ci --loglevel=warn
  fi
}

build() {
  npm run typecheck
  npm run package
}

package() {
  local appdir="${pkgdir}/usr/lib/${pkgname}"
  local bindir="${pkgdir}/usr/bin"
  local sharedir="${pkgdir}/usr/share"

  # 安装打包好的 Electron 应用
  mkdir -p "${appdir}"
  cp -r "${startdir}/out/Shale-linux-x64/"* "${appdir}/"

  # Desktop entry
  mkdir -p "${sharedir}/applications"
  install -m644 "${startdir}/shale.desktop" "${sharedir}/applications/${pkgname}.desktop"

  # Icon
  mkdir -p "${sharedir}/icons/hicolor/256x256/apps"
  if [ -f "${appdir}/resources/icon.png" ]; then
    cp "${appdir}/resources/icon.png" "${sharedir}/icons/hicolor/256x256/apps/${pkgname}.png"
  fi

  # Launcher symlink
  mkdir -p "${bindir}"
  ln -sf "/usr/lib/${pkgname}/Shale" "${bindir}/${pkgname}"

  # 确保 sandbox setuid
  chmod 4755 "${appdir}/chrome-sandbox" 2>/dev/null || true
}
