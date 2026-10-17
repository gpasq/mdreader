#!/bin/zsh
# Builds MDReader.app into ./build.
#   ./build.sh            release build
#   ./build.sh install    also copy to /Applications and register with Launch Services
set -euo pipefail
cd "$(dirname "$0")"

APP=build/MDReader.app
# The Command Line Tools' newest SDK ships SwiftUI macros the CLT can't load; pin to the macOS 26 SDK when present.
SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk
[[ -d $SDK ]] && export SDKROOT=$SDK

echo "› Compiling"
swift build -c release --arch arm64 --arch x86_64 2>&1 | grep -vE "ld: warning: search path" || true
BIN=$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/MDReader
[[ -x $BIN ]] || { echo "build failed"; exit 1; }

echo "› Assembling bundle"
rm -rf $APP
mkdir -p $APP/Contents/MacOS $APP/Contents/Resources
cp $BIN $APP/Contents/MacOS/MDReader
cp Resources/Info.plist $APP/Contents/Info.plist
cp -R Resources/web $APP/Contents/Resources/web

if [[ ! -f build/AppIcon.icns || scripts/make-icon.swift -nt build/AppIcon.icns ]]; then
  echo "› Rendering icon"
  ICONSET=build/AppIcon.iconset
  rm -rf $ICONSET && mkdir -p $ICONSET
  swift scripts/make-icon.swift build/icon_1024.png >/dev/null
  for s in 16 32 128 256 512; do
    sips -z $s $s build/icon_1024.png --out $ICONSET/icon_${s}x${s}.png >/dev/null
    sips -z $((s*2)) $((s*2)) build/icon_1024.png --out $ICONSET/icon_${s}x${s}@2x.png >/dev/null
  done
  iconutil -c icns $ICONSET -o build/AppIcon.icns
fi
cp build/AppIcon.icns $APP/Contents/Resources/AppIcon.icns

echo "› Signing (ad hoc)"
codesign --force --deep --sign - $APP

if [[ ${1:-} == install ]]; then
  echo "› Installing to /Applications"
  rm -rf /Applications/MDReader.app
  cp -R $APP /Applications/
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/MDReader.app
  echo "Installed /Applications/MDReader.app"
fi

echo "✓ $APP"
