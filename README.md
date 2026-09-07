# Configre

Define your defaults once. Let each environment describe what changes. Keep secrets alongside the settings they belong to.

Configre loads a base configuration, merges in a host or profile, and returns a plain JavaScript object. Configuration lives in `.cjs` files, so you get nested objects, comments, and ordinary JavaScript. Optional secret files follow the same structure and can be shared with your servers through encrypted files in Git.

## Quick start

Requires **Node.js 22.13 or later**.

```bash
npm install configre
```

Create `config/index.cjs` with your defaults:

```javascript
module.exports = {
    db: {
        host: "localhost",
        port: 5432
    },
    api: {
        url: "https://api.example.com"
    }
};
```

Load it from `app.mjs`, next to the `config` directory:

```javascript
import Configre from "configre";
import { join } from "node:path";

const cfg = Configre(join(import.meta.dirname, "config"));
console.log(cfg.db.port); // 5432
```

```bash
node app.mjs
```

The configuration path is required. Anchor it to your module so starting the process from another directory does not change which configuration it loads. Avoid building this path from `process.cwd()`.

Configre is a native ES module. CommonJS consumers can also use the synchronous API: `require("configre")` returns the function directly. Configuration files use `.cjs` and `module.exports` in either kind of project.

## Configuration that builds on defaults

An environment should describe what changes. Everything else comes from the base.

Add `config/production.cjs`:

```javascript
module.exports = {
    db: {
        host: "db.internal",
        ssl: true
    }
};
```

Select that profile:

```bash
node app.mjs --config=production
```

The resulting configuration contains:

```javascript
{
    db: {
        host: "db.internal",
        port: 5432,
        ssl: true
    },
    api: {
        url: "https://api.example.com"
    }
}
```

`host` is overwritten, `port` is inherited, and `ssl` is added. The `api` object stays intact. A profile can extend nested objects without repeating their other fields.

### Selecting a profile

By default, Configre uses the machine's hostname. A machine named `web-01` loads `config/web-01.cjs`. Pass `--config=<profile>` to choose a name explicitly; the flag can appear alongside other application arguments.

| File | Role |
| --- | --- |
| `index.cjs` | Base configuration |
| `<profile>.cjs` | Additions and overrides for the selected profile |
| `<profile>.dev.cjs` | Preferred over `<profile>.cjs` when present |

If no profile file exists, Configre uses the base configuration. When `production.dev.cjs` exists, it is selected **instead of** `production.cjs`; those two files do not merge. This selection depends on the files present, not on `NODE_ENV`.

Objects merge recursively. Later values override matching fields. Arrays merge **by index**, rather than being replaced as a whole: `["a", "b"]` followed by `["c"]` becomes `["c", "b"]`.

## Secrets, organized like your configuration

Database credentials belong under `db`. API keys belong under `api`. Secret files keep that organization while separating sensitive values from public settings.

```text
config/
  index.cjs               # Shared public settings
  production.cjs          # Production additions and overrides
  index.secret.cjs        # Shared secrets, edited locally
  production.secret.cjs   # Production secrets, edited locally
```

A secret file exports only the fields it needs to supply. Your application reads them through ordinary properties such as `cfg.api.key`; there is no separate secrets API. Define sensitive fields in secret files; public configuration does not need placeholders for them.

For `--config=production`, the merge order is:

```text
index.cjs → production.cjs → index.secret.cjs → production.secret.cjs
```

Later layers win. Shared secrets can be extended or overwritten by profile secrets, just like public settings. Secret selection independently prefers `production.dev.secret.cjs` over `production.secret.cjs`; it does not merge the two variants.

### Add your secrets

Create `config/index.secret.cjs` for shared values:

```javascript
module.exports = {
    api: {
        key: ""
    }
};
```

For a production API key, create `config/production.secret.cjs`:

```javascript
module.exports = {
    api: {
        key: ""
    }
};
```

Fill in the values in these local files. The production key overrides the shared key when that profile is selected, while `api.url` still comes from the public configuration. Configre generates `secrets.enc.json` and adds Git exclusions for the editable secret files when your application runs.

