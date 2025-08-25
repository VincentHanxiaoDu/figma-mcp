"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTextNode = isTextNode;
exports.hasTextStyle = hasTextStyle;
exports.extractNodeText = extractNodeText;
exports.extractTextStyle = extractTextStyle;
const identity_1 = require("../utils/identity");
function isTextNode(n) {
    return n.type === "TEXT";
}
function hasTextStyle(n) {
    return (0, identity_1.hasValue)("style", n) && Object.keys(n.style).length > 0;
}
// Keep other simple properties directly
function extractNodeText(n) {
    if ((0, identity_1.hasValue)("characters", n, identity_1.isTruthy)) {
        return n.characters;
    }
}
function extractTextStyle(n) {
    if (hasTextStyle(n)) {
        const style = n.style;
        const textStyle = {
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize: style.fontSize,
            lineHeight: "lineHeightPx" in style && style.lineHeightPx && style.fontSize
                ? `${style.lineHeightPx / style.fontSize}em`
                : undefined,
            letterSpacing: style.letterSpacing && style.letterSpacing !== 0 && style.fontSize
                ? `${(style.letterSpacing / style.fontSize) * 100}%`
                : undefined,
            textCase: style.textCase,
            textAlignHorizontal: style.textAlignHorizontal,
            textAlignVertical: style.textAlignVertical,
        };
        return textStyle;
    }
}
