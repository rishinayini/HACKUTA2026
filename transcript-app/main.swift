// NoteWorthy: one Mac app for the chat logs and the live transcript. A menu bar icon, and a
// panel against the right edge of the screen, above other windows, showing the web app in its
// mini layout (http://localhost:8443/?mini=1, served by front-end's dev server): log in, home,
// the meeting, chat logs and settings. When a FaceTime call starts the panel comes forward on
// the chat log of that call, with the transcript filling in live. It never hides by itself.
// Click the menu bar icon to show or hide it; right-click for Reload and Quit.
// Build with ./build.sh. Set NOTEWORTHY_URL to show a different address.
import Cocoa
import WebKit

/// A borderless panel that can still take the keyboard, so the log-in form can be typed in.
final class KeyPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var panel: KeyPanel!
  private var web: WKWebView!
  private var item: NSStatusItem!
  private let width: CGFloat = 430
  private let url = URL(string: ProcessInfo.processInfo.environment["NOTEWORTHY_URL"] ?? "http://localhost:8443/?mini=1")!

  func applicationDidFinishLaunching(_ notification: Notification) {
    panel = KeyPanel(contentRect: dockedFrame(), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
    panel.level = .floating
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

    web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    web.navigationDelegate = self
    panel.contentView = web
    web.load(URLRequest(url: url))

    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = NSImage(systemSymbolName: "text.bubble", accessibilityDescription: "NoteWorthy")
    item.button?.target = self
    item.button?.action = #selector(clicked)
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

    // No menu bar of its own is shown, but its key equivalents still work in the panel.
    let menu = NSMenu()
    let edit = NSMenuItem()
    edit.submenu = NSMenu(title: "Edit")
    edit.submenu?.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.submenu?.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.submenu?.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.submenu?.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    menu.addItem(edit)
    NSApp.mainMenu = menu

    NotificationCenter.default.addObserver(self, selector: #selector(screenChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    show()
  }

  /// Full height against the right edge of the main screen, below the menu bar.
  private func dockedFrame() -> NSRect {
    let screen = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
    return NSRect(x: screen.maxX - width, y: screen.minY, width: width, height: screen.height)
  }

  private func show() { panel.setFrame(dockedFrame(), display: true); panel.orderFrontRegardless() }
  private func hide() { panel.orderOut(nil) }
  @objc private func screenChanged() { if panel.isVisible { panel.setFrame(dockedFrame(), display: true) } }

  @objc private func clicked() {
    if NSApp.currentEvent?.type == .rightMouseUp {
      let menu = NSMenu()
      menu.addItem(withTitle: panel.isVisible ? "Hide NoteWorthy" : "Show NoteWorthy", action: #selector(toggle), keyEquivalent: "").target = self
      menu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "").target = self
      menu.addItem(.separator())
      menu.addItem(withTitle: "Quit NoteWorthy", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
      item.menu = menu
      item.button?.performClick(nil)
      item.menu = nil
    } else { toggle() }
  }
  @objc private func toggle() { if panel.isVisible { hide() } else { show(); NSApp.activate(ignoringOtherApps: true); panel.makeKey() } }
  @objc private func reload() { web.load(URLRequest(url: url)) }

  // Opening the app again shows the panel: the dev server does this when a call starts.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { show(); return false }

  // The web app's server may not be up yet: keep trying until the page loads.
  private func retry() { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.reload() } }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry() }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
