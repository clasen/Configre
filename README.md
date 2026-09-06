# 🔧 Configre

Welcome to Configre, the coolest way to manage your project's configuration with a twist of personality based on your environment! Whether you're in development, testing, or production, Configre seamlessly adjusts to your project's needs by loading specific configurations tailored to each environment. Say goodbye to manual config tweaks and hello to automatic, hassle-free setup! 🚀

## ✨ Features

- **Environment-Specific Configurations**: Automatically loads configurations based on the hostname or a custom profile forced via `--config=<profile>` CLI argument.
- **Fallback to Defaults**: Uses a default configuration as a baseline, ensuring your application always has the necessary settings.
- **Easy Integration**: A simple setup process that integrates effortlessly into any project.
- **Support for `.cjs` Config Files Only**: Config files must use the `.cjs` extension. This allows dynamic configuration values and comments, and works the same in both CommonJS and ESM projects.

## 🌟 Getting Started

To get started with Configre, follow these steps:

1. **Install the Library**

   Configre requires **Node.js 22.13 or later**. Add it to your project:

   ```bash
   npm install configre --save
   ```

> You can also add Configre as a skill for AI agentic development:
> ```bash
> npx skills add https://github.com/clasen/Configre --skill configre
> ```   

2. **Setup Your Configuration Files**

   Organize your configuration files within a directory (e.g., `config`). Create a default configuration file and environment-specific files as needed.

   - `index.cjs`: Your default configuration.
   - `[hostname].cjs`: Override configurations for specific hosts.
   - `[hostname].dev.cjs`: Development-specific configurations.

   > **Note:** Config files must always use the `.cjs` extension; `.js` config files are not accepted. That way they work in both CommonJS and ESM projects and you can use `module.exports` in them.

3. **Use Configre in Your Project**

   Import and use Configre to load your configurations. The configuration path is required:

   ```javascript
   import Configre from "configre";
   import { join } from "node:path";

   const cfg = Configre(join(import.meta.dirname, "config"));
   console.log(cfg.db); // Access your db configuration
   ```

   Prefer an absolute path anchored to the module, as above. Avoid deriving it from `process.cwd()` (for example, `path.join(process.cwd(), "config")`), because that can point to a different location depending on where the process is started.

   Configre is a native ES module. CommonJS consumers keep the same synchronous API, without accessing `.default`:

   ```javascript
   const Configre = require("configre");
   const { join } = require("node:path");

   const cfg = Configre(join(__dirname, "config"));
   ```

   Both module systems share the same implementation. Existing configuration files stay in `.cjs` format; Configre uses Node's `createRequire` only to load these files synchronously.

## 📚 Example

Imagine you have the following structure in your `config` directory:

- `index.cjs`: Contains default settings.
- `myhostname.cjs`: Contains overrides for the host named `myhostname`.

Your `index.cjs` might look like this:

```javascript
module.exports = {
    db: {
        host: 'localhost',
        user: 'myuser',
        password: 'mypassword'
    },
    api: {
        key: 'development-api-key'
    }
}
```

And your `myhostname.cjs`:

```javascript
module.exports = {
    db: {
        user: 'john',
        password: 'johns-password'
    }
}
```

Configre merges these configurations based on your environment, making your app adaptable and easier to manage.

## 🎯 Forcing a hostname / config

By default Configre uses the machine’s hostname to choose the config file (e.g. `config/<hostname>.cjs`). You can force which hostname or profile to use with the `--config=<hostname>` CLI argument:

```bash
node demo.js --config=staging
node demo.js --config=production
node demo.js --port=3000 --config=myhost --debug
```

This loads `config/staging.cjs` (or `config/staging.dev.cjs`) instead of the one for the actual hostname. The `--config=` flag can appear anywhere in the command and works alongside other arguments.

## 🔐 Shared secrets: follow the demo

The [secrets demo](demo/secrets/) shows how to keep API keys out of your public configuration and share them with a server through Git. Use one checkout as the **administrator**, where you edit secrets, and another as the **server**, which reads the encrypted values.

Run the commands below from the repository root. In [demo/secrets/demo.js](demo/secrets/demo.js), the configuration is loaded with:

```javascript
import Configre from "../../index.js";
import { join } from "node:path";

const configPath = join(import.meta.dirname, "config");
const cfg = Configre(configPath);
```

Secrets activate automatically when the base configuration or selected profile has a corresponding `.secret.cjs` file, or when `secrets.enc.json` already exists. No options are needed. Loading remains synchronous, and your application reads the result through ordinary properties such as `cfg.api.key`.

> The demo reports `API key configured:` without printing the key. Avoid logging `cfg` in your application: it contains the decrypted secrets.

### 1. Start the demo on the administrator machine

For this walkthrough, use an empty public placeholder in [demo/secrets/config/index.cjs](demo/secrets/config/index.cjs):

