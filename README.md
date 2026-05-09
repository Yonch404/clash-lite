# Clash Lite

Clash Lite is a streamlined desktop GUI for [Mihomo](https://github.com/MetaCubeX/mihomo), focused on subscription import, proxy selection, system proxy, TUN mode, connections, logs, tray, and floating-window essentials.

Clash Lite is published as an independent application with its own data directory, update channel, package identifiers, and release repository.

## Scope

- Built on the stable Mihomo core.
- Supports remote and local profiles, profile update, proxy group switching, connection view, logs, and lightweight network status.
- Keeps TUN mode available from the sidebar, enabled by default for new configurations, and limited to a simple on/off switch plus firewall reset page.
- Keeps only the stable non-Smart core update flow.
- Uses the default theme and removes user theme editing and shortcut settings.
- Removes rules management, external resources, overrides, DNS overrides, sniffer overrides, Sub-Store, WebDAV backup, Gist runtime sync, SSID-based direct mode, and tray click swapping.

## Configuration Policy

Clash Lite avoids rewriting subscription-provided runtime settings for removed features. The controlled runtime configuration is limited to the remaining application-owned settings. Removed features have no visible entries and no background runtime hooks.

TUN mode defaults to enabled for new controlled configs, but the sidebar switch remains authoritative. If a user turns TUN off, Clash Lite keeps that state instead of forcing it back on.

## Repository

Official repository:

https://github.com/Yonch404/clash-lite

## Development

Install dependencies:

```bash
pnpm install
```

Run static checks:

```bash
pnpm run lint:check
pnpm run typecheck
```

Build packages:

```bash
pnpm run build:win
pnpm run build:mac
pnpm run build:linux
```

Development server:

```bash
pnpm run dev
```

## Project Notes

- Application name: Clash Lite
- Package name: `clash-lite`
- Core: Mihomo stable
- License: follow the upstream project license and third-party dependency licenses.
