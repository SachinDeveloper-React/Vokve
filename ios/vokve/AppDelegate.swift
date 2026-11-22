import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Firebase
import FirebaseAuth

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "vokve",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  /// URLs opened into the app. Firebase Auth comes first: when it cannot
  /// prove the phone silently (always on the Simulator, and on a phone where
  /// the APNs check fails) it shows a reCAPTCHA page, and that page hands the
  /// result back by opening `REVERSED_CLIENT_ID://firebaseauth/link?...`.
  ///
  /// This method must be written out here. Firebase's AppDelegate swizzling
  /// only wraps `application(_:open:options:)` when the app already
  /// implements it; without it the callback is dropped, the reCAPTCHA sheet
  /// sits on a blank page and no SMS is ever sent.
  ///
  /// Once this exists the swizzled copy also hands the URL to Firebase before
  /// calling here, so by now `canHandle` may already have consumed it and
  /// answer false; the `firebaseauth` host check keeps that link out of JS.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if Auth.auth().canHandle(url) || url.host == "firebaseauth" {
      return true
    }
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