```javascript
module.exports = {
    api: {
        key: ""
    }
};
```

Create `demo/secrets/config/index.secret.cjs` yourself to enable secrets, initially with:

```javascript
module.exports = {};
```

Then run:

```bash
node demo/secrets/demo.js
```

For a new setup, Configre generates the encrypted file, recipients directory and Git exclusions alongside your existing configuration files:

```text
demo/secrets/config/
  index.cjs          # Public configuration
  index.secret.cjs   # Editable secrets you create yourself
  recipients/        # Public keys of servers that register
  secrets.enc.json   # Generated encrypted values
  .gitignore         # Keeps .secret.cjs files out of Git
```

It also creates this OS user's identity outside the repository, at `~/.config/configre/identity.pem` and `identity.pub`.

With the public placeholder empty and no secrets added, look for:

```text
API key configured: false
```

**Configre never creates `.secret.cjs` files.** Without a secret counterpart for the base configuration or selected profile, and without an encrypted file, it loads only public settings and creates no identity or secret artifacts. A secret module contains only the fields you choose to override; public settings continue to come from `index.cjs`.

These initialization steps describe a new setup. If `secrets.enc.json` already exists, Configre uses that encrypted file instead of resetting it. A checkout containing the encrypted file but no `.secret.cjs` files is treated as a server checkout.

### 2. Add an API key and publish the encrypted file

On the administrator machine, edit `demo/secrets/config/index.secret.cjs`:

```javascript
module.exports = {
    api: {
        key: ""
    }
};
```

Replace the empty string with your actual key **in this local file**, then run the demo again:

```bash
node demo/secrets/demo.js
```

Configre updates `demo/secrets/config/secrets.enc.json`, merges the secret into the configuration, and the demo reports:

```text
API key configured: true
```

Commit and push the demo's public files, including `config/index.cjs`, the generated `config/.gitignore`, and `config/secrets.enc.json`. Keep `config/index.secret.cjs` on the administrator machine.

| File in `demo/secrets/config/` | Purpose | Share through Git? |
| --- | --- | --- |
| `index.cjs` | Public settings and empty placeholders | Yes |
| `index.secret.cjs` | Values you edit on the administrator | No |
| `secrets.enc.json` | Encrypted values generated by Configre | Yes |
| `recipients/truco.pub` | Public identity of the server named `truco` | Yes; the server publishes it |
| `.gitignore` | Excludes editable secret files | Yes |

### 3. Register the server as `truco`

On the server, clone or pull the repository **including `demo/secrets/config/secrets.enc.json`**. Use a branch with a configured upstream, Git author name/email, and credentials that allow a push without an interactive prompt. Before a new registration, the local branch must match its upstream.

Run:

```bash
node demo/secrets/demo.js --config=truco
```

`--config=truco` selects the profile and names the public-key file. Without this flag, Configre uses the hostname.

If this server is not authorized yet, Configre automatically:

1. Creates its local identity, if needed.
2. Writes `demo/secrets/config/recipients/truco.pub`.
3. Creates and pushes a commit containing only that public-key file.
4. Stops startup with a message explaining that the administrator must publish an updated encrypted file.

This first stop is expected: publishing a public key does not let the server decrypt the existing ciphertext. Repeating the command does not publish another registration commit for the same key.

### 4. Include the server in the encrypted file

Back on the administrator machine:

```bash
git pull --ff-only
node demo/secrets/demo.js
```

The pull brings in `demo/secrets/config/recipients/truco.pub`. When the demo runs, Configre automatically includes that public key and regenerates `demo/secrets/config/secrets.enc.json`. There is no separate approval step.

Commit and push the updated encrypted file. Then, on the server:

```bash
git pull --ff-only
node demo/secrets/demo.js --config=truco
```

The server can now decrypt the key, and the demo reports `API key configured: true`. It does not need `index.secret.cjs`; the value reaches `cfg.api.key` through the encrypted file.

**Repository write access allows a machine to register for all project secrets.** Configre publishes the server's public key automatically. Pulling changes and publishing the administrator's updated encrypted file remain part of your Git/deployment workflow.

### 5. Update keys or use profile-specific secrets

To change the shared API key, edit `demo/secrets/config/index.secret.cjs` on the administrator and run:

```bash
node demo/secrets/demo.js
```

Commit and push the updated `secrets.enc.json`, then pull and restart the demo on the server. **You do not need to copy or register `truco.pub` again.** Its existing authorization also covers new keys you add later.

For settings specific to `truco`, add `demo/secrets/config/truco.cjs` and create `truco.secret.cjs` yourself with that profile's secrets. The secret file activates secrets when `truco` is selected, even without `index.secret.cjs`. A public profile alone never creates a secret counterpart. Once secrets are active, all profile secret files, including inactive ones, are encrypted together when the administrator runs the demo.

