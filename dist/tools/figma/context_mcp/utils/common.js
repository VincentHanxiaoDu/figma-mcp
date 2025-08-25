"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVarId = generateVarId;
exports.generateCSSShorthand = generateCSSShorthand;
exports.isVisible = isVisible;
exports.pixelRound = pixelRound;
/**
 * Generate a 6-character random variable ID
 * @param prefix - ID prefix
 * @returns A 6-character random ID string with prefix
 */
function generateVarId(prefix = "var") {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }
    return `${prefix}_${result}`;
}
/**
 * Generate a CSS shorthand for values that come with top, right, bottom, and left
 *
 * input: { top: 10, right: 10, bottom: 10, left: 10 }
 * output: "10px"
 *
 * input: { top: 10, right: 20, bottom: 10, left: 20 }
 * output: "10px 20px"
 *
 * input: { top: 10, right: 20, bottom: 30, left: 40 }
 * output: "10px 20px 30px 40px"
 *
 * @param values - The values to generate the shorthand for
 * @returns The generated shorthand
 */
function generateCSSShorthand(values, { ignoreZero = true, suffix = "px", } = {}) {
    const { top, right, bottom, left } = values;
    if (ignoreZero && top === 0 && right === 0 && bottom === 0 && left === 0) {
        return undefined;
    }
    if (top === right && right === bottom && bottom === left) {
        return `${top}${suffix}`;
    }
    if (right === left) {
        if (top === bottom) {
            return `${top}${suffix} ${right}${suffix}`;
        }
        return `${top}${suffix} ${right}${suffix} ${bottom}${suffix}`;
    }
    return `${top}${suffix} ${right}${suffix} ${bottom}${suffix} ${left}${suffix}`;
}
/**
 * Check if an element is visible
 * @param element - The item to check
 * @returns True if the item is visible, false otherwise
 */
function isVisible(element) {
    return element.visible ?? true;
}
/**
 * Rounds a number to two decimal places, suitable for pixel value processing.
 * @param num The number to be rounded.
 * @returns The rounded number with two decimal places.
 * @throws TypeError If the input is not a valid number
 */
function pixelRound(num) {
    if (isNaN(num)) {
        throw new TypeError(`Input must be a valid number`);
    }
    return Number(Number(num).toFixed(2));
}
