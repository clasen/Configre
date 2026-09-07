---
name: configre
description: Set up and manage Configre configuration in Node.js projects, including hostname/profile overrides, encrypted shared secrets, recipient registration, and configuration printing with secret fields omitted. Use when adopting Configre or working on its configuration files, secret sharing, or print() API.
metadata:
  category: configuration
  tags: [nodejs, config, environment, settings, secrets]
---

# Configre

Environment-specific configuration manager for Node.js. Merges public defaults, hostname or profile overrides, and optional secrets synchronously using its own deep-merge implementation.

## Instructions

### Step 1: Install the package

Requires Node.js 22.13 or later. Configre is native ESM and supports synchronous CommonJS consumers through the same implementation.

```bash
npm install configre --save
```

### Step 2: Create the config directory

Config files **must always use the `.cjs` extension**. This works in both CommonJS and ESM projects and allows using `module.exports`.

```
project/
├── config/
│   ├── index.cjs          # Default settings (required)
│   ├── myhostname.cjs     # Host-specific overrides (optional)
│   └── myhostname.dev.cjs # Dev override for host (optional)
```

### Step 3: Write the default config (`config/index.cjs`)

```javascript
module.exports = {
    db: {
        host: 'localhost',
        port: 5432,
        user: 'dev',
        password: ""
    },
    api: {
        key: "",
        url: 'http://localhost:3000'
    }
};
```

Keep credentials in `.secret.cjs` files. Public settings should contain explicit empty placeholders, not real credentials or automatic environment-variable fallbacks.

### Step 4: Write host/profile overrides

Create `config/<hostname>.cjs` with only the keys that differ — they are deep-merged over defaults:

```javascript
module.exports = {
    db: {
        user: 'prod-user'
    }
};
```

### Step 5: Load the configuration

```javascript
import Configre from "configre";
import { join } from "node:path";

const cfg = Configre(join(import.meta.dirname, "config"));

console.log(cfg.db.host); // from default
console.log(cfg.db.user); // from host override
```

CommonJS consumers can still use `const Configre = require("configre")` and `Configre(path.join(__dirname, "config"))`, without `.default` or `await`. Configuration files remain `.cjs` in either module system.

The path argument is required. Prefer an absolute path anchored to the module. Do not recommend paths derived from `process.cwd()`, such as `path.join(process.cwd(), "config")`: they can point somewhere else when the process is launched from a different directory.

To use a different config directory:

```javascript
const cfg = Configre(join(import.meta.dirname, "settings"));
```

## Profile resolution

Configre determines the active profile by looking for a `--config=<profile>` argument anywhere in `process.argv`, or falls back to `os.hostname()`. It then checks for overrides in this order (first match wins):

1. `config/<profile>.dev.cjs` — dev override
2. `config/<profile>.cjs` — production override
3. No match — uses public defaults; available secrets still apply

To force a specific profile at runtime:

```bash
node app.js --config=staging
node app.js --port=3000 --config=production --debug
```

Using `--config=` (instead of a positional argument) avoids conflicts with other CLI flags.

## Shared secrets

### Activation and file layout

Secret support activates when the base config or selected profile has a corresponding `.secret.cjs` file, or when an encrypted file already exists. There is no `secrets` option. Without either condition, Configre loads public settings without accessing an identity or creating secret artifacts. Configre never creates editable `.secret.cjs` modules itself; create them only when secret support is wanted.

For a config directory:

```text
config/
├── index.cjs
├── production.cjs
├── index.secret.cjs          # Administrator-only base secrets
├── production.secret.cjs     # Optional administrator-only profile secrets
├── production.dev.secret.cjs # Optional preferred secret profile variant
├── secrets.enc.json          # Generated ciphertext; share through Git
├── recipients/*.pub          # Public recipient keys; share through Git
└── .gitignore                # Generated exclusions for editable secrets
```

For an individual `settings.cjs` config file, sidecars are `settings.secret.cjs`, `settings.cjs.secrets.enc.json`, and `settings.cjs.recipients/`, beside the config file. An extensionless path resolving to that file uses the same sidecars. File mode selects the base secret module, not profile secret modules.

Secret modules export a plain object containing only JSON-compatible values. For example, create `config/index.secret.cjs` with empty values for the administrator to fill privately:

```javascript
module.exports = {
    db: { password: "" },
    api: { key: "" }
};
```

Empty strings remain empty. Configre does not fill values from the environment or populate `process.env`. Functions, `undefined`, accessors, symbols, custom objects, circular references, non-finite numbers, sparse arrays, and keys named `__proto__`, `constructor`, or `prototype` are rejected in secret modules.

### Merge order

For `--config=production`, later layers override earlier ones:

```text
index.cjs → selected public profile → index.secret.cjs → selected secret profile
```

Public selection prefers `production.dev.cjs` over `production.cjs`. Independently, secret selection prefers `production.dev.secret.cjs` over `production.secret.cjs`; dev and regular variants do not merge together. A selected profile secret can activate secrets without `index.secret.cjs`. Once activated, directory mode encrypts all local `.secret.cjs` files, including inactive profiles, while only base and selected profile values enter the returned config.

### Administrator and server workflow