### Share with a server

1. **Local:** run your application and push the generated encrypted file.
2. **Server:** pull and run. On the first run, Configre automatically commits and pushes the server's public key as `recipients/<profile>.pub` (or `<hostname>.pub` when no profile is specified).
3. **Local:** pull, run again to include that public key in the encrypted file, and push.
4. **Server:** pull and restart. The secrets are now available through `cfg`.

The server needs Git push access for registration. Until the updated encrypted file arrives, Configre loads public settings only.

To update secrets later, edit them locally, run, and push. Pull and restart on the server. Registration happens only once per identity.

**Profiles organize secrets; they do not isolate access.** Authorized identities can decrypt all profiles in the encrypted file. Pulling a new registration and publishing the updated encrypted file grants that identity access.

## Utilities

### Inspect configuration with `cfg.print()`

The returned configuration contains decrypted secrets. Use `cfg.print()` when inspecting it:

```javascript
const cfg = Configre(join(import.meta.dirname, "config"));
cfg.print();
```

Enable its debug output with:

```bash
DEBUG=Configre:* node app.mjs --config=production
```

`print()` omits fields supplied by the base and selected profile's secret files, including when those values come from the encrypted file. Public siblings remain visible; arrays supplied by secrets are omitted entirely. Omission is based on secret-file fields, not names such as `password` or `token`. Keep sensitive values in secret files.

It logs current values, including edits made after loading, without changing the configuration. It does not log automatically on load. The method is non-enumerable, so it stays out of `Object.keys(cfg)`, spreads, and JSON output. Spreads and JSON output still include the configuration's secret values.

The constructor API is also available:

```javascript
const config = new Configre(join(import.meta.dirname, "config"));
const cfg = config.get();
config.print();
```

If your configuration already has a field named `print`, Configre preserves it. Use the constructor API to print in that case.

### Apply environment variables explicitly

Use `applyConfigEnv(cfg.env)` when a library reads its settings from `process.env`:

```javascript
import Configre, { applyConfigEnv } from "configre";
import { join } from "node:path";

const cfg = Configre(join(import.meta.dirname, "config"));
applyConfigEnv(cfg.env);
```

For CommonJS, use `const { applyConfigEnv } = require("configre")`.

The helper converts values with `String(value)` and sets only variables that are undefined in `process.env`. Existing values, including empty strings, are preserved. An undefined `cfg.env` does nothing; null or undefined entries are skipped.

It rejects null, arrays and non-objects as `cfg.env`, empty keys, and object-valued entries. Entries are processed in order; an invalid entry throws without undoing previous assignments. Loading Configre does not call this helper automatically, and empty placeholders are never filled from environment variables automatically.

## Advanced reference

<details>
<summary>Secret formats, identities, Git behavior, and recovery</summary>

### Secret files and loading

Secret `.cjs` modules execute locally on the machine where you edit them and are reloaded on each Configre call. They must export plain objects containing JSON-compatible objects, arrays, strings, finite numbers, booleans, and `null`. Functions, `undefined`, accessors, symbols, custom objects, circular references, and properties named `__proto__`, `constructor`, or `prototype` are rejected. Servers decrypt data without executing these modules.

Secrets activate when the base or selected profile has a secret counterpart, or when the encrypted file already exists. Without either, loading public configuration creates no secret artifacts. Once active, all local profile secret files are encrypted together, including inactive profiles.

A selected profile's secret file can activate secrets without `index.secret.cjs`. A public profile alone never creates a secret counterpart. A missing profile uses the available base settings and base secrets. A checkout with an encrypted file and no editable secret files acts as a consumer. Existing ciphertext is read and validated before updates; it is not reset on startup. There is no `secrets` option, and function, constructor, ESM, and CommonJS usage share the same behavior.

For an individual configuration file, sidecars live beside it: `settings.secret.cjs`, `settings.cjs.recipients/`, and `settings.cjs.secrets.enc.json`. An extensionless path resolving to `settings.cjs` uses the same sidecars.

