"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simplifyRawFigmaObject = simplifyRawFigmaObject;
const component_1 = require("../transformers/component");
const common_1 = require("../utils/common");
const node_walker_1 = require("./node-walker");
/**
 * Extract a complete SimplifiedDesign from raw Figma API response using extractors.
 */
function simplifyRawFigmaObject(apiResponse, nodeExtractors, options = {}) {
    // Extract components, componentSets, and raw nodes from API response
    const { metadata, rawNodes, components, componentSets } = parseAPIResponse(apiResponse);
    // Process nodes using the flexible extractor system
    const globalVars = { styles: {} };
    const { nodes: extractedNodes, globalVars: finalGlobalVars } = (0, node_walker_1.extractFromDesign)(rawNodes, nodeExtractors, options, globalVars);
    // Return complete design
    return {
        ...metadata,
        nodes: extractedNodes,
        components: (0, component_1.simplifyComponents)(components),
        componentSets: (0, component_1.simplifyComponentSets)(componentSets),
        globalVars: finalGlobalVars,
    };
}
/**
 * Parse the raw Figma API response to extract metadata, nodes, and components.
 */
function parseAPIResponse(data) {
    const aggregatedComponents = {};
    const aggregatedComponentSets = {};
    let nodesToParse;
    if ("nodes" in data) {
        // GetFileNodesResponse
        const nodeResponses = Object.values(data.nodes);
        nodeResponses.forEach((nodeResponse) => {
            if (nodeResponse.components) {
                Object.assign(aggregatedComponents, nodeResponse.components);
            }
            if (nodeResponse.componentSets) {
                Object.assign(aggregatedComponentSets, nodeResponse.componentSets);
            }
        });
        nodesToParse = nodeResponses.map((n) => n.document).filter(common_1.isVisible);
    }
    else {
        // GetFileResponse
        Object.assign(aggregatedComponents, data.components);
        Object.assign(aggregatedComponentSets, data.componentSets);
        nodesToParse = data.document.children.filter(common_1.isVisible);
    }
    const { name, lastModified, thumbnailUrl } = data;
    return {
        metadata: {
            name,
            lastModified,
            thumbnailUrl: thumbnailUrl || "",
        },
        rawNodes: nodesToParse,
        components: aggregatedComponents,
        componentSets: aggregatedComponentSets,
    };
}
