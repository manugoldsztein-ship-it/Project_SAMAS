import UIKit
import Capacitor
import WebKit

// ============================================================
// iOS Dynamic Type → JS bridge (samas-0.4.20)
// ============================================================
// Reads UIApplication.shared.preferredContentSizeCategory and pushes
// a numeric scale into JS via window.__SAMAS_TYPE_SCALE__ +
// dispatches the custom event "samas:type-scale-changed". The JS
// side (src/lib/dynamicType.jsx) listens and applies the scale via
// CSS zoom on the root container.
//
// Mapping mirrors UIKit's own "preferredFontSizeMultiplier" for the
// body text style. Accessibility sizes (AX1-AX5) are clamped at 2.0
// — beyond that the layout breaks more than it helps.
//
// Updates land at:
//   - app launch (didFinishLaunching)
//   - app foreground (applicationDidBecomeActive — covers the
//     case where the user changed Text Size in Settings while we
//     were backgrounded)
//   - on UIContentSizeCategoryDidChangeNotification (live, when
//     user drags the Control Center slider while we're foreground)
// ============================================================

func samasScaleFor(_ category: UIContentSizeCategory) -> Double {
    switch category {
    case .extraSmall:                        return 0.85
    case .small:                             return 0.90
    case .medium:                            return 0.95
    case .large:                             return 1.00  // default
    case .extraLarge:                        return 1.10
    case .extraExtraLarge:                   return 1.20
    case .extraExtraExtraLarge:              return 1.30
    case .accessibilityMedium:               return 1.45
    case .accessibilityLarge:                return 1.60
    case .accessibilityExtraLarge:           return 1.80
    case .accessibilityExtraExtraLarge:      return 1.95
    case .accessibilityExtraExtraExtraLarge: return 2.00
    default:                                 return 1.00
    }
}

func samasPushTypeScaleToJS() {
    let cat = UIApplication.shared.preferredContentSizeCategory
    let scale = samasScaleFor(cat)
    // Find the active CAPBridgeViewController to grab the WKWebView.
    // Capacitor 8 puts it as the rootViewController in the keyWindow.
    DispatchQueue.main.async {
        guard let scenes = UIApplication.shared.connectedScenes as? Set<UIScene> else { return }
        for scene in scenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                guard let bridgeVC = window.rootViewController as? CAPBridgeViewController else { continue }
                guard let webView = bridgeVC.bridge?.webView else { continue }
                let js = """
                  (function(){
                    var s = \(scale);
                    window.__SAMAS_TYPE_SCALE__ = s;
                    try {
                      window.dispatchEvent(new CustomEvent('samas:type-scale-changed', { detail: { scale: s } }));
                    } catch(e) {}
                  })();
                """
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Listen for Dynamic Type changes while foreground (the user
        // dragging the Control Center slider). The push to JS happens
        // on a slight delay so the WebView has had time to load.
        NotificationCenter.default.addObserver(
            forName: UIContentSizeCategory.didChangeNotification,
            object: nil, queue: .main
        ) { _ in samasPushTypeScaleToJS() }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        // samas-0.4.20: re-push Dynamic Type scale on foreground in case
        // the user changed Text Size in Settings while we were backgrounded.
        samasPushTypeScaleToJS()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
