package expo.modules.orcaclaudesession

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The claude.ai web session of each Code UI account, kept on the phone so the artifact viewer
 * (mobile/src/session/MobileArtifactViewer.tsx) opens signed in as the account that owns the
 * artifact. mobile/src/session/claude-ai-session.ts is the only caller.
 *
 * Why it exists: Code UI's account sign-in is Claude Code's OAuth, a bearer for api.anthropic.com.
 * claude.ai's pages authenticate with the `sessionKey` and `lastActiveOrg` cookies instead, and
 * nothing trades one for the other. The Claude Android app 1.261013.20 keeps its own claude.ai
 * session and writes those two cookies into the WebView's CookieManager for https://claude.ai and
 * https://preview.claude.ai just before it loads an artifact (a22.java b/c). This does the same,
 * with a session captured once from a claude.ai sign-in in Code UI's own WebView.
 *
 * THE SESSION KEY NEVER LEAVES THIS FILE. No function returns it, nothing logs it (log lines name
 * an exception's class only), and JavaScript only ever sees the organization uuid
 * (`lastActiveOrg`, which claude.ai itself puts in a non-HttpOnly cookie) and booleans.
 *
 * Storage: plain SharedPreferences holding AES-256-GCM ciphertext under a key that lives in the
 * AndroidKeyStore and cannot be exported. androidx.security:security-crypto is not on the app's
 * classpath, and this is what its EncryptedSharedPreferences does underneath. If the key is gone
 * (a restore to a new device, a lock-screen reset on some OEMs) a stored entry cannot be read; it
 * is dropped and the account reads as not connected, so the user signs in to claude.ai again.
 *
 * The functions:
 *  - peekClaudeSession() -> { signedIn, org }: what the WebView's jar holds for claude.ai now.
 *    `signedIn` is true only with exactly one distinct sessionKey value (two would be two sessions
 *    mixed, and this refuses to guess which is whose). `org` is lastActiveOrg or null.
 *  - captureClaudeSession(accountId, expectedOrg) -> { org, stored }: stores the jar's session for
 *    the account only when its lastActiveOrg equals expectedOrg. On a mismatch it stores nothing
 *    and clears the jar's claude.ai cookies, so the other account's session is not left behind to
 *    open artifacts as the wrong account. The JavaScript side compares first (and says which
 *    account it was); this check is the same rule again where the secret is.
 *  - seedClaudeSession(accountId) -> Boolean: replaces the jar's claude.ai session with the
 *    account's (the old cookies are expired first, so two accounts never mix). With nothing
 *    stored it still clears the jar's session and answers false, so a previous account's session
 *    cannot answer for this one.
 *  - hasClaudeSession(accountId) -> Boolean.
 *  - clearClaudeSession(accountId): forgets the account's session, and clears the jar too when
 *    the jar holds that same session.
 *  - clearAllClaudeSessions(): forgets every account's session and clears the jar.
 *  - clearClaudeCookies(): expires every claude.ai cookie in the jar (before a sign-in starts, so
 *    claude.ai asks who is signing in instead of reusing whoever was there).
 *  - lastClaudeSessionAccount() -> String?: the account most recently seeded.
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaClaudeSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaClaudeSession")

    AsyncFunction("peekClaudeSession") {
      val jar = readJar()
      mapOf("signedIn" to (jar.sessionKey != null), "org" to jar.org)
    }

    AsyncFunction("captureClaudeSession") { accountId: String, expectedOrg: String ->
      val jar = readJar()
      if (jar.sessionKey == null || jar.org == null) {
        return@AsyncFunction mapOf("org" to jar.org, "stored" to false)
      }
      if (expectedOrg.isEmpty() || jar.org != expectedOrg) {
        expireCookies(allClaudeCookieNames())
        return@AsyncFunction mapOf("org" to jar.org, "stored" to false)
      }
      val stored = write(accountId, Session(jar.sessionKey, jar.org))
      mapOf("org" to jar.org, "stored" to stored)
    }

    AsyncFunction("seedClaudeSession") { accountId: String ->
      expireCookies(SESSION_COOKIES)
      val session = read(accountId) ?: return@AsyncFunction false
      val cookies = CookieManager.getInstance()
      for (host in HOSTS) {
        for (cookie in seedCookies(session)) {
          cookies.setCookie("https://$host", cookie)
        }
      }
      cookies.flush()
      prefs().edit().putString(LAST_KEY, accountId).apply()
      true
    }

    AsyncFunction("hasClaudeSession") { accountId: String -> read(accountId) != null }

    AsyncFunction("clearClaudeSession") { accountId: String ->
      val session = read(accountId)
      val edit = prefs().edit().remove(entryKey(accountId))
      if (prefs().getString(LAST_KEY, null) == accountId) {
        edit.remove(LAST_KEY)
      }
      edit.apply()
      if (session != null && readJar().sessionKey == session.sessionKey) {
        expireCookies(SESSION_COOKIES)
      }
    }

    AsyncFunction("clearAllClaudeSessions") {
      prefs().edit().clear().apply()
      expireCookies(allClaudeCookieNames())
    }

    AsyncFunction("clearClaudeCookies") { expireCookies(allClaudeCookieNames()) }

    AsyncFunction("lastClaudeSessionAccount") { prefs().getString(LAST_KEY, null) }
  }

  private data class Session(val sessionKey: String, val org: String)

  private data class Jar(val sessionKey: String?, val org: String?)

  private fun context(): Context =
    appContext.reactContext ?: throw IllegalStateException("no React context")

  private fun prefs(): SharedPreferences = context().getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun entryKey(accountId: String) = "session:$accountId"

  /** The jar's cookies for https://claude.ai as name/value pairs (getCookie's "a=b; c=d"). */
  private fun jarPairs(host: String): List<Pair<String, String>> =
    (CookieManager.getInstance().getCookie("https://$host") ?: "")
      .split(";")
      .map { it.trim() }
      .filter { it.isNotEmpty() }
      .map { pair -> pair.substringBefore('=') to pair.substringAfter('=', "") }

  private fun readJar(): Jar {
    val pairs = jarPairs(HOSTS[0])
    val keys = pairs.filter { it.first == SESSION_KEY && it.second.isNotEmpty() }.map { it.second }.distinct()
    val orgs = pairs.filter { it.first == ORG_KEY && it.second.isNotEmpty() }.map { it.second }.distinct()
    return Jar(keys.singleOrNull(), orgs.singleOrNull())
  }

  private fun allClaudeCookieNames(): Set<String> =
    HOSTS.flatMap { host -> jarPairs(host).map { it.first } }.toSet() + SESSION_COOKIES

  /**
   * Expires the named cookies on both hosts, as the host-only cookie a22.c writes and as the
   * `Domain=claude.ai` cookie claude.ai's own sign-in may set (nn30.l clears that shape). Either
   * one left behind would be sent beside the new session.
   */
  private fun expireCookies(names: Collection<String>) {
    val cookies = CookieManager.getInstance()
    for (host in HOSTS) {
      for (name in names) {
        cookies.setCookie("https://$host", "$name=; Path=/; Secure; Max-Age=0")
        cookies.setCookie("https://$host", "$name=; Domain=${HOSTS[0]}; Path=/; Secure; Max-Age=0")
      }
    }
    cookies.flush()
  }

  /**
   * The two cookies exactly as the Claude app builds them (a22.b), minus the "; Max-Age=3" its
   * a22.c appends. That app can afford a three-second cookie because its own OkHttp client adds
   * `cookie: sessionKey=…` to the requests it makes (s03.java); this WebView makes every request
   * itself, and claude.ai's shell keeps calling /api for as long as the page is open, so a cookie
   * that expired three seconds in would sign the page out under the user. These are session
   * cookies instead (no Max-Age, no Expires): seedClaudeSession writes them again before every
   * artifact the viewer opens, and the next seed for another account expires them first.
   */
  private fun seedCookies(session: Session): List<String> =
    listOf(
      "$SESSION_KEY=${session.sessionKey}; Path=/; Secure; HttpOnly; SameSite=Lax",
      "$ORG_KEY=${session.org}; Path=/; Secure; SameSite=Lax"
    )

  private fun read(accountId: String): Session? {
    val raw = prefs().getString(entryKey(accountId), null) ?: return null
    return try {
      val iv = Base64.decode(raw.substringBefore('.'), Base64.NO_WRAP)
      val sealed = Base64.decode(raw.substringAfter('.'), Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
      val plain = String(cipher.doFinal(sealed), Charsets.UTF_8)
      val org = plain.substringBefore('\n')
      val sessionKey = plain.substringAfter('\n', "")
      if (org.isEmpty() || sessionKey.isEmpty()) null else Session(sessionKey, org)
    } catch (error: Exception) {
      // An entry the key cannot open is as good as none: drop it so the account reads as not
      // connected and the user is asked to sign in again.
      Log.w(TAG, "a stored claude.ai session could not be read: ${error.javaClass.simpleName}")
      prefs().edit().remove(entryKey(accountId)).apply()
      null
    }
  }

  private fun write(accountId: String, session: Session): Boolean =
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val sealed = cipher.doFinal("${session.org}\n${session.sessionKey}".toByteArray(Charsets.UTF_8))
      val value = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(sealed, Base64.NO_WRAP)
      prefs().edit().putString(entryKey(accountId), value).commit()
    } catch (error: Exception) {
      Log.w(TAG, "the claude.ai session could not be stored: ${error.javaClass.simpleName}")
      false
    }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private companion object {
    const val TAG = "OrcaClaudeSession"
    const val PREFS = "orca_claude_session"
    const val LAST_KEY = "last"
    const val KEYSTORE = "AndroidKeyStore"
    const val KEY_ALIAS = "orca_claude_session_aes"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val SESSION_KEY = "sessionKey"
    const val ORG_KEY = "lastActiveOrg"
    val SESSION_COOKIES = listOf(SESSION_KEY, ORG_KEY)
    /** a22.c's two hosts: the artifact shell and its preview frames. */
    val HOSTS = listOf("claude.ai", "preview.claude.ai")
  }
}
