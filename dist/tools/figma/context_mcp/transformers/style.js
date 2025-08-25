"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSimplifiedStrokes = buildSimplifiedStrokes;
exports.parsePaint = parsePaint;
exports.hexToRgba = hexToRgba;
exports.convertColor = convertColor;
exports.formatRGBAColor = formatRGBAColor;
const common_1 = require("../utils/common");
const identity_1 = require("../utils/identity");
/**
 * Translate Figma scale modes to CSS properties based on usage context
 *
 * @param scaleMode - The Figma scale mode (FILL, FIT, TILE, STRETCH)
 * @param isBackground - Whether this image will be used as background-image (true) or <img> tag (false)
 * @param scalingFactor - For TILE mode, the scaling factor relative to original image size
 * @returns Object containing CSS properties and processing metadata
 */
function translateScaleMode(scaleMode, hasChildren, scalingFactor) {
    const isBackground = hasChildren;
    switch (scaleMode) {
        case "FILL":
            // Image covers entire container, may be cropped
            return {
                css: isBackground
                    ? { backgroundSize: "cover", backgroundRepeat: "no-repeat", isBackground: true }
                    : { objectFit: "cover", isBackground: false },
                processing: { needsCropping: false, requiresImageDimensions: false },
            };
        case "FIT":
            // Image fits entirely within container, may have empty space
            return {
                css: isBackground
                    ? { backgroundSize: "contain", backgroundRepeat: "no-repeat", isBackground: true }
                    : { objectFit: "contain", isBackground: false },
                processing: { needsCropping: false, requiresImageDimensions: false },
            };
        case "TILE":
            // Image repeats to fill container at specified scale
            // Always treat as background image (can't tile an <img> tag)
            return {
                css: {
                    backgroundRepeat: "repeat",
                    backgroundSize: scalingFactor
                        ? `calc(var(--original-width) * ${scalingFactor}) calc(var(--original-height) * ${scalingFactor})`
                        : "auto",
                    isBackground: true,
                },
                processing: { needsCropping: false, requiresImageDimensions: true },
            };
        case "STRETCH":
            // Figma calls crop "STRETCH" in its API.
            return {
                css: isBackground
                    ? { backgroundSize: "100% 100%", backgroundRepeat: "no-repeat", isBackground: true }
                    : { objectFit: "fill", isBackground: false },
                processing: { needsCropping: false, requiresImageDimensions: false },
            };
        default:
            return {
                css: {},
                processing: { needsCropping: false, requiresImageDimensions: false },
            };
    }
}
/**
 * Generate a short hash from a transform matrix to create unique filenames
 * @param transform - The transform matrix to hash
 * @returns Short hash string for filename suffix
 */
function generateTransformHash(transform) {
    const values = transform.flat();
    const hash = values.reduce((acc, val) => {
        // Simple hash function - convert to string and create checksum
        const str = val.toString();
        for (let i = 0; i < str.length; i++) {
            acc = ((acc << 5) - acc + str.charCodeAt(i)) & 0xffffffff;
        }
        return acc;
    }, 0);
    // Convert to positive hex string, take first 6 chars
    return Math.abs(hash).toString(16).substring(0, 6);
}
/**
 * Handle imageTransform for post-processing (not CSS translation)
 *
 * When Figma includes an imageTransform matrix, it means the image is cropped/transformed.
 * This function converts the transform into processing instructions for Sharp.
 *
 * @param imageTransform - Figma's 2x3 transform matrix [[scaleX, skewX, translateX], [skewY, scaleY, translateY]]
 * @returns Processing metadata for image cropping
 */
function handleImageTransform(imageTransform) {
    const transformHash = generateTransformHash(imageTransform);
    return {
        needsCropping: true,
        requiresImageDimensions: false,
        cropTransform: imageTransform,
        filenameSuffix: `${transformHash}`,
    };
}
/**
 * Build simplified stroke information from a Figma node
 *
 * @param n - The Figma node to extract stroke information from
 * @param hasChildren - Whether the node has children (affects paint processing)
 * @returns Simplified stroke object with colors and properties
 */
