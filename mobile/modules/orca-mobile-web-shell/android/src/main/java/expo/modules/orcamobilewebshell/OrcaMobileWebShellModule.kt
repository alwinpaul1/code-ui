package expo.modules.orcamobilewebshell

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.RouteInfo
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetAddress

class OrcaMobileWebShellModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaMobileWebShell")

    // Troubleshooting's phone-VPN check, not part of the shell. It sits here because Expo builds
    // this module from mobile/modules in place, while a mobile/packages module is built from pnpm's
    // copy in node_modules and a local build only sees an edit there after `pnpm install`.
    // Read by mobile/src/diagnostics/phone-vpn-native.ts.
    AsyncFunction("phoneVpnStatus") { endpointIpv4: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      phoneVpnStatus(context, endpointIpv4)
    }

    View(OrcaMobileWebShellView::class) {
      Events("onLoadState", "onBridgeMessage", "onExternalNavigation")

      Prop("generationDirectory") { view: OrcaMobileWebShellView, value: String ->
        view.setGenerationDirectory(value)
      }

      Prop("sessionId") { view: OrcaMobileWebShellView, value: String ->
        view.setSessionId(value)
      }

      Prop("bridgeEnabled") { view: OrcaMobileWebShellView, value: Boolean ->
        view.setBridgeEnabled(value)
      }

      AsyncFunction("postBridgeMessage") { view: OrcaMobileWebShellView, json: String ->
        view.postBridgeMessage(json)
      }

      OnViewDidUpdateProps { view: OrcaMobileWebShellView ->
        view.propsDidUpdate()
      }

      OnViewDestroys { view: OrcaMobileWebShellView ->
        view.destroyWebView()
      }
    }
  }
}

/**
 * Whether this phone has a VPN up, and whether it takes the desktop's address.
 *
 * expo-network reports the active network's transport and tests WIFI before VPN, so a VPN over
 * Wi-Fi reads as plain WIFI, and Troubleshooting blamed the desktop for a phone VPN it could not
 * see (a friend's Pixel, 2026-09-27).
 *
 * - `active`: a VPN network is up, as this app's default network or anywhere the OS lists one.
 * - `carriesAppTraffic`: this app's default network is the VPN. `activeNetwork` is per-UID, so a
 *   VPN that excludes this app does not count.
 * - `routesEndpoint`: whether the VPN's routes take `endpointIpv4` into the tunnel. Null when no
 *   address was given, there is no VPN, or no VPN's routes could be read. A VPN this app bypasses
 *   routes nothing for it, so that is false.
 */
internal fun phoneVpnStatus(context: Context, endpointIpv4: String?): Map<String, Any?> {
  val connectivity =
    context.getSystemService(ConnectivityManager::class.java)
      ?: throw IllegalStateException("ConnectivityManager unavailable")
  val appNetwork = connectivity.activeNetwork
  val carriesAppTraffic = appNetwork != null && isVpn(connectivity, appNetwork)
  // Deprecated in API 31 for callbacks, and still the one call that lists every network at once.
  @Suppress("DEPRECATION")
  val vpns = connectivity.allNetworks.filter { isVpn(connectivity, it) }
  val active = carriesAppTraffic || vpns.isNotEmpty()
  val endpoint = endpointIpv4?.let(::parseIpv4Literal)
  val routesEndpoint: Boolean? =
    when {
      endpoint == null || !active -> null
      !carriesAppTraffic -> false
      else -> vpnRoutesAddress(listOfNotNull(appNetwork?.let(connectivity::getLinkProperties)), endpoint)
    }
  return mapOf(
    "active" to active,
    "carriesAppTraffic" to carriesAppTraffic,
    "routesEndpoint" to routesEndpoint
  )
}

private fun isVpn(connectivity: ConnectivityManager, network: Network): Boolean =
  connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ==
    true

/**
 * Longest-prefix match over the VPN's routes, as the kernel picks. A best match that throws or is
 * unreachable (how `VpnService.Builder.excludeRoute` and "allow LAN" settings leave a subnet out)
 * sends the address back to the underlying network. No match at all does the same. Null when no
 * route list could be read.
 */
private fun vpnRoutesAddress(links: List<LinkProperties>, address: InetAddress): Boolean? {
  if (links.isEmpty()) {
    return null
  }
  val best =
    links
      .flatMap { it.routes }
      .filter { it.matches(address) }
      .maxByOrNull { it.destination.prefixLength }
      ?: return false
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    return best.type == RouteInfo.RTN_UNICAST
  }
  return true
}

/** A dotted-quad IPv4 literal as an address, or null. Never resolves a name. */
private fun parseIpv4Literal(text: String): InetAddress? {
  val octets = text.split('.')
  if (octets.size != 4) {
    return null
  }
  val bytes = ByteArray(4)
  for ((index, octet) in octets.withIndex()) {
    if (octet.isEmpty() || octet.length > 3 || !octet.all(Char::isDigit)) {
      return null
    }
    val value = octet.toInt()
    if (value > 255) {
      return null
    }
    bytes[index] = value.toByte()
  }
  return InetAddress.getByAddress(bytes)
}
