// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import Security

/**
 * Google sign-in for Drive sync on iPhone and iPad. Same plugin name and
 * methods as the Android GoogleAuthPlugin.java (which uses Play services):
 *
 * status() resolves with {configured}: whether this build has a client ID
 * (without one, the app doesn't offer Google Drive sync on iPhone).
 * authorize({interactive, chooseAccount}) resolves with {accessToken}. With a
 * saved sign-in it renews the token quietly; otherwise, if interactive, it
 * shows Google's sign-in page in Apple's secure sheet
 * (ASWebAuthenticationSession, with PKCE). Without a sign-in and not
 * interactive it rejects with NEEDS_SIGN_IN. chooseAccount (setting up sync)
 * skips the saved sign-in and lets the user pick any Google account.
 * clearToken({token}) forgets nothing that matters (tokens are renewed from
 * the saved sign-in). signOut() revokes the sign-in and forgets it.
 *
 * Only the app's own hidden Drive folder is asked for (drive.appdata), as on
 * Android and desktop. The sign-in (a refresh token) is kept in the Keychain.
 * The OAuth client is the "iOS" client from Google Cloud; its ID is read from
 * Info.plist (GoogleIOSClientID). iOS clients have no secret.
 */
@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    private static let scope = "https://www.googleapis.com/auth/drive.appdata"
    private static let keychainService = "com.bandaraltariqi.najwa.plus.google-sign-in"
    private static let keychainAccount = "refresh-token"

    private var session: ASWebAuthenticationSession?

    private var clientId: String? {
        let id = Bundle.main.object(forInfoDictionaryKey: "GoogleIOSClientID") as? String
        return (id?.isEmpty == false) ? id : nil
    }

    // "123-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.123-abc"
    private func redirectScheme(_ clientId: String) -> String {
        let prefix = clientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        return "com.googleusercontent.apps.\(prefix)"
    }

    // MARK: - Plugin methods

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["configured": clientId != nil])
    }

    @objc func authorize(_ call: CAPPluginCall) {
        guard let clientId = clientId else {
            call.reject("Google sign-in isn't set up in this version of the app yet. Use GitHub sync for now.", "NOT_CONFIGURED")
            return
        }
        let interactive = call.getBool("interactive") ?? false
        if interactive && (call.getBool("chooseAccount") ?? false) {
            signIn(clientId: clientId, call: call)
        } else if let refresh = Self.loadRefreshToken() {
            refreshAccessToken(clientId: clientId, refreshToken: refresh) { result in
                switch result {
                case .success(let token):
                    call.resolve(["accessToken": token])
                case .failure(let error as AuthError) where error == .revoked:
                    Self.deleteRefreshToken()
                    if interactive { self.signIn(clientId: clientId, call: call) } else { self.needsSignIn(call) }
                case .failure(let error):
                    self.reject(call, error)
                }
            }
        } else if interactive {
            signIn(clientId: clientId, call: call)
        } else {
            needsSignIn(call)
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func signOut(_ call: CAPPluginCall) {
        if let refresh = Self.loadRefreshToken() {
            var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
            req.httpMethod = "POST"
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            req.httpBody = Self.form(["token": refresh])
            URLSession.shared.dataTask(with: req).resume()
        }
        Self.deleteRefreshToken()
        call.resolve()
    }

    // MARK: - Sign-in (authorization code with PKCE)

    private func signIn(clientId: String, call: CAPPluginCall) {
        let verifier = Self.randomString(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = Self.randomString(24)
        let scheme = redirectScheme(clientId)
        let redirect = "\(scheme):/oauth2redirect"
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: Self.scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            // Always ask which account, so a different one can be picked.
            URLQueryItem(name: "prompt", value: "select_account consent")
        ]
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: scheme) { callback, error in
                self.session = nil
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("Google sign-in was cancelled.", "CANCELLED")
                    return
                }
                guard let callback = callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems else {
                    call.reject(error?.localizedDescription ?? "Google sign-in didn't finish.", "FAILED")
                    return
                }
                let value = { (name: String) in items.first(where: { $0.name == name })?.value }
                guard value("state") == state, let code = value("code") else {
                    call.reject(value("error").map { "Google sign-in failed (\($0))." } ?? "Google sign-in didn't finish.", "FAILED")
                    return
                }
                self.exchange(clientId: clientId, code: code, verifier: verifier, redirect: redirect, call: call)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Couldn't open Google sign-in.", "FAILED")
            }
        }
    }

    private func exchange(clientId: String, code: String, verifier: String, redirect: String, call: CAPPluginCall) {
        tokenRequest([
            "grant_type": "authorization_code",
            "client_id": clientId,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect
        ]) { result in
            switch result {
            case .success(let json):
                guard let access = json["access_token"] as? String else {
                    call.reject("Google didn't send a sign-in token.", "FAILED")
                    return
                }
                if let refresh = json["refresh_token"] as? String { Self.saveRefreshToken(refresh) }
                call.resolve(["accessToken": access])
            case .failure(let error):
                self.reject(call, error)
            }
        }
    }

    private func refreshAccessToken(clientId: String, refreshToken: String, done: @escaping (Result<String, Error>) -> Void) {
        tokenRequest([
            "grant_type": "refresh_token",
            "client_id": clientId,
            "refresh_token": refreshToken
        ]) { result in
            done(result.flatMap { json in
                if let access = json["access_token"] as? String { return .success(access) }
                return .failure(AuthError.failed("Google didn't send a sign-in token."))
            })
        }
    }

    // MARK: - Helpers

    private enum AuthError: Error, Equatable {
        case revoked
        case network(String)
        case failed(String)
    }

    private func tokenRequest(_ fields: [String: String], done: @escaping (Result<[String: Any], Error>) -> Void) {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = Self.form(fields)
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error = error {
                done(.failure(AuthError.network(error.localizedDescription)))
                return
            }
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 200 {
                done(.success(json))
            } else if json["error"] as? String == "invalid_grant" {
                done(.failure(AuthError.revoked))
            } else {
                let detail = (json["error_description"] as? String) ?? (json["error"] as? String) ?? "HTTP \(status)"
                done(.failure(AuthError.failed("Google sign-in failed (\(detail)).")))
            }
        }.resume()
    }

    private func needsSignIn(_ call: CAPPluginCall) {
        call.reject("Sign in to Google again in Settings → Sync.", "NEEDS_SIGN_IN")
    }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        switch error as? AuthError {
        case .network(let message): call.reject("Couldn't reach Google (\(message)).", "NETWORK")
        case .failed(let message): call.reject(message, "FAILED")
        case .revoked: needsSignIn(call)
        case nil: call.reject(error.localizedDescription, "FAILED")
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }

    private static func form(_ fields: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value)"
        }.joined(separator: "&").data(using: .utf8)!
    }

    private static func randomString(_ length: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return String(bytes.map { chars[Int($0) % chars.count] })
    }

    // MARK: - Keychain

    private static var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: keychainService,
         kSecAttrAccount as String: keychainAccount]
    }

    private static func loadRefreshToken() -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func saveRefreshToken(_ token: String) {
        deleteRefreshToken()
        var query = keychainQuery
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func deleteRefreshToken() {
        SecItemDelete(keychainQuery as CFDictionary)
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