function buildSimplifiedStrokes(n, hasChildren = false) {
    let strokes = { colors: [] };
    if ((0, identity_1.hasValue)("strokes", n) && Array.isArray(n.strokes) && n.strokes.length) {
        strokes.colors = n.strokes.filter(common_1.isVisible).map((stroke) => parsePaint(stroke, hasChildren));
    }
    if ((0, identity_1.hasValue)("strokeWeight", n) && typeof n.strokeWeight === "number" && n.strokeWeight > 0) {
        strokes.strokeWeight = `${n.strokeWeight}px`;
    }
    if ((0, identity_1.hasValue)("strokeDashes", n) && Array.isArray(n.strokeDashes) && n.strokeDashes.length) {
        strokes.strokeDashes = n.strokeDashes;
    }
    if ((0, identity_1.hasValue)("individualStrokeWeights", n, identity_1.isStrokeWeights)) {
        strokes.strokeWeight = (0, common_1.generateCSSShorthand)(n.individualStrokeWeights);
    }
    return strokes;
}
/**
 * Convert a Figma paint (solid, image, gradient) to a SimplifiedFill
 * @param raw - The Figma paint to convert
 * @param hasChildren - Whether the node has children (determines CSS properties)
 * @returns The converted SimplifiedFill
 */
function parsePaint(raw, hasChildren = false) {
    if (raw.type === "IMAGE") {
        const baseImageFill = {
            type: "IMAGE",
            imageRef: raw.imageRef,
            scaleMode: raw.scaleMode,
            scalingFactor: raw.scalingFactor,
        };
        // Get CSS properties and processing metadata from scale mode
        // TILE mode always needs to be treated as background image (can't tile an <img> tag)
        const isBackground = hasChildren || baseImageFill.scaleMode === "TILE";
        const { css, processing } = translateScaleMode(baseImageFill.scaleMode, isBackground, raw.scalingFactor);
        // Combine scale mode processing with transform processing if needed
        // Transform processing (cropping) takes precedence over scale mode processing
        let finalProcessing = processing;
        if (raw.imageTransform) {
            const transformProcessing = handleImageTransform(raw.imageTransform);
            finalProcessing = {
                ...processing,
                ...transformProcessing,
                // Keep requiresImageDimensions from scale mode (needed for TILE)
                requiresImageDimensions: processing.requiresImageDimensions || transformProcessing.requiresImageDimensions,
            };
        }
        return {
            ...baseImageFill,
            ...css,
            imageDownloadArguments: finalProcessing,
        };
    }
    else if (raw.type === "SOLID") {
        // treat as SOLID
        const { hex, opacity } = convertColor(raw.color, raw.opacity);
        if (opacity === 1) {
            return hex;
        }
        else {
            return formatRGBAColor(raw.color, opacity);
        }
    }
    else if (raw.type === "PATTERN") {
        return parsePatternPaint(raw);
    }
    else if (["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(raw.type)) {
        return {
            type: raw.type,
            gradient: convertGradientToCss(raw),
        };
    }
    else {
        throw new Error(`Unknown paint type: ${raw.type}`);
    }
}
/**
 * Convert a Figma PatternPaint to a CSS-like pattern fill.
 *
 * Ignores `tileType` and `spacing` from the Figma API currently as there's
 * no great way to translate them to CSS.
 *
 * @param raw - The Figma PatternPaint to convert
 * @returns The converted pattern SimplifiedFill
 */
function parsePatternPaint(raw) {
    /**
     * The only CSS-like repeat value supported by Figma is repeat.
     *
     * They also have hexagonal horizontal and vertical repeats, but
     * those aren't easy to pull off in CSS, so we just use repeat.
     */
    let backgroundRepeat = "repeat";
    let horizontal = "left";
    switch (raw.horizontalAlignment) {
        case "START":
            horizontal = "left";
            break;
        case "CENTER":
            horizontal = "center";
            break;
        case "END":
            horizontal = "right";
            break;
    }
    let vertical = "top";
    switch (raw.verticalAlignment) {
        case "START":
            vertical = "top";
            break;
        case "CENTER":
            vertical = "center";
            break;
        case "END":
            vertical = "bottom";
            break;
    }
    return {
        type: raw.type,
        patternSource: {
            type: "IMAGE-PNG",
            nodeId: raw.sourceNodeId,
        },
        backgroundRepeat,
        backgroundSize: `${Math.round(raw.scalingFactor * 100)}%`,
        backgroundPosition: `${horizontal} ${vertical}`,
    };
}
/**
 * Convert hex color value and opacity to rgba format
 * @param hex - Hexadecimal color value (e.g., "#FF0000" or "#F00")
 * @param opacity - Opacity value (0-1)
 * @returns Color string in rgba format
 */
function hexToRgba(hex, opacity = 1) {
    // Remove possible # prefix
    hex = hex.replace("#", "");
    // Handle shorthand hex values (e.g., #FFF)
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    // Convert hex to RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Ensure opacity is in the 0-1 range
    const validOpacity = Math.min(Math.max(opacity, 0), 1);
    return `rgba(${r}, ${g}, ${b}, ${validOpacity})`;
}
/**
 * Convert color from RGBA to { hex, opacity }
 *
 * @param color - The color to convert, including alpha channel
 * @param opacity - The opacity of the color, if not included in alpha channel
 * @returns The converted color
 **/
function convertColor(color, opacity = 1) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    // Alpha channel defaults to 1. If opacity and alpha are both and < 1, their effects are multiplicative
    const a = Math.round(opacity * color.a * 100) / 100;
    const hex = ("#" +
        ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase());
    return { hex, opacity: a };
}
/**
 * Convert color from Figma RGBA to rgba(#, #, #, #) CSS format
 *
 * @param color - The color to convert, including alpha channel
 * @param opacity - The opacity of the color, if not included in alpha channel
 * @returns The converted color
 **/
