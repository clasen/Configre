---
name: configre
description: Set up or edit Configre configuration in Node.js projects, including profile overrides, encrypted secrets, safe printing, and explicit environment-variable application.
metadata:
  category: configuration
  tags: [nodejs, config, environment, settings, secrets]
---

# Configre

Load public defaults, extend or overwrite them by profile, and merge optional secrets synchronously.

## Setup and loading

Install with `npm install configre`; requires Node.js 22.13 or later.
Configuration files use `.cjs` and `module.exports`, including in ESM projects.
The path is required. Anchor it to the module; avoid deriving it from `process.cwd()`.

```javascript
import Configre from "configre";
import { join } from "node:path";

const cfg = Configre(join(import.meta.dirname, "config"));
```

Create `config/index.cjs` for defaults and `config/production.cjs` for additions or overrides.
Keep sensitive public placeholders as `""`; put actual values in secret files.
CommonJS supports `require("configre")` directly, without `.default` or `await`.
`Configre(path)` returns configuration; `new Configre(path)` exposes `.get()` and `.print()`.

## Profiles and merge behavior

- Select with `--config=production` anywhere in the application arguments; otherwise use `os.hostname()`.
- Prefer `<profile>.dev.cjs` over `<profile>.cjs` when present, independently of `NODE_ENV`.
- Select one public profile; dev and regular variants do not merge. Missing profiles use defaults.
- Objects merge recursively: preserve unspecified fields, override matching values, and add new fields.
- Arrays merge by index and retain trailing entries; they are not replaced wholesale.
- Merge order: public base → public profile → secret base → secret profile.
- Independently prefer `<profile>.dev.secret.cjs` over `<profile>.secret.cjs`.

## Secrets

Create `index.secret.cjs` for shared secrets and `<profile>.secret.cjs` for profile secrets:

```javascript
module.exports = {
    db: { password: "" },
    api: { key: "" }
};
```

- Secret modules supply only the needed fields; consumers read ordinary properties such as `cfg.api.key`.
- Activate when the base or selected profile has a secret counterpart, or ciphertext already exists.
- Without either condition, load public settings without identity access or secret artifacts.
- Configre never creates editable secret modules. There is no `secrets` option.
- Export plain objects containing JSON-compatible values; empty strings remain empty.
- Reject functions, undefined, accessors, symbols, custom objects, cycles, sparse arrays, non-finite numbers, and keys named `__proto__`, `constructor`, or `prototype`.
- Once active, encrypt all local profile secrets together; merge only the base and selected profile.
- Every authorized identity can decrypt every profile. Profiles organize values, not access.
- Editable secrets are authoritative for values; `recipients/` is authoritative for additional recipients.
- With ciphertext and no editable secret modules, load as a consumer; deleting local modules does not clear secrets.
- Individual `settings.cjs` files use `settings.secret.cjs`, `settings.cjs.secrets.enc.json`, and `settings.cjs.recipients/`; file mode has no secret profiles.

### Sharing and updates

1. Local: create secret files and run; Configre generates ciphertext and Git exclusions. Push the encrypted file.
2. Server: pull and run; Configre automatically commits and pushes `recipients/<profile>.pub`.
3. Local: pull, run to incorporate the public key, and push the updated ciphertext.
4. Server: pull and restart. Later secret updates repeat the local run/push and server pull/restart.

Registration needs a branch matching its upstream, Git author identity, and non-interactive push access.
Pending authorization or failed registration returns public settings only; malformed secrets, identities, and ciphertext stop loading.
Use isolated fixtures for verification unless live registration is authorized: loading can fetch, commit, and push.
Registration preserves unrelated changes, skips hooks, rejects key-name collisions, and retries failures on later loads.
Never commit editable secret modules or private identities; Configre rejects already tracked secret inputs.
Identity files live under `~/.config/configre/`: `identity.pem` is private and `identity.pub` is public.
Back up editable secrets and private identities; never reset damaged identities or ciphertext as a retry.
To revoke access, remove the recipient key, reload locally, and publish; prevent re-registration and rotate previously shared credentials when required.

## Print without secret fields

Use `cfg.print()` with `DEBUG=Configre:*`, rather than logging the merged configuration.
It logs current values without mutation or automatic printing on load; public siblings remain visible.
Omit loaded secret-file fields recursively, including encrypted inputs; omit secret arrays entirely.
Classification follows secret-file fields, not names: secrets copied elsewhere are not automatically detected.
The method is non-enumerable; spreads and JSON still contain secrets and do not preserve the method.
An existing `print` field is preserved; use `new Configre(configPath).print()` in that case.

## Apply environment variables

```javascript
import Configre, { applyConfigEnv } from "configre";
const cfg = Configre(configPath);
applyConfigEnv(cfg.env);
```

Call explicitly after loading. Set only undefined `process.env` variables using `String(value)`; preserve existing values, including `""`.
Omitted `cfg.env` does nothing; skip null/undefined entries. Reject null, arrays, non-objects, empty keys, and object values.
Invalid entries throw without rolling back earlier assignments. CommonJS: `const { applyConfigEnv } = require("configre")`.
For encryption, identity permissions, and recovery details, consult the [advanced reference](https://github.com/clasen/Configre#advanced-reference).