### Identities and registration

Automatic registration requires a Git checkout with a configured upstream, Git author name/email, and credentials that allow a non-interactive push. The branch must match its upstream before a new registration. Failed registrations are retried on the next load.

Each OS user has one identity, stored at `~/.config/configre/identity.pem` and `identity.pub`, reused across projects. Authorization is per project. A service running under another OS user needs its own registration.

Recipient files must contain a single RSA-3072 public key in PEM format, with exponent 65537, as generated by Configre. Other extensions are ignored, and duplicate keys do not add recipients. The identity encrypting the file is always included.

Registration names must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens. If another key already occupies `production.pub`, registration stops without overwriting it, and configuration loading continues with a warning and public settings only. Use a distinct profile or resolve the key replacement explicitly.

Registration uses an isolated Git index and publishes only the public-key file. It preserves unrelated staged and unstaged changes, runs no commit or pre-push hooks, and does not push local tags, merge, rebase, or force-push. Repeated loads do not publish another registration commit for the same key. Each Git command has a 30-second timeout. An authorized server loads secrets without Git commands or project writes.

Configre appends Git exclusions without removing existing rules, including when no repository exists yet. It refuses to proceed on the machine holding editable secrets if those modules are already tracked. It does not untrack files or rewrite history.

### Updates, revocation, and recovery

The editable `.secret.cjs` files are the source of truth for values; `recipients/` is the source of truth for authorization. To revoke a server, remove its public-key file, run Configre locally, and commit and push both the removal and the updated encrypted file. Remove the server's repository write access too if it must not register again. Revocation protects new encrypted versions. Rotate credentials at their providers to invalidate values a server already received.

Removing all recipient files revokes them on the next local load; old ciphertext does not restore them. Recover accidentally deleted public-key files from Git before reloading. Missing Git exclusions and ciphertext are regenerated on the machine holding editable secrets, and existing secret modules are never overwritten.

Back up editable secrets and the private identity securely. Never share or commit `identity.pem`. On POSIX, the identity directory must have owner-only permissions (`0700`), and the private file must have owner-only permissions (`0600`). On Windows, protection depends on the user profile's filesystem permissions. Private identities and secret input files cannot be symlinks.

A corrupt or missing private identity is never silently replaced. Restore it from backup, or register a new identity on a consumer. A missing public file can be regenerated from the valid private key. Losing every authorized private key makes existing ciphertext unrecoverable; surviving editable secrets can be used to create a fresh encrypted file in a new setup.

### Encryption and writes

The encrypted JSON envelope uses AES-256-GCM with a fresh content key and nonce for each update. That key is wrapped for each recipient with RSA-3072 / OAEP-SHA-256. Version and recipient metadata are authenticated. Invalid modules, malformed ciphertext, and authentication failures stop loading without replacing the existing encrypted file.

Ciphertext is replaced atomically under an exclusive writer lock. Temporary files contain only encrypted data and public metadata. After a crash, remove a reported stale `.lock` only after confirming its writer has stopped. Unchanged values and recipient keys do not cause a rewrite.

### Operational logs

With `DEBUG=Configre:*`, Configre reports identity creation, Git exclusions, recipient registration, encrypted-file updates, and successful public-key publication. These operation messages contain names and paths, never secret values or key contents. Unchanged files and previously published keys do not generate another creation or publication log.

</details>

## Resources and contributions

Explore the [basic demo](https://github.com/clasen/Configre/blob/main/demo/demo.js), [ESM project demo](https://github.com/clasen/Configre/blob/main/demo/module/demo.js), or [secrets demo](https://github.com/clasen/Configre/blob/main/demo/secrets/demo.js).

To add the Configre skill to your coding agent:

```bash
npx skills add https://github.com/clasen/Configre --skill configre
```

Found a bug or a useful improvement? [Open an issue](https://github.com/clasen/Configre/issues) or submit a pull request. A small, reproducible example helps.

## License

The MIT License (MIT)

Copyright (c) Martin Clasen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
