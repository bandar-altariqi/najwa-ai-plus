// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

import Capacitor
import Foundation
import UIKit
import UserNotifications

/**
 * Requests made with the iPhone's own network code instead of the web view,
 * for servers that refuse the web view's Origin (Hermes Agent does, unless
 * told otherwise). Same plugin name, methods and events as the Android
 * NetPlugin.java; see src/native-fetch.js for the JavaScript side.
 *
 * request({id, url, method, headers, body}) resolves with {status, headers}
 * when the answer starts; "net" events then bring {id, data} (base64) and
 * finally {id, done: true} or {id, error}. cancel({id}) stops a request.
 *
 * iOS cuts an app's connections soon after you leave it. While a request is
 * running, the app asks for the extra time iOS allows (about 30 seconds), so a
 * reply that's nearly done can finish; for longer ones the JavaScript side
 * reconnects when you come back (Hermes keeps working meanwhile).
 */
@objc(NetPlugin)
public class NetPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "NetPlugin"
    public let jsName = "Net"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "agentAsks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "agentSeen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askNotifications", returnType: CAPPluginReturnPromise)
    ]

    // Najwa AI Plus: tapping the agent's notification opens its chat.
    override public func load() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Allow needs the phone unlocked; a risky question gets only Deny.
        let allow = UNNotificationAction(identifier: "allow", title: "Allow", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: "deny", title: "Deny", options: [.destructive])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "agent-ask", actions: [allow, deny], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "agent-ask-risky", actions: [deny], intentIdentifiers: [], options: [])
        ])
    }

    /// agentAsks({title, text, chatId}): the agent on a computer asks while this
    /// chat isn't on screen. One notification per chat; a newer one replaces it.
    @objc func agentAsks(_ call: CAPPluginCall) {
        let chatId = call.getString("chatId") ?? ""
        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Najwa AI Plus"
        content.body = call.getString("text") ?? ""
        content.sound = .default
        content.threadIdentifier = "agent-\(chatId)"
        let runId = call.getString("runId") ?? ""
        content.userInfo = ["chatId": chatId, "runId": runId]
        if !runId.isEmpty {
            content.categoryIdentifier = (call.getBool("canAllow") ?? false) ? "agent-ask" : "agent-ask-risky"
        }
        let request = UNNotificationRequest(identifier: "agent-\(chatId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { _ in }
        call.resolve()
    }

    /// agentSeen({chatId}): the chat is open; its notification goes.
    @objc func agentSeen(_ call: CAPPluginCall) {
        let id = "agent-\(call.getString("chatId") ?? "")"
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
        call.resolve()
    }

    /// askNotifications(): iOS asks once whether the app may notify.
    @objc func askNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        call.resolve()
    }

    private struct Running {
        let id: String
        var call: CAPPluginCall?  // until the answer starts
        var cancelled = false
    }

    // Everything below is only touched on `queue` (URLSession's delegate queue too).
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private var running: [Int: Running] = [:]      // task id -> request
    private var tasks: [String: URLSessionDataTask] = [:]
    private var backgroundTime: UIBackgroundTaskIdentifier = .invalid  // only touched on the main thread

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        // Agents can think for a while; Hermes sends a keepalive every few seconds.
        config.timeoutIntervalForRequest = 300
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let text = call.getString("url"), let url = URL(string: text),
              url.scheme == "http" || url.scheme == "https" else {
            call.reject("Only http and https addresses work.")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        // Unpacking gzip can hold back a streamed reply.
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        for (name, value) in call.getObject("headers") ?? [:] {
            if let v = value as? String { req.setValue(v, forHTTPHeaderField: name) }
        }
        if let body = call.getString("body") { req.httpBody = Data(body.utf8) }
        let request = req
        queue.addOperation {
            let task = self.session.dataTask(with: request)
            self.running[task.taskIdentifier] = Running(id: id, call: call)
            self.tasks[id] = task
            self.updateBackgroundTime()
            task.resume()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        queue.addOperation {
            if let task = self.tasks[id] {
                self.running[task.taskIdentifier]?.cancelled = true
                task.cancel()
            }
        }
        call.resolve()
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard var r = running[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            headers[String(describing: name).lowercased()] = String(describing: value)
        }
        r.call?.resolve(["status": http.statusCode, "headers": headers])
        r.call = nil
        running[dataTask.taskIdentifier] = r
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let r = running[dataTask.taskIdentifier], !r.cancelled else { return }
        notifyListeners("net", data: ["id": r.id, "data": data.base64EncodedString()])
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let r = running.removeValue(forKey: task.taskIdentifier) else { return }
        tasks.removeValue(forKey: r.id)
        updateBackgroundTime()
        let message = r.cancelled ? "Cancelled" : error.map { describe($0, task.originalRequest?.url) }
        if let call = r.call {
            call.reject(message ?? "The server closed the connection without answering.")
        } else if let message = message {
            notifyListeners("net", data: ["id": r.id, "error": message])
        } else {
            notifyListeners("net", data: ["id": r.id, "done": true])
        }
    }

    // A reply is being written (any model, not only requests made here).
    private var replyRunning = false

    /// replying({on}): ask for the extra background time while a reply is written.
    @objc func replying(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        queue.addOperation {
            self.replyRunning = on
            self.updateBackgroundTime()
        }
        call.resolve()
    }

    // Extra time in the background while any request or reply is running (called on `queue`).
    private func updateBackgroundTime() {
        let busy = !running.isEmpty || replyRunning
        DispatchQueue.main.async {
            if busy && self.backgroundTime == .invalid {
                self.backgroundTime = UIApplication.shared.beginBackgroundTask(withName: "Najwa AI reply") {
                    self.endBackgroundTime()
                }
            } else if !busy {
                self.endBackgroundTime()
            }
        }
    }

    private func endBackgroundTime() {
        guard backgroundTime != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTime)
        backgroundTime = .invalid
    }

    // Says what went wrong in words a person can act on.
    private func describe(_ error: Error, _ url: URL?) -> String {
        let at = url.flatMap { u in u.host.map { " at \($0)\(u.port.map { ":\($0)" } ?? "")" } } ?? ""
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return error.localizedDescription }
        switch e.code {
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
            return "Couldn't find the server\(at). Check the address."
        case NSURLErrorCannotConnectToHost:
            return "Couldn't connect to the server\(at). Check that it's running, that it accepts connections from other devices, and that the phone is on the same network."
        case NSURLErrorTimedOut:
            return "The server\(at) didn't answer in time."
        case NSURLErrorNotConnectedToInternet:
            return "The phone isn't connected to a network."
        default:
            return "\(error.localizedDescription) (server\(at))"
        }
    }
}

// Najwa AI Plus: the agent's notifications show while the app is open too (on
// another chat), and a tap opens the chat ("openChat", kept until the app listens).
extension NetPlugin: UNUserNotificationCenterDelegate {
    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let chatId = info["chatId"] as? String, !chatId.isEmpty {
            let runId = info["runId"] as? String ?? ""
            if !runId.isEmpty && (response.actionIdentifier == "allow" || response.actionIdentifier == "deny") {
                notifyListeners("agentAnswer", data: ["chatId": chatId, "runId": runId, "choice": response.actionIdentifier == "allow" ? "once" : "deny"], retainUntilConsumed: true)
            } else {
                notifyListeners("openChat", data: ["chatId": chatId], retainUntilConsumed: true)
            }
        }
        completionHandler()
    }
}
