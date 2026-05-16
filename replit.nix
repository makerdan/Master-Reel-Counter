{pkgs}: {
  deps = [
    pkgs.dbus
    pkgs.expat
    pkgs.at-spi2-core
    pkgs.cups
    pkgs.nspr
    pkgs.nss
    pkgs.cairo
    pkgs.pango
    pkgs.alsa-lib
    pkgs.mesa
    pkgs.libdrm
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.chromium
  ];
}