For `--config=truco`, the merge order is:

```text
index.cjs → truco.cjs → index.secret.cjs → truco.secret.cjs
```

Later files override matching fields while preserving other fields. If `truco.dev.cjs` exists, it is selected instead of `truco.cjs`. Secret selection independently prefers `truco.dev.secret.cjs` over `truco.secret.cjs`; those two secret variants do not merge with each other. A missing profile uses the available base configuration and base secrets.

To revoke this server, remove `demo/secrets/config/recipients/truco.pub`, run the demo on the administrator, and commit and push both the removal and the updated encrypted file. Remove the server's repository write access too if it must not register itself again. Revocation protects new encrypted versions; rotate the key at its provider to invalidate a credential the server already received.

<details>
<summary>File formats, Git behavior and recovery</summary>

- Secret `.cjs` modules execute on the administrator and are reloaded on each Configre call. They must export plain objects containing JSON-compatible objects, arrays, strings, finite numbers, booleans and `null`. Functions, `undefined`, accessors, symbols, custom objects, circular references, and properties named `__proto__`, `constructor` or `prototype` are rejected. Consumers decrypt data without executing these modules.
- Empty strings stay empty strings. Configre does not fill them from environment variables or populate `process.env`. The existing deep-merge behavior, including array merging, also applies to secrets.
- Activation depends only on the existing files; there is no `secrets` option. The same behavior applies to `new Configre(configPath).get()` and CommonJS consumers.
- Each OS user has one identity reused across projects; authorization is per project. A service running under another OS user needs its own registration. All authorized identities can decrypt all profiles in the project's encrypted file.
- Public recipient files must contain a single RSA-3072 public key in PEM format, with exponent 65537, as generated by Configre. Other file extensions are ignored, and duplicate keys do not add recipients. The administrator is always included.
- Registration uses an isolated Git index and publishes only the public-key file. It preserves unrelated staged and unstaged changes, runs no commit or pre-push hooks, and does not push local tags, merge, rebase or force-push. Failed registrations can be retried at the next startup; each Git command has a 30-second timeout. An authorized server loads secrets without Git commands or project writes.
- Registration names must start with a letter or digit and contain only letters, digits, dots, underscores or hyphens. If another key already occupies `truco.pub`, Configre stops without overwriting it; use a distinct profile or resolve the key replacement explicitly.
- Configre appends Git exclusions without removing existing rules and refuses to proceed on the administrator if editable secret modules are already tracked. It does not untrack files or rewrite history. It also prepares `.gitignore` when no repository exists yet.
- The administrator's `.secret.cjs` files are the source of truth for values, and `recipients/` is the source of truth for authorization. Removing all recipient files revokes them on the next administrator reload; old ciphertext does not restore them. Recover accidentally deleted public-key files from Git before reloading. Missing Git exclusions and ciphertext are regenerated on the administrator, and existing secret modules are never overwritten.
- Back up the administrator's editable secrets and private identity securely. Never share or commit `identity.pem`. On POSIX, its directory must have owner-only permissions (`0700`) and the private file must have owner-only permissions (`0600`); on Windows, protection depends on the user profile's filesystem permissions. Private identities and secret input files cannot be symlinks.
- A corrupt or missing private identity is never silently replaced. Restore it from backup, or register a new identity on a consumer. A missing public file can be regenerated from the valid private key. Losing every authorized private key makes existing ciphertext unrecoverable; an administrator with surviving editable secret files can create fresh ciphertext.
- The encrypted JSON envelope uses AES-256-GCM with a fresh content key and nonce for each update, wrapping that key for each recipient with RSA-3072 / OAEP-SHA-256. Version and recipient metadata are authenticated. Invalid modules, malformed ciphertext and authentication failures stop loading without replacing the existing encrypted file.
- Ciphertext is replaced atomically under an exclusive writer lock. Temporary vault files contain only encrypted data and public metadata. After a crash, remove a reported stale `.lock` only after confirming its writer has stopped. Unchanged values and recipient keys do not cause a rewrite.
- For an individual configuration file, the same workflow uses sidecars beside that file: `settings.secret.cjs`, `settings.cjs.recipients/` and `settings.cjs.secrets.enc.json`. An extensionless path resolving to `settings.cjs` uses the same sidecars.

</details>

## 🤔 Why Configre?

- **No More Manual Switching**: Automatically adjusts your configuration based on the environment.
- **Clarity and Convenience**: Keep your configuration organized and easy to understand.
- **Flexibility**: Supports dynamic configuration values for complex setups.

## 🤝 Contribute 

Found a bug or have a feature request? Contributions are welcome! Feel free to open an issue or submit a pull request.

Let's make Configre even better, together! 🎉

## 📄 License

The MIT License (MIT)

Copyright (c) Martin Clasen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
