#!/bin/sh
# Builds build/NoteWorthy.app from main.swift: the menu bar app whose right-edge panel shows the
# chat logs and live transcript. Needs the Xcode command line tools.
set -e
cd "$(dirname "$0")"

# build NAME SOURCE BUNDLE_ID MENU_BAR_ONLY
build() {
  APP="build/$1.app"
  BIN=$(echo "$1" | tr -d ' ')
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$1</string>
  <key>CFBundleDisplayName</key><string>$1</string>
  <key>CFBundleIdentifier</key><string>$3</string>
  <key>CFBundleExecutable</key><string>$BIN</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><$4/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
  swiftc -swift-version 5 -O "$2" -o "$APP/Contents/MacOS/$BIN" -framework Cocoa -framework WebKit
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "Built $APP"
}

build "NoteWorthy" main.swift app.noteworthy.mini true
