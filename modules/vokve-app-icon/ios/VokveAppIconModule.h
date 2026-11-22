#import <Foundation/Foundation.h>

#ifdef __cplusplus
#import <VokveAppIconSpec/VokveAppIconSpec.h>
#endif

NS_ASSUME_NONNULL_BEGIN

/**
 * The `VokveAppIcon` TurboModule on iOS: UIKit's alternate app icons.
 *
 * Icons are named by key. The primary icon's key is the app's
 * `VokveAppIconDefault` Info.plist entry; every other one is the alternate
 * icon set `AppIcon-<key>`, which Xcode lists under CFBundleAlternateIcons
 * from ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES.
 */
#ifdef __cplusplus
@interface VokveAppIconModule : NSObject <NativeVokveAppIconSpec>
#else
@interface VokveAppIconModule : NSObject
#endif
@end

NS_ASSUME_NONNULL_END