function formatRGBAColor(color, opacity = 1) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    // Alpha channel defaults to 1. If opacity and alpha are both and < 1, their effects are multiplicative
    const a = Math.round(opacity * color.a * 100) / 100;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}
/**
 * Map gradient stops from Figma's handle-based coordinate system to CSS percentages
 */
function mapGradientStops(gradient, elementBounds = { width: 1, height: 1 }) {
    const handles = gradient.gradientHandlePositions;
    if (!handles || handles.length < 2) {
        const stops = gradient.gradientStops
            .map(({ position, color }) => {
            const cssColor = formatRGBAColor(color, 1);
            return `${cssColor} ${Math.round(position * 100)}%`;
        })
            .join(", ");
        return { stops, cssGeometry: "0deg" };
    }
    const [handle1, handle2, handle3] = handles;
    switch (gradient.type) {
        case "GRADIENT_LINEAR": {
            return mapLinearGradient(gradient.gradientStops, handle1, handle2, elementBounds);
        }
        case "GRADIENT_RADIAL": {
            return mapRadialGradient(gradient.gradientStops, handle1, handle2, handle3, elementBounds);
        }
        case "GRADIENT_ANGULAR": {
            return mapAngularGradient(gradient.gradientStops, handle1, handle2, handle3, elementBounds);
        }
        case "GRADIENT_DIAMOND": {
            return mapDiamondGradient(gradient.gradientStops, handle1, handle2, handle3, elementBounds);
        }
        default: {
            const stops = gradient.gradientStops
                .map(({ position, color }) => {
                const cssColor = formatRGBAColor(color, 1);
                return `${cssColor} ${Math.round(position * 100)}%`;
            })
                .join(", ");
            return { stops, cssGeometry: "0deg" };
        }
    }
}
/**
 * Map linear gradient from Figma handles to CSS
 */
