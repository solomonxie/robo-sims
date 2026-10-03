.PHONY: install test typecheck lint check-expo preview ios-build ios-install ios-run

-include Local.mk
DEVICE ?= $(error set DEVICE=<udid> or put it in Local.mk)
APP = app/ios/build/Build/Products/Release-iphoneos/RoboSims.app
BUNDLE_ID := $(or $(shell sed -n "s/^PRODUCT_BUNDLE_IDENTIFIER *= *//p" app/ios/Local.xcconfig 2>/dev/null),dev.robosims.app)

install:
	cd app && npm install && cd ios && pod install

test: check-expo
	cd app && npx jest

typecheck:
	cd app && npx tsc --noEmit

lint:
	cd app && npx eslint .

# Render a lesson's 3D view to /tmp/<lesson>.png (headless Chrome, same scene code).
preview:
	cd app && node tools/preview/shoot.mjs $(or $(LESSON),current) /tmp/$(or $(LESSON),current).png

check-expo:
	@! grep -Eq '"node_modules/(@expo/|expo["/])' app/package-lock.json || (echo "expo package found" && exit 1)

# Release build with the JS bundle embedded; Metro only runs as the bundler inside this build.
ios-build:
	cd app/ios && xcodebuild -workspace RoboSims.xcworkspace -scheme RoboSims \
	  -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build \
	  -allowProvisioningUpdates build | tail -30

ios-install:
	xcrun devicectl device install app --device $(DEVICE) $(APP)

ios-run: ios-install
	xcrun devicectl device process launch --device $(DEVICE) --terminate-existing $(BUNDLE_ID)
