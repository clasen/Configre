function isPlainObject(value) {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isUnsafeKey(key) {
    return key === "__proto__" || key === "constructor" || key === "prototype";
}

function mergeArray(target, source) {
    const result = target.slice();

    for (let index = 0; index < source.length; index += 1) {
        const srcValue = source[index];
        const objValue = result[index];

        if (Array.isArray(srcValue)) {
            result[index] = mergeArray(Array.isArray(objValue) ? objValue : [], srcValue);
            continue;
        }

        if (isPlainObject(srcValue)) {
            result[index] = baseMerge(isPlainObject(objValue) ? objValue : {}, srcValue);
            continue;
        }

        if (srcValue !== undefined || result[index] === undefined) {
            result[index] = srcValue;
        }
    }

    return result;
}

function baseMerge(object, source) {
    if (object === source || source === null || typeof source !== "object") {
        return object;
    }

    for (const key in source) {
        if (isUnsafeKey(key)) {
            continue;
        }

        const srcValue = source[key];
        const objValue = object[key];

        if (Array.isArray(srcValue)) {
            object[key] = mergeArray(Array.isArray(objValue) ? objValue : [], srcValue);
            continue;
        }

        if (isPlainObject(srcValue)) {
            object[key] = baseMerge(isPlainObject(objValue) ? objValue : {}, srcValue);
            continue;
        }

        if (srcValue !== undefined || object[key] === undefined) {
            object[key] = srcValue;
        }
    }

    return object;
}

function merge(object, ...sources) {
    const output = (object !== null && typeof object === "object") ? object : {};

    for (const source of sources) {
        baseMerge(output, source);
    }

    return output;
}

module.exports = {
    merge
};
