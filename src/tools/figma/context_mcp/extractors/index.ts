// Types
export type {
  ExtractorFn,
  TraversalContext,
  TraversalOptions,
  GlobalVars,
  StyleTypes,
} from "./types";

// Core traversal function
export { extractFromDesign } from "./node-walker";

// Design-level extraction (unified nodes + components)
export { simplifyRawFigmaObject } from "./design-extractor";

// Built-in extractors
export {
  layoutExtractor,
  textExtractor,
  visualsExtractor,
  componentExtractor,
  // Convenience combinations
  allExtractors,
  layoutAndText,
  contentOnly,
  visualsOnly,
  layoutOnly,
} from "./built-in";
