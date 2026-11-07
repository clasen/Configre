export default {
    git: {
        timeoutMs: 30_000,
        fallbackIdentity: {
            name: "Configre",
            email: "configre@localhost"
        }
    },
    lock: {
        timeoutMs: 5_000,
        retryIntervalMs: 25
    }
};
