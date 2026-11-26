import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Firebase
import FirebaseAuth
import FBSDKCoreKit
import HotUpdater

/// The app uses the UIScene life cycle. Since the iOS 27 SDK (Xcode 27) iOS
/// refuses to launch an app built without it ("UIScene life cycle is
/// required for apps built with this SDK"), so the window and React Native
/// start in `SceneDelegate`, which Info.plist's `UIApplicationSceneManifest`
/// names. Only app-wide setup stays here.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  /// The scene's window, copied here by `SceneDelegate`. Libraries still
  /// read `UIApplication.shared.delegate.window`: React Native Firebase
  /// Messaging looks at its root view to tell a push-opened launch.
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// Kept for the scene, which starts React Native once iOS gives it a
  /// window, after this method has returned.
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()
    // Facebook Login (RULES O18). Login only: automatic app events and the
    // advertiser id are switched off in Info.plist, and the JS side logs in
    // in Limited mode, so no tracking prompt is ever shown.
    ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions

    return true
  }

  /// URLs opened into the app. Under the scene life cycle iOS delivers them
  /// to `SceneDelegate`, never to `application(_:open:options:)`.
  ///
  /// Firebase Auth comes first: when it cannot prove the phone silently
  /// (always on the Simulator, and on a phone where the APNs check fails) it
  /// shows a reCAPTCHA page, and that page hands the result back by opening
  /// `REVERSED_CLIENT_ID://firebaseauth/link?...`. Without this the sheet
  /// sits on a blank page and no SMS is ever sent.
  ///
  /// Firebase also swizzles the scene delegate and may hand it the URL
  /// before calling here, so `canHandle` can already have consumed it and
  /// answer false; the `firebaseauth` host check keeps that link out of JS.
  static func isFirebaseAuthURL(_ url: URL) -> Bool {
    Auth.auth().canHandle(url) || url.host == "firebaseauth"
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // A link that cold-starts the app arrives here, not in the app's launch
    // options; React Native's Linking.getInitialURL reads it from there.
    var launchOptions = appDelegate.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url,
       !AppDelegate.isFirebaseAuthURL(url) {
      launchOptions[.url] = url
    }

    factory.startReactNative(
      withModuleName: "vokve",
      in: window,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions
    )
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      let url = context.url
      if AppDelegate.isFirebaseAuthURL(url) {
        continue
      }
      // Facebook's return from a login (`fb1351878143619705://…`). The SDK
      // answers false for anything that is not its own, which goes on to JS.
      if ApplicationDelegate.shared.application(
        UIApplication.shared,
        open: url,
        sourceApplication: context.options.sourceApplication,
        annotation: context.options.annotation
      ) {
        continue
      }
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
      _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: options)
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  /// Over-the-air updates (D-111): a release build runs the newest
  /// JavaScript bundle Hot Updater has downloaded for this native build, or
  /// the one inside the app when there is none. A debug build keeps loading
  /// from Metro.
  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    HotUpdater.bundleURL()
#endif
  }
}
