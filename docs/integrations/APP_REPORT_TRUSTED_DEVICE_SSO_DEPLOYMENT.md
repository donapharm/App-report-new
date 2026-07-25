# App Report trusted-device SSO — deployment checklist

Status: review only; this change does not deploy or restart production.

## App Report configuration

Configure through the approved backend secret channel only:

- `TRUSTED_DEVICE_REPORT_S2S_TOKEN`: raw token dedicated to App Report, at least 32 characters;
- `TRUSTED_DEVICE_REPORT_TIMEOUT_MS`: optional, default `5000`, clamped to 500–10000 ms.
- `TRUSTED_DEVICE_REPORT_START_RATE_LIMIT_PER_MINUTE`: optional, default `10`;
- `TRUSTED_DEVICE_REPORT_CONSUME_RATE_LIMIT_PER_MINUTE`: optional, default `10`.

The raw token must not be placed in a `VITE_*` variable, frontend bundle, source control, chat, screenshots, or logs. App Report does not own or receive App Sale's assertion-signing key.

## Enablement order

1. Apply App Sale migration `0103_trusted_device_report_replay.sql`.
2. Configure the exact allowed origin `https://report.donapharm.asia` in App Sale.
3. Provision App Sale's assertion key and prefixed S2S token hash through its approved secret channel.
4. Provision the matching raw App Report S2S token through a separate approved secret channel.
5. Deploy the paired App Sale contract v3 change that accepts verify without browser-visible `expectedEmployeeCode`.
6. Run App Sale verify/consume contract tests with mock credentials, then request separate approval for production config and deploy.
7. After approved deployment, verify that untrusted, malformed, timeout, 4xx/5xx and replay cases still show the existing OTP flow.

## Live acceptance gate

The live acceptance test **“máy tin cậy mở App Report không hỏi OTP”** can run only after all prerequisites above are complete: App Sale migration `0103`, origin `report.donapharm.asia`, App Sale key/hash, and App Report raw S2S token have been provisioned through secret channels, followed by a separate approval for deployment/configuration.
