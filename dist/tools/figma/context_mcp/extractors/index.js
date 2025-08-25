"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutOnly = exports.visualsOnly = exports.contentOnly = exports.layoutAndText = exports.allExtractors = exports.componentExtractor = exports.visualsExtractor = exports.textExtractor = exports.layoutExtractor = exports.simplifyRawFigmaObject = exports.extractFromDesign = void 0;
// Core traversal function
var node_walker_1 = require("./node-walker");
Object.defineProperty(exports, "extractFromDesign", { enumerable: true, get: function () { return node_walker_1.extractFromDesign; } });
// Design-level extraction (unified nodes + components)
var design_extractor_1 = require("./design-extractor");
Object.defineProperty(exports, "simplifyRawFigmaObject", { enumerable: true, get: function () { return design_extractor_1.simplifyRawFigmaObject; } });
// Built-in extractors
var built_in_1 = require("./built-in");
Object.defineProperty(exports, "layoutExtractor", { enumerable: true, get: function () { return built_in_1.layoutExtractor; } });
Object.defineProperty(exports, "textExtractor", { enumerable: true, get: function () { return built_in_1.textExtractor; } });
Object.defineProperty(exports, "visualsExtractor", { enumerable: true, get: function () { return built_in_1.visualsExtractor; } });
Object.defineProperty(exports, "componentExtractor", { enumerable: true, get: function () { return built_in_1.componentExtractor; } });
// Convenience combinations
Object.defineProperty(exports, "allExtractors", { enumerable: true, get: function () { return built_in_1.allExtractors; } });
Object.defineProperty(exports, "layoutAndText", { enumerable: true, get: function () { return built_in_1.layoutAndText; } });
Object.defineProperty(exports, "contentOnly", { enumerable: true, get: function () { return built_in_1.contentOnly; } });
Object.defineProperty(exports, "visualsOnly", { enumerable: true, get: function () { return built_in_1.visualsOnly; } });
Object.defineProperty(exports, "layoutOnly", { enumerable: true, get: function () { return built_in_1.layoutOnly; } });
