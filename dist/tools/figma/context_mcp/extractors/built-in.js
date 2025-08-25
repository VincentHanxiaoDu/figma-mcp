"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutOnly = exports.visualsOnly = exports.contentOnly = exports.layoutAndText = exports.allExtractors = exports.componentExtractor = exports.visualsExtractor = exports.textExtractor = exports.layoutExtractor = void 0;
const layout_1 = require("../transformers/layout");
const style_1 = require("../transformers/style");
const effects_1 = require("../transformers/effects");
const text_1 = require("../transformers/text");
const identity_1 = require("../utils/identity");
const common_1 = require("../utils/common");
/**
 * Helper function to find or create a global variable.
 */
function findOrCreateVar(globalVars, value, prefix) {
    // Check if the same value already exists
    const [existingVarId] = Object.entries(globalVars.styles).find(([_, existingValue]) => JSON.stringify(existingValue) === JSON.stringify(value)) ?? [];
    if (existingVarId) {
        return existingVarId;
    }
    // Create a new variable if it doesn't exist
    const varId = (0, common_1.generateVarId)(prefix);
    globalVars.styles[varId] = value;
    return varId;
}
/**
 * Extracts layout-related properties from a node.
 */
const layoutExtractor = (node, result, context) => {
    const layout = (0, layout_1.buildSimplifiedLayout)(node, context.parent);
    if (Object.keys(layout).length > 1) {
        result.layout = findOrCreateVar(context.globalVars, layout, "layout");
    }
};
exports.layoutExtractor = layoutExtractor;
/**
 * Extracts text content and text styling from a node.
 */
const textExtractor = (node, result, context) => {
    // Extract text content
    if ((0, text_1.isTextNode)(node)) {
        result.text = (0, text_1.extractNodeText)(node);
    }
    // Extract text style
    if ((0, text_1.hasTextStyle)(node)) {
        const textStyle = (0, text_1.extractTextStyle)(node);
        result.textStyle = findOrCreateVar(context.globalVars, textStyle, "style");
    }
};
exports.textExtractor = textExtractor;
/**
 * Extracts visual appearance properties (fills, strokes, effects, opacity, border radius).
 */
const visualsExtractor = (node, result, context) => {
    // Check if node has children to determine CSS properties
    const hasChildren = (0, identity_1.hasValue)("children", node) && Array.isArray(node.children) && node.children.length > 0;
    // fills
    if ((0, identity_1.hasValue)("fills", node) && Array.isArray(node.fills) && node.fills.length) {
        const fills = node.fills.map((fill) => (0, style_1.parsePaint)(fill, hasChildren)).reverse();
        result.fills = findOrCreateVar(context.globalVars, fills, "fill");
    }
    // strokes
    const strokes = (0, style_1.buildSimplifiedStrokes)(node, hasChildren);
    if (strokes.colors.length) {
        result.strokes = findOrCreateVar(context.globalVars, strokes, "stroke");
    }
    // effects
    const effects = (0, effects_1.buildSimplifiedEffects)(node);
    if (Object.keys(effects).length) {
        result.effects = findOrCreateVar(context.globalVars, effects, "effect");
    }
    // opacity
    if ((0, identity_1.hasValue)("opacity", node) && typeof node.opacity === "number" && node.opacity !== 1) {
        result.opacity = node.opacity;
    }
    // border radius
    if ((0, identity_1.hasValue)("cornerRadius", node) && typeof node.cornerRadius === "number") {
        result.borderRadius = `${node.cornerRadius}px`;
    }
    if ((0, identity_1.hasValue)("rectangleCornerRadii", node, identity_1.isRectangleCornerRadii)) {
        result.borderRadius = `${node.rectangleCornerRadii[0]}px ${node.rectangleCornerRadii[1]}px ${node.rectangleCornerRadii[2]}px ${node.rectangleCornerRadii[3]}px`;
    }
};
exports.visualsExtractor = visualsExtractor;
/**
 * Extracts component-related properties from INSTANCE nodes.
 */
const componentExtractor = (node, result, context) => {
    if (node.type === "INSTANCE") {
        if ((0, identity_1.hasValue)("componentId", node)) {
            result.componentId = node.componentId;
        }
        // Add specific properties for instances of components
        if ((0, identity_1.hasValue)("componentProperties", node)) {
            result.componentProperties = Object.entries(node.componentProperties ?? {}).map(([name, { value, type }]) => ({
                name,
                value: value.toString(),
                type,
            }));
        }
    }
};
exports.componentExtractor = componentExtractor;
// -------------------- CONVENIENCE COMBINATIONS --------------------
/**
 * All extractors - replicates the current parseNode behavior.
 */
exports.allExtractors = [exports.layoutExtractor, exports.textExtractor, exports.visualsExtractor, exports.componentExtractor];
/**
 * Layout and text only - useful for content analysis and layout planning.
 */
exports.layoutAndText = [exports.layoutExtractor, exports.textExtractor];
/**
 * Text content only - useful for content audits and copy extraction.
 */
exports.contentOnly = [exports.textExtractor];
/**
 * Visuals only - useful for design system analysis and style extraction.
 */
exports.visualsOnly = [exports.visualsExtractor];
/**
 * Layout only - useful for structure analysis.
 */
exports.layoutOnly = [exports.layoutExtractor];
