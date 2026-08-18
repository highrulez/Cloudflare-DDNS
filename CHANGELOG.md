# Changelog

All notable changes to Cloudflare DDNS Manager are documented in this file.

## [1.0.0] — 2026-08-18

First stable release of the self-hosted Cloudflare Dynamic DNS manager for Synology DSM and Docker.

### DNS and Cloudflare

- Multi-account Cloudflare support with encrypted API tokens
- Multiple zones and domains per account
- A and AAAA record management, including discovery and selective DDNS control
- Automatic public IPv4 and IPv6 detection with provider fallback
- Scheduled DDNS synchronization with overlap protection and restart recovery
- Cloudflare proxy and DNS-only management
- Create, check, update, force-update, stop managing, and delete-from-Cloudflare workflows
- Paginated update history with per-record results

### Operations

- Dashboard for detection status, record coverage, and recent synchronization
- System page for runtime, connectivity, scheduler, database, and deployment diagnostics
- Read-only infrastructure self-tests and sanitized diagnostics
- LAN HTTP diagnostics alongside public HTTPS reverse-proxy access
- Synology DSM and Docker host-network deployment support

### Security

- Local administrator authentication with HttpOnly server-side sessions
- Cloudflare Turnstile login protection
- Optional TOTP multi-factor authentication
- Single-use recovery codes
- Strong reauthentication for sensitive operations
- Authentication and security audit events
- Session listing and sign-out of other sessions

### Interface

- Responsive dark infrastructure console across Dashboard, DNS Records, Cloudflare, Update History, System, and Settings
