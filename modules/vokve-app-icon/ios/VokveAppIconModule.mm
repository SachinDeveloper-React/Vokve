#import "VokveAppIconModule.h"

#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

static NSString *const kAlternatePrefix = @"AppIcon-";

/** The key the primary icon answers to — `VokveAppIconDefault` in Info.plist. */
static NSString *VokvePrimaryKey(void)
{
  id value = [NSBundle.mainBundle objectForInfoDictionaryKey:@"VokveAppIconDefault"];
  return [value isKindOfClass:NSString.class] && [value length] > 0 ? value : @"default";
}

/** Every alternate this build carries, by key, as Xcode wrote them into Info.plist. */
static NSArray<NSString *> *VokveAlternateKeys(void)
{
  NSMutableSet<NSString *> *keys = [NSMutableSet set];
  for (NSString *plistKey in @[ @"CFBundleIcons", @"CFBundleIcons~ipad" ]) {
    NSDictionary *icons = [NSBundle.mainBundle objectForInfoDictionaryKey:plistKey];
    NSDictionary *alternates = [icons isKindOfClass:NSDictionary.class] ? icons[@"CFBundleAlternateIcons"] : nil;
    if (![alternates isKindOfClass:NSDictionary.class]) {
      continue;
    }
    for (NSString *name in alternates) {
      if ([name hasPrefix:kAlternatePrefix]) {
        [keys addObject:[name substringFromIndex:kAlternatePrefix.length]];
      }
    }
  }
  return [keys.allObjects sortedArrayUsingSelector:@selector(compare:)];
}

static NSString *VokveKeyForAlternate(NSString *_Nullable alternate)
{
  if (alternate == nil) {
    return VokvePrimaryKey();
  }
  return [alternate hasPrefix:kAlternatePrefix] ? [alternate substringFromIndex:kAlternatePrefix.length] : alternate;
}

@implementation VokveAppIconModule

RCT_EXPORT_MODULE(VokveAppIcon)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  // UIApplication is main-thread only.
  dispatch_async(dispatch_get_main_queue(), ^{
    UIApplication *app = UIApplication.sharedApplication;
    NSMutableArray<NSString *> *available = [NSMutableArray arrayWithObject:VokvePrimaryKey()];
    [available addObjectsFromArray:VokveAlternateKeys()];
    resolve(@{
      @"supported" : @(app.supportsAlternateIcons),
      @"current" : VokveKeyForAlternate(app.alternateIconName),
      @"pending" : [NSNull null],
      @"available" : available,
    });
  });
}

- (void)setIcon:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIApplication *app = UIApplication.sharedApplication;
    if (!app.supportsAlternateIcons) {
      reject(@"UNSUPPORTED", @"This device cannot change the app's icon", nil);
      return;
    }

    BOOL isPrimary = [key isEqualToString:VokvePrimaryKey()];
    if (!isPrimary && ![VokveAlternateKeys() containsObject:key]) {
      reject(@"UNKNOWN_ICON", [NSString stringWithFormat:@"This build carries no icon called '%@'", key], nil);
      return;
    }

    NSString *target = isPrimary ? nil : [kAlternatePrefix stringByAppendingString:key];
    NSString *showing = app.alternateIconName;
    if ((target == nil && showing == nil) || [target isEqualToString:showing]) {
      resolve(@"unchanged");
      return;
    }

    // iOS refuses the change unless the app is in front, and says so to the
    // member with its own alert — so it is only ever asked for then.
    if (app.applicationState != UIApplicationStateActive) {
      reject(@"NOT_ACTIVE", @"The icon can only change while the app is in front", nil);
      return;
    }

    [app setAlternateIconName:target
            completionHandler:^(NSError *_Nullable error) {
              if (error != nil) {
                reject(@"SET_FAILED", error.localizedDescription, error);
              } else {
                resolve(@"applied");
              }
            }];
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeVokveAppIconSpecJSI>(params);
}

@end
