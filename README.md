# 🔧 Configre

Welcome to Configre, the coolest way to manage your project's configuration with a twist of personality based on your environment! Whether you're in development, testing, or production, Configre seamlessly adjusts to your project's needs by loading specific configurations tailored to each environment. Say goodbye to manual config tweaks and hello to automatic, hassle-free setup! 🚀

## ✨ Features

- **Environment-Specific Configurations**: Automatically loads configurations based on the hostname or a custom profile passed via command line arguments.
- **Fallback to Defaults**: Uses a default configuration as a baseline, ensuring your application always has the necessary settings.
- **Easy Integration**: A simple setup process that integrates effortlessly into any project.
- **Support for `.js` Config Files**: Allows for dynamic configuration values and comments for better clarity.

## 🌟 Getting Started

To get started with Configre, follow these steps:

1. **Install the Library**

   First, make sure you have `Node.js` installed. Then, add Configre to your project:

   ```bash
   npm install configre --save
   ```

2. **Setup Your Configuration Files**

   Organize your configuration files within a directory (e.g., `config`). Create a default configuration file and environment-specific files as needed.

   - `index.js`: Your default configuration.
   - `[hostname].js`: Override configurations for specific hosts.
   - `[hostname].dev.js`: Development-specific configurations.

   > **Note:** If your main project uses `"type": "module"` in its `package.json`, add a `package.json` inside the `config/` directory with the following content so you can keep using `module.exports` in your config files:
   >
   > ```json
   > {
   >   "type": "commonjs"
   > }
   > ```

3. **Use Configre in Your Project**

   Import and use Configre to load your configurations:

   ```javascript
   const cfg = require("Configre")(); // default dir '/config'
   console.log(cfg.db); // Access your db configuration
   ```

## 📚 Example

Imagine you have the following structure in your `config` directory:

- `index.js`: Contains default settings.
- `myhostname.js`: Contains overrides for the host named `myhostname`.

Your `index.js` might look like this:

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

And your `myhostname.js`:

```javascript
module.exports = {
    db: {
        user: 'john',
        password: 'johns-password'
    }
}
```

Configre merges these configurations based on your environment, making your app adaptable and easier to manage.

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