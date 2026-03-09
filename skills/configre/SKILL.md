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
        password: 'dev-pass'
    },
    api: {
        key: 'default-key',
        url: 'http://localhost:3000'
    }
};
```

### Step 4: Write host/profile overrides

Create `config/<hostname>.cjs` with only the keys that differ — they are deep-merged over defaults:

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

Configre determines the active profile by looking for a `--config=<profile>` argument anywhere in `process.argv`, or falls back to `os.hostname()`. It then checks for overrides in this order (first match wins):

1. `config/<profile>.dev.cjs` — dev override
2. `config/<profile>.cjs` — production override
3. No match — uses defaults only

To force a specific profile at runtime:

```bash
node app.js --config=staging
node app.js --port=3000 --config=production --debug
```

Using `--config=` (instead of a positional argument) avoids conflicts with other CLI flags.

## Examples

**Example 1: Basic setup**
User says: "Add configuration management to my Node.js project"
Actions: install configre, create `config/index.cjs` with project defaults, load with `require("configre")()`
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

- **Deep merge**: nested objects merge recursively via lodash `_.merge`
- **Config files must use the `.cjs` extension** (works in both CommonJS and ESM projects)
- **Function vs constructor**: `Configre(path)` returns the merged config directly; `new Configre(path)` returns the instance (use `.get()` to retrieve config)
