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

   First, make sure you have `Node.js` installed. Then, add Configre to your project:

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

   Import and use Configre to load your configurations:

   ```javascript
   const cfg = require("Configre")(); // default dir '/config'
   console.log(cfg.db); // Access your db configuration
   ```

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