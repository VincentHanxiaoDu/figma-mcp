"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simplifyComponents = simplifyComponents;
exports.simplifyComponentSets = simplifyComponentSets;
/**
 * Remove unnecessary component properties and convert to simplified format.
 */
function simplifyComponents(aggregatedComponents) {
    return Object.fromEntries(Object.entries(aggregatedComponents).map(([id, comp]) => [
        id,
        {
            id,
            key: comp.key,
            name: comp.name,
            componentSetId: comp.componentSetId,
        },
    ]));
}
/**
 * Remove unnecessary component set properties and convert to simplified format.
 */
function simplifyComponentSets(aggregatedComponentSets) {
    return Object.fromEntries(Object.entries(aggregatedComponentSets).map(([id, set]) => [
        id,
        {
            id,
            key: set.key,
            name: set.name,
            description: set.description,
        },
    ]));
}