function mapLinearGradient(gradientStops, start, end, elementBounds) {
    // Calculate the gradient line in element space
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const gradientLength = Math.sqrt(dx * dx + dy * dy);
    // Handle degenerate case
    if (gradientLength === 0) {
        const stops = gradientStops
            .map(({ position, color }) => {
            const cssColor = formatRGBAColor(color, 1);
            return `${cssColor} ${Math.round(position * 100)}%`;
        })
            .join(", ");
        return { stops, cssGeometry: "0deg" };
    }
    // Calculate angle for CSS
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    // Find where the extended gradient line intersects the element boundaries
    const extendedIntersections = findExtendedLineIntersections(start, end);
    if (extendedIntersections.length >= 2) {
        // The gradient line extended to fill the element
        const fullLineStart = Math.min(extendedIntersections[0], extendedIntersections[1]);
        const fullLineEnd = Math.max(extendedIntersections[0], extendedIntersections[1]);
        const fullLineLength = fullLineEnd - fullLineStart;
        // Map gradient stops from the Figma line segment to the full CSS line
        const mappedStops = gradientStops.map(({ position, color }) => {
            const cssColor = formatRGBAColor(color, 1);
            // Position along the Figma gradient line (0 = start handle, 1 = end handle)
            const figmaLinePosition = position;
            // The Figma line spans from t=0 to t=1
            // The full extended line spans from fullLineStart to fullLineEnd
            // Map the figma position to the extended line
            const tOnExtendedLine = figmaLinePosition * (1 - 0) + 0; // This is just figmaLinePosition
            const extendedPosition = (tOnExtendedLine - fullLineStart) / (fullLineEnd - fullLineStart);
            const clampedPosition = Math.max(0, Math.min(1, extendedPosition));
            return `${cssColor} ${Math.round(clampedPosition * 100)}%`;
        });
        return {
            stops: mappedStops.join(", "),
            cssGeometry: `${Math.round(angle)}deg`,
        };
    }
    // Fallback to simple gradient if intersection calculation fails
    const mappedStops = gradientStops.map(({ position, color }) => {
        const cssColor = formatRGBAColor(color, 1);
        return `${cssColor} ${Math.round(position * 100)}%`;
    });
    return {
        stops: mappedStops.join(", "),
        cssGeometry: `${Math.round(angle)}deg`,
    };
}
/**
 * Find where the extended gradient line intersects with the element boundaries
 */
function findExtendedLineIntersections(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Handle degenerate case
    if (Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10) {
        return [];
    }
    const intersections = [];
    // Check intersection with each edge of the unit square [0,1] x [0,1]
    // Top edge (y = 0)
    if (Math.abs(dy) > 1e-10) {
        const t = -start.y / dy;
        const x = start.x + t * dx;
        if (x >= 0 && x <= 1) {
            intersections.push(t);
        }
    }
    // Bottom edge (y = 1)
    if (Math.abs(dy) > 1e-10) {
        const t = (1 - start.y) / dy;
        const x = start.x + t * dx;
        if (x >= 0 && x <= 1) {
            intersections.push(t);
        }
    }
    // Left edge (x = 0)
    if (Math.abs(dx) > 1e-10) {
        const t = -start.x / dx;
        const y = start.y + t * dy;
        if (y >= 0 && y <= 1) {
            intersections.push(t);
        }
    }
    // Right edge (x = 1)
    if (Math.abs(dx) > 1e-10) {
        const t = (1 - start.x) / dx;
        const y = start.y + t * dy;
        if (y >= 0 && y <= 1) {
            intersections.push(t);
        }
    }
    // Remove duplicates and sort
    const uniqueIntersections = [
        ...new Set(intersections.map((t) => Math.round(t * 1000000) / 1000000)),
    ];
    return uniqueIntersections.sort((a, b) => a - b);
}
/**
 * Find where a line intersects with the unit square (0,0) to (1,1)
 */
