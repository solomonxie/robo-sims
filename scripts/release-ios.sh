#!/bin/sh
# Archive a Release build and upload it to App Store Connect.
# Needs: Xcode → Settings → Accounts signed in to the developer Apple ID,
# and app/ios/Local.xcconfig with DEVELOPMENT_TEAM (see Local.xcconfig.example).
# Build number defaults to a timestamp; the version is MARKETING_VERSION in project.pbxproj.
#
# Usage: scripts/release-ios.sh [build-number]
set -e
cd "$(dirname "$0")/../app/ios"

[ -f Local.xcconfig ] || { echo "missing app/ios/Local.xcconfig — cp Local.xcconfig.example Local.xcconfig"; exit 1; }

SCHEME=RoboSims
BUILD=${1:-$(date +%Y%m%d%H%M)}
OUT=/tmp/robosims-release
ARCHIVE=$OUT/$SCHEME-$BUILD.xcarchive

xcodebuild -workspace "$SCHEME.xcworkspace" -scheme "$SCHEME" \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD" archive

xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$OUT/export" -allowProvisioningUpdates

echo "Uploaded build $BUILD. Processing in App Store Connect takes 15–60 min."
