"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFromDesign = extractFromDesign;
const common_1 = require("../utils/common");
const identity_1 = require("../utils/identity");
/**
 * Extract data from Figma nodes using a flexible, single-pass approach.
 *
 * @param nodes - The Figma nodes to process
 * @param extractors - Array of extractor functions to apply during traversal
 * @param options - Traversal options (filtering, depth limits, etc.)
 * @param globalVars - Global variables for style deduplication
 * @returns Object containing processed nodes and updated global variables
 */
function extractFromDesign(nodes, extractors, options = {}, globalVars = { styles: {} }) {
    const context = {
        globalVars,
        currentDepth: 0,
    };
    const processedNodes = nodes
        .filter((node) => shouldProcessNode(node, options))
        .map((node) => processNodeWithExtractors(node, extractors, context, options))
        .filter((node) => node !== null);
    return {
        nodes: processedNodes,
        globalVars: context.globalVars,
    };
}
/**
 * Process a single node with all provided extractors in one pass.
 */
function processNodeWithExtractors(node, extractors, context, options) {
    if (!shouldProcessNode(node, options)) {
        return null;
    }
    // Always include base metadata
    const result = {
        id: node.id,
        name: node.name,
        type: node.type === "VECTOR" ? "IMAGE-SVG" : node.type,
    };
    // Apply all extractors to this node in a single pass
    for (const extractor of extractors) {
        extractor(node, result, context);
    }
    // Handle children recursively
    if (shouldTraverseChildren(node, context, options)) {
        const childContext = {
            ...context,
            currentDepth: context.currentDepth + 1,
            parent: node,
        };
        // Use the same pattern as the existing parseNode function
        if ((0, identity_1.hasValue)("children", node) && node.children.length > 0) {
            const children = node.children
                .filter((child) => shouldProcessNode(child, options))
                .map((child) => processNodeWithExtractors(child, extractors, childContext, options))
                .filter((child) => child !== null);
            if (children.length > 0) {
                result.children = children;
            }
        }
    }
    else {
        result.children = `<omitted due to depth reached, search for a deeper node (for example, ids='${node.id}' with depth=1) to explore the children>`;
    }
    return result;
}
/**
 * Determine if a node should be processed based on filters.
 */
function shouldProcessNode(node, options) {
    // Skip invisible nodes
    if (!(0, common_1.isVisible)(node)) {
        return false;
    }
    // Apply custom node filter if provided
    if (options.nodeFilter && !options.nodeFilter(node)) {
        return false;
    }
    return true;
}
/**
 * Determine if we should traverse into a node's children.
 */
function shouldTraverseChildren(node, context, options) {
    // Check depth limit
    if (options.maxDepth !== undefined && context.currentDepth >= options.maxDepth) {
        return false;
    }
    return true;
}
