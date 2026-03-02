---
name: configre
description: Set up and manage environment-specific configuration in Node.js projects using the Configre library. Use when the user wants to add configuration management, create environment configs, set up hostname-based settings, or mentions "configre", "config files", "environment config", or "per-host settings".
metadata:
  category: configuration
  tags: [nodejs, config, environment, settings, env]
---

# Configre

Environment-specific configuration manager for Node.js. Merges a default config with hostname or profile-based overrides using deep merge (lodash).

## Instructions

### Step 1: Install the package

```bash
npm install configre --save
```

### Step 2: Create the config directory

```
project/
├── config/
│   ├── index.js          # Default settings (required)
│   ├── myhostname.js     # Host-specific overrides (optional)
│   └── myhostname.dev.js # Dev override for host (optional)
```

If the project uses `"type": "module"` in `package.json`, create `config/package.json`:

```json
{ "type": "commonjs" }
```

This is needed because config files use `module.exports`.

### Step 3: Write the default config (`config/index.js`)

```javascript
module.exports = {
    db: {
        host: 'localhost',
        port: 5432,
        user: 'dev',
        password: 'dev-pass'
    },
    api: {
        key: 'default-key',
        url: 'http://localhost:3000'
    }
};
```

### Step 4: Write host/profile overrides

Create `config/<hostname>.js` with only the keys that differ — they are deep-merged over defaults:

```javascript
module.exports = {
    db: {
        user: 'prod-user',
        password: 'prod-secret'
    }
};
```

### Step 5: Load the configuration

```javascript
const cfg = require("configre")();

console.log(cfg.db.host); // from default
console.log(cfg.db.user); // from host override
```

To use a custom config directory:

```javascript
const cfg = require("configre")(__dirname + "/settings");
```

## Profile resolution

Configre determines the active profile from `process.argv[2]` (CLI argument) or `os.hostname()` as fallback. It then checks for overrides in this order (first match wins):

1. `config/<profile>.dev.js` or `.cjs` — dev override
2. `config/<profile>.js` or `.cjs` — production override
3. No match — uses defaults only

## Examples

**Example 1: Basic setup**
User says: "Add configuration management to my Node.js project"
Actions: install configre, create `config/index.js` with project defaults, load with `require("configre")()`
Result: merged config object ready to use

**Example 2: Multi-environment**
User says: "I need different database settings per server"
Actions: create `config/index.js` with defaults, create `config/<hostname>.js` per server with db overrides
Result: each server automatically loads its own config based on hostname

**Example 3: Custom profile via CLI**
User says: "I want to run my app with a staging config"
Actions: create `config/staging.js`, run app with `node app.js staging`
Result: staging overrides are merged over defaults

## Key behaviors

- **Deep merge**: nested objects merge recursively via lodash `_.merge`
- **Both `.js` and `.cjs`** extensions are supported for all config files
- **Function vs constructor**: `Configre(path)` returns the merged config directly; `new Configre(path)` returns the instance (use `.get()` to retrieve config)
