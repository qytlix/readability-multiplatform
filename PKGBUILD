# Maintainer: Shale Team
#
# PKGBUILD for Arch Linux
#
# Downloads the CI-built .pkg.tar.zst directly from GitHub release.
# No Node.js or build toolchain needed — works with plain pacman/makepkg.
#
# Usage:
#   curl -OL https://raw.githubusercontent.com/qytlix/readability-multiplatform/refs/heads/main/PKGBUILD
#   curl -OL https://raw.githubusercontent.com/qytlix/readability-multiplatform/refs/heads/main/shale.install
#   makepkg -si

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
  'nss'
  'alsa-lib'
  'libpulse'
  'cups'
  'dbus'
  'libdrm'
  'mesa'
  'libglvnd'
  'expat'
)
install=shale.install

# Direct download from GitHub Releases (CI-built .pkg.tar.zst)
_pkg_url="https://github.com/qytlix/readability-multiplatform/releases/download/v${pkgver}/shale-linux-arch-x86_64.pkg.tar.zst"
source=("${_pkg_url}")
sha256sums=('SKIP')

package() {
  cd "${srcdir}"

  # The CI-built package is already a valid Arch package tar.zst.
  # Extract contents directly to package root.
  tar --zstd -xf "shale-linux-arch-x86_64.pkg.tar.zst" -C "${pkgdir}"

  # chrome-sandbox must be setuid for Electron's sandbox to work
  chmod 4755 "${pkgdir}/usr/lib/${pkgname}/chrome-sandbox" 2>/dev/null || true
}