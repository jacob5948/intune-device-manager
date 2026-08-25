# macOS Code Signing & Notarization

**The certificate expires 1 February 2027.** Releases built after that date will fail to
notarize until it is renewed — see [Renewing the certificate](#renewing-the-certificate).

## Why this exists

Apple Silicon requires every binary to carry a valid code signature. Unsigned arm64 apps are
rejected outright, and macOS words the rejection as *"'Intune Device Manager' is damaged and
can't be opened."* — which sounds like a corrupt download but is really a signature failure.

Before this was set up, the bundle carried only the signature the Rust linker emits
automatically (`flags=0x20002(adhoc,linker-signed)`, `Sealed Resources=none`), so it had no
`_CodeSignature/CodeResources` seal and failed validation. The Intel builds ran fine, because
unsigned x86_64 code is not held to that rule — which made the problem look target-specific
when it was really "no signature at all".

The macOS jobs now sign with a Developer ID Application certificate and notarize with Apple.

## Current setup

- **Team:** Austin Anderson — `X3LB8L82BK`
- **Signing identity:** `Developer ID Application: Austin Anderson (X3LB8L82BK)`
- **Certificate type:** Developer ID Application (for distribution outside the App Store)
- **Valid until:** 1 February 2027
- **Notarization:** App Store Connect API key (Key ID `5NG6VS8394`)

### Repository secrets

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` (certificate + private key) |
| `APPLE_CERTIFICATE_PASSWORD` | password set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Austin Anderson (X3LB8L82BK)` |
| `KEYCHAIN_PASSWORD` | arbitrary string; unlocks the temporary CI keychain |
| `APPLE_API_KEY` | App Store Connect **Key ID** — `5NG6VS8394` |
| `APPLE_API_ISSUER` | App Store Connect **Issuer UUID** |
| `APPLE_API_KEY_P8` | base64 of the `AuthKey_<KeyID>.p8` file |

`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`, `APPLE_API_ISSUER` and
`APPLE_API_KEY_PATH` are names Tauri itself reads. `KEYCHAIN_PASSWORD` and `APPLE_API_KEY_P8`
are ours, consumed only by `.github/workflows/build.yml`.

### What the workflow does

Three macOS-only steps in `.github/workflows/build.yml`, gated on the job-level
`HAS_APPLE_SIGNING` flag (the `secrets` context is not available in a step-level `if`):

1. **Check Apple signing secrets** — fails immediately if any secret is missing or empty.
   Notarization is the last thing the bundler does, so without this a typo surfaces only
   after a full release build.
2. **Import Apple signing certificate** — decodes the `.p12`, creates `build.keychain`,
   imports with `-T /usr/bin/codesign`, and sets the key partition list so `codesign` can use
   the key without a UI prompt. The keychain auto-lock timeout is raised to an hour so a slow
   Rust build cannot expire it before signing.
3. **Write App Store Connect API key** — decodes the `.p8` to
   `$RUNNER_TEMP/private_keys/AuthKey_<KeyID>.p8`, which `APPLE_API_KEY_PATH` points at.

Tauri then signs and notarizes automatically. All three steps are skipped when the secrets are
absent (forks), producing an unsigned build rather than a failure.

## Renewing the certificate

Do this **before** 1 February 2027. Existing releases keep working after expiry — the
signatures carry a secure timestamp — but new builds cannot be signed.

1. **Generate a keypair and CSR.** Keychain Access → Certificate Assistant → *Request a
   Certificate From a Certificate Authority* → **Saved to disk**. Or with openssl:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout devid.key -out devid.csr \
     -subj "/emailAddress=you@example.com/CN=Developer ID/C=US"
   ```
   The private key is generated locally and Apple never sees it. Lose it and the certificate
   is useless — there is no recovery.
2. **Request the certificate.** developer.apple.com → Certificates → **+** → **Developer ID
   Application** (not Installer, not Apple Development/Distribution). Upload the CSR,
   download the `.cer`. Only the team's **Account Holder** can create this type.
3. **Build the `.p12`:**
   ```bash
   openssl x509 -in developerID_application.cer -inform DER -out devid.pem -outform PEM
   /usr/bin/openssl pkcs12 -export -inkey devid.key -in devid.pem -out Certificates-macos.p12
   ```
   Use `/usr/bin/openssl` — see the MAC gotcha below.
4. **Update secrets:** `APPLE_CERTIFICATE` (`base64 -i Certificates-macos.p12 | pbcopy`),
   `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY` if the team name changed. Read
   the identity string out of the certificate rather than composing it by hand:
   ```bash
   openssl x509 -in devid.pem -noout -subject     # the CN= value
   security find-identity -v -p codesigning       # if installed locally
   ```
5. **Tag a release** and verify with the commands below.

The App Store Connect API key does not expire and needs no action at renewal.

## Gotchas (each of these cost a build)

- **OpenSSL 3 produces `.p12` files macOS cannot import.** It defaults to a SHA-256 MAC;
  `security import` only understands the legacy SHA-1 MAC and reports the mismatch as
  `MAC verification failed during PKCS12 import (wrong password?)` — with a *correct*
  password. Use `/usr/bin/openssl` (LibreSSL), or add `-legacy` to a Homebrew openssl
  invocation. Check with:
  ```bash
  openssl pkcs12 -in Certificates-macos.p12 -info -noout 2>&1 | head -2   # want: MAC: sha1
  ```
- **`APPLE_API_KEY` is the Key ID, not the key.** Tauri has no `APPLE_API_KEY_ID` variable
  (unlike fastlane and some third-party actions). The key material is always a file, located
  via `APPLE_API_KEY_PATH`. A wrong value here fails late with
  `App Store Connect API Key ID must be at least 3 characters`.
- **`APPLE_SIGNING_IDENTITY` must match the certificate's common name exactly**, including
  the parenthesised team ID. A mismatch fails with "no identity found".
- **Do not set `bundle.macOS.signingIdentity` in `tauri.conf.json`.** It was briefly set to
  `"-"` for ad-hoc signing; leaving it would compete with `APPLE_SIGNING_IDENTITY`.

## Verifying a release

Install the `.dmg` from the draft release, then:

```bash
APP="/Applications/Intune Device Manager.app"
codesign -dv --verbose=4 "$APP"          # chain, timestamp, stapled ticket
codesign --verify --deep --strict "$APP" # structural validity
spctl -a -vvv -t exec "$APP"             # Gatekeeper's own verdict
xcrun stapler validate "$APP"            # ticket embedded for offline launch
```

A correctly signed and notarized build shows:

```
Authority=Developer ID Application: Austin Anderson (X3LB8L82BK)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=<date>
Notarization Ticket=stapled
CodeDirectory ... flags=0x10000(runtime)
Sealed Resources version=2 rules=13 files=1

spctl: accepted
       source=Notarized Developer ID
```

`Sealed Resources` and `source=Notarized Developer ID` are the two lines that matter most —
their absence is precisely what produced the "damaged" error. Note that a correctly notarized
app passes `spctl` *while still carrying* `com.apple.quarantine`; clearing that flag is only a
workaround for old unsigned builds (v0.2.0 and earlier):

```bash
xattr -dr com.apple.quarantine "/Applications/Intune Device Manager.app"
```
