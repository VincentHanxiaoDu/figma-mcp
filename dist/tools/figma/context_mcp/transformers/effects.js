"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSimplifiedEffects = buildSimplifiedEffects;
const style_1 = require("./style");
const identity_1 = require("../utils/identity");
function buildSimplifiedEffects(n) {
    if (!(0, identity_1.hasValue)("effects", n))
        return {};
    const effects = n.effects.filter((e) => e.visible);
    // Handle drop and inner shadows (both go into CSS box-shadow)
    const dropShadows = effects
        .filter((e) => e.type === "DROP_SHADOW")
        .map(simplifyDropShadow);
    const innerShadows = effects
        .filter((e) => e.type === "INNER_SHADOW")
        .map(simplifyInnerShadow);
    const boxShadow = [...dropShadows, ...innerShadows].join(", ");
    // Handle blur effects - separate by CSS property
    // Layer blurs use the CSS 'filter' property
    const filterBlurValues = effects
        .filter((e) => e.type === "LAYER_BLUR")
        .map(simplifyBlur)
        .join(" ");
    // Background blurs use the CSS 'backdrop-filter' property
    const backdropFilterValues = effects
        .filter((e) => e.type === "BACKGROUND_BLUR")
        .map(simplifyBlur)
        .join(" ");
    const result = {};
    if (boxShadow) {
        if (n.type === "TEXT") {
            result.textShadow = boxShadow;
        }
        else {
            result.boxShadow = boxShadow;
        }
    }
    if (filterBlurValues)
        result.filter = filterBlurValues;
    if (backdropFilterValues)
        result.backdropFilter = backdropFilterValues;
    return result;
}
function simplifyDropShadow(effect) {
    return `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread ?? 0}px ${(0, style_1.formatRGBAColor)(effect.color)}`;
}
function simplifyInnerShadow(effect) {
    return `inset ${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread ?? 0}px ${(0, style_1.formatRGBAColor)(effect.color)}`;
}
function simplifyBlur(effect) {
    return `blur(${effect.radius}px)`;
}
