"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTruthy = void 0;
exports.hasValue = hasValue;
exports.isFrame = isFrame;
exports.isLayout = isLayout;
exports.isInAutoLayoutFlow = isInAutoLayoutFlow;
exports.isStrokeWeights = isStrokeWeights;
exports.isRectangle = isRectangle;
exports.isRectangleCornerRadii = isRectangleCornerRadii;
exports.isCSSColorValue = isCSSColorValue;
const remeda_1 = require("remeda");
Object.defineProperty(exports, "isTruthy", { enumerable: true, get: function () { return remeda_1.isTruthy; } });
function hasValue(key, obj, typeGuard) {
    const isObject = typeof obj === "object" && obj !== null;
    if (!isObject || !(key in obj))
        return false;
    const val = obj[key];
    return typeGuard ? typeGuard(val) : val !== undefined;
}
function isFrame(val) {
    return (typeof val === "object" &&
        !!val &&
        "clipsContent" in val &&
        typeof val.clipsContent === "boolean");
}
function isLayout(val) {
    return (typeof val === "object" &&
        !!val &&
        "absoluteBoundingBox" in val &&
        typeof val.absoluteBoundingBox === "object" &&
        !!val.absoluteBoundingBox &&
        "x" in val.absoluteBoundingBox &&
        "y" in val.absoluteBoundingBox &&
        "width" in val.absoluteBoundingBox &&
        "height" in val.absoluteBoundingBox);
}
/**
 * Checks if:
 * 1. A node is a child to an auto layout frame
 * 2. The child adheres to the auto layout rules—i.e. it's not absolutely positioned
 *
 * @param node - The node to check.
 * @param parent - The parent node.
 * @returns True if the node is a child of an auto layout frame, false otherwise.
 */
function isInAutoLayoutFlow(node, parent) {
    const autoLayoutModes = ["HORIZONTAL", "VERTICAL"];
    return (isFrame(parent) &&
        autoLayoutModes.includes(parent.layoutMode ?? "NONE") &&
        isLayout(node) &&
        node.layoutPositioning !== "ABSOLUTE");
}
function isStrokeWeights(val) {
    return (typeof val === "object" &&
        val !== null &&
        "top" in val &&
        "right" in val &&
        "bottom" in val &&
        "left" in val);
}
function isRectangle(key, obj) {
    const recordObj = obj;
    return (typeof obj === "object" &&
        !!obj &&
        key in recordObj &&
        typeof recordObj[key] === "object" &&
        !!recordObj[key] &&
        "x" in recordObj[key] &&
        "y" in recordObj[key] &&
        "width" in recordObj[key] &&
        "height" in recordObj[key]);
}
function isRectangleCornerRadii(val) {
    return Array.isArray(val) && val.length === 4 && val.every((v) => typeof v === "number");
}
function isCSSColorValue(val) {
    return typeof val === "string" && (val.startsWith("#") || val.startsWith("rgba"));
}