1. On the administrator, create the needed `.secret.cjs` files and load Configre. It creates or reuses the machine identity, prepares Git exclusions and `recipients/`, and writes `secrets.enc.json`. Editable secrets must not already be tracked by Git; Configre refuses to proceed if they are. It does not untrack files or rewrite history.
2. Share the public configuration, generated `.gitignore`, recipient public keys, and ciphertext through Git. Keep editable secret modules and the private identity local. A server with ciphertext and no editable secret modules decrypts the bundle without executing secret modules.
3. On an unauthorized server, loading Configre attempts to publish `recipients/<profile>.pub` through Git. New registration requires a branch matching its upstream, Git author identity, and credentials that work without an interactive prompt. Profile names must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens.
4. On the administrator, pull the public-key registration, reload Configre, and publish the updated ciphertext. The server then pulls it and reloads Configre. Publishing a public key alone does not authorize decryption. Any authorized recipient can decrypt the whole bundle, including other profiles; profiles are not access-control boundaries.

Loading an unauthorized server config can fetch, create a public-key commit, and push it. Account for these side effects before using application startup as a verification command; use isolated fixtures for local checks unless the requested work authorizes live registration. Configre preserves unrelated staged and unstaged changes through an isolated index, runs no commit or pre-push hooks, and does not merge, rebase, force-push, or publish local tags. Already published matching keys do not create another registration commit. Conflicting keys for the same profile are not overwritten. Failed registration is retried on a later load; each registration Git command has a 30-second timeout.

While authorization is pending, Configre warns and returns public settings only: public placeholders remain and encrypted-only fields are absent. Registration failure also permits public-only startup. Do not assume successful application startup proves secrets were loaded; verify required credentials without printing their values. Invalid secret modules, damaged identities, malformed ciphertext, and authentication failures stop loading instead of silently resetting data.

### Updates, revocation, and identity

- The administrator's local `.secret.cjs` files are authoritative for values; `recipients/` is authoritative for additional recipients. Reloading updates ciphertext when values or recipients change. Unchanged inputs do not rewrite it; existing editable modules are never overwritten. Deleting every local secret module while retaining ciphertext switches to consumer behavior rather than clearing the bundle.
- To revoke a recipient, remove its public-key file on the administrator, reload, and distribute the new ciphertext. The current administrator is always included. Remove repository write access too if the machine must not register again. Old ciphertext and previously obtained credentials remain usable; rotate affected credentials when revocation requires it.
- Identity files live at `~/.config/configre/identity.pem` (private) and `identity.pub` (public). Share only the public key. Back up editable secrets and the private identity securely. On POSIX, the identity directory must have owner-only permissions (`0700`) and the private key owner-only permissions (`0600`). Private identities and secret input files cannot be symlinks.
- A missing public identity can be regenerated from a valid private key. A corrupt private identity, or a missing private identity with an existing public key, is not silently replaced. Restore the identity or deliberately register a new one. Losing all authorized private keys makes existing ciphertext unrecoverable.
- Configre uses AES-256-GCM and RSA-3072/OAEP-SHA-256 for encryption and recipient key wrapping. Ciphertext is replaced atomically under a writer lock. If a stale lock is reported after a crash, confirm its writer has stopped before removing it; do not reset ciphertext or identities as a retry strategy.

## Print configuration without secret fields

Use `print()` instead of logging the merged config object, which contains decrypted secrets:

```javascript
const cfg = Configre(join(import.meta.dirname, "config"));
cfg.print();
```

`print()` calls Configre's LemonLog `log.debug`. Enable output with `DEBUG=Configre:*`; the `--debug` argument alone does not enable these logs. File creation, ciphertext updates, and public-key publication use `log.info`; authorization failures use `log.warn`, in the same namespace.

- `cfg.print()` prints current values, including edits made after loading, without modifying `cfg` or logging automatically on load.
- Fields present in loaded base or selected profile secret modules are omitted, including when read from ciphertext. Public sibling fields remain visible; arrays supplied by secrets are omitted entirely and emptied secret objects are removed.
- Classification is by secret-file fields, not names such as `password` or `token`. Sensitive values placed only in public settings or copied to another field are not automatically detected. Keep them in secret modules and do not treat `print()` as a general-purpose redactor.
- The method is non-enumerable: it does not appear in `Object.keys(cfg)`, object spreads, or JSON output. Those operations still include secret data, so do not use them as redaction. A spread or JSON round trip does not preserve the method.
- `new Configre(configPath).print()` is also supported and prints the instance's merged settings. `.get()` still returns plain configuration data. If a configuration already has its own `print` field, that value is preserved; use the constructor's `print()` method instead.

## Examples

**Example 1: Basic setup**
User says: "Add configuration management to my Node.js project"
Actions: install configre, create `config/index.cjs` with project defaults, import Configre and load with `Configre(join(import.meta.dirname, "config"))`
Result: merged config object ready to use

**Example 2: Multi-environment**
User says: "I need different database settings per server"
Actions: create `config/index.cjs` with defaults, create `config/<hostname>.cjs` per server with db overrides
Result: each server automatically loads its own config based on hostname

**Example 3: Custom profile via CLI**
User says: "I want to run my app with a staging config"
Actions: create `config/staging.cjs`, run app with `node app.js --config=staging`
Result: staging overrides are merged over defaults, without conflicting with other CLI arguments

## Key behaviors

- **Deep merge**: nested plain objects merge recursively using Configre's own implementation; arrays merge by index and retain existing trailing entries rather than being replaced wholesale
- **Config files must use the `.cjs` extension** (`.js` is not accepted; works in both CommonJS and ESM projects)
- **Required path**: always pass the config directory or file path; prefer an absolute module-relative path over a process-relative path
- **Function vs constructor**: `Configre(path)` returns the merged config with non-enumerable `print()` when that field is available; `new Configre(path)` returns the instance with `.get()` and `.print()`