function findLineIntersections(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const intersections = [];
    // Check intersection with each edge of the unit square
    const edges = [
        { x: 0, y: 0, dx: 1, dy: 0 }, // top edge
        { x: 1, y: 0, dx: 0, dy: 1 }, // right edge
        { x: 1, y: 1, dx: -1, dy: 0 }, // bottom edge
        { x: 0, y: 1, dx: 0, dy: -1 }, // left edge
    ];
    for (const edge of edges) {
        const t = lineIntersection(start, { x: dx, y: dy }, edge, { x: edge.dx, y: edge.dy });
        if (t !== null && t >= 0 && t <= 1) {
            intersections.push(t);
        }
    }
    return intersections.sort((a, b) => a - b);
}
/**
 * Calculate line intersection parameter
 */
function lineIntersection(p1, d1, p2, d2) {
    const denominator = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denominator) < 1e-10)
        return null; // Lines are parallel
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * d2.y - dy * d2.x) / denominator;
    return t;
}
/**
 * Map radial gradient from Figma handles to CSS
 */
function mapRadialGradient(gradientStops, center, edge, widthHandle, elementBounds) {
    const centerX = Math.round(center.x * 100);
    const centerY = Math.round(center.y * 100);
    const stops = gradientStops
        .map(({ position, color }) => {
        const cssColor = formatRGBAColor(color, 1);
        return `${cssColor} ${Math.round(position * 100)}%`;
    })
        .join(", ");
    return {
        stops,
        cssGeometry: `circle at ${centerX}% ${centerY}%`,
    };
}
/**
 * Map angular gradient from Figma handles to CSS
 */
function mapAngularGradient(gradientStops, center, angleHandle, widthHandle, elementBounds) {
    const centerX = Math.round(center.x * 100);
    const centerY = Math.round(center.y * 100);
    const angle = Math.atan2(angleHandle.y - center.y, angleHandle.x - center.x) * (180 / Math.PI) + 90;
    const stops = gradientStops
        .map(({ position, color }) => {
        const cssColor = formatRGBAColor(color, 1);
        return `${cssColor} ${Math.round(position * 100)}%`;
    })
        .join(", ");
    return {
        stops,
        cssGeometry: `from ${Math.round(angle)}deg at ${centerX}% ${centerY}%`,
    };
}
/**
 * Map diamond gradient from Figma handles to CSS (approximate with ellipse)
 */
function mapDiamondGradient(gradientStops, center, edge, widthHandle, elementBounds) {
    const centerX = Math.round(center.x * 100);
    const centerY = Math.round(center.y * 100);
    const stops = gradientStops
        .map(({ position, color }) => {
        const cssColor = formatRGBAColor(color, 1);
        return `${cssColor} ${Math.round(position * 100)}%`;
    })
        .join(", ");
    return {
        stops,
        cssGeometry: `ellipse at ${centerX}% ${centerY}%`,
    };
}
/**
 * Convert a Figma gradient to CSS gradient syntax
 */
function convertGradientToCss(gradient) {
    // Sort stops by position to ensure proper order
    const sortedGradient = {
        ...gradient,
        gradientStops: [...gradient.gradientStops].sort((a, b) => a.position - b.position),
    };
    // Map gradient stops using handle-based geometry
    const { stops, cssGeometry } = mapGradientStops(sortedGradient);
    switch (gradient.type) {
        case "GRADIENT_LINEAR": {
            return `linear-gradient(${cssGeometry}, ${stops})`;
        }
        case "GRADIENT_RADIAL": {
            return `radial-gradient(${cssGeometry}, ${stops})`;
        }
        case "GRADIENT_ANGULAR": {
            return `conic-gradient(${cssGeometry}, ${stops})`;
        }
        case "GRADIENT_DIAMOND": {
            return `radial-gradient(${cssGeometry}, ${stops})`;
        }
        default:
            return `linear-gradient(0deg, ${stops})`;
    }
}
