/**
 * Calculates conversion factors to base unit for all units in a product's unit tree.
 * The base unit has conversionToBase = 1.
 * Each child unit has multiplier relative to the unit directly beneath it.
 */
export function calculateUnitConversions(units, baseUnitId) {
    if (!units || units.length === 0)
        return [];
    // Map of unit id to unit
    const unitMap = new Map();
    units.forEach((u) => {
        unitMap.set(u.id, { ...u });
    });
    // Base unit check
    const baseUnit = unitMap.get(baseUnitId);
    if (baseUnit) {
        baseUnit.conversionToBase = 1;
        baseUnit.multiplier = 1;
        baseUnit.childUnitId = null;
    }
    // Recursive resolver for conversion to base
    const visited = new Set();
    function getConversionToBase(unitId) {
        if (unitId === baseUnitId)
            return 1;
        if (visited.has(unitId)) {
            // Prevent cyclic recursion
            return 1;
        }
        visited.add(unitId);
        const unit = unitMap.get(unitId);
        if (!unit)
            return 1;
        if (!unit.childUnitId || unit.childUnitId === unitId) {
            return 1;
        }
        const childConversion = getConversionToBase(unit.childUnitId);
        const totalConversion = Math.max(1, (unit.multiplier || 1) * childConversion);
        unit.conversionToBase = totalConversion;
        return totalConversion;
    }
    // Calculate for all units
    units.forEach((u) => {
        visited.clear();
        const conv = getConversionToBase(u.id);
        const existing = unitMap.get(u.id);
        if (existing) {
            existing.conversionToBase = conv;
        }
    });
    return Array.from(unitMap.values());
}
/**
 * Formats a stock quantity into a multi-unit representation.
 * E.g., 378 pieces with:
 *   - كرتونة (24 pieces)
 *   - باكيت (6 pieces)
 *   - حبة (1 piece)
 * Yields: "15 كرتونة + 3 باكيت"
 */
export function formatStockInUnits(baseQuantity, units, baseUnitName = 'حبة') {
    if (baseQuantity === 0) {
        return `0 ${baseUnitName}`;
    }
    const isNegative = baseQuantity < 0;
    let remaining = Math.abs(baseQuantity);
    if (!units || units.length === 0) {
        return `${baseQuantity} ${baseUnitName}`;
    }
    // Sort units by conversionToBase descending (largest first)
    const sortedUnits = [...units].sort((a, b) => (b.conversionToBase || 1) - (a.conversionToBase || 1));
    const parts = [];
    for (const unit of sortedUnits) {
        const factor = unit.conversionToBase || 1;
        if (factor > 1 && remaining >= factor) {
            const count = Math.floor(remaining / factor);
            remaining = remaining % factor;
            if (count > 0) {
                parts.push(`${count} ${unit.name}`);
            }
        }
        else if (factor === 1 && remaining > 0) {
            // Remaining base units (can be decimal if weighed item)
            const formattedRem = Number.isInteger(remaining) ? remaining : remaining.toFixed(2);
            parts.push(`${formattedRem} ${unit.name}`);
            remaining = 0;
        }
    }
    if (parts.length === 0) {
        return `${baseQuantity} ${baseUnitName}`;
    }
    const result = parts.join(' + ');
    return isNegative ? `- (${result})` : result;
}
/**
 * Converts a quantity from one unit to another
 */
export function convertQuantity(quantity, fromUnit, toUnit) {
    const fromFactor = fromUnit.conversionToBase || 1;
    const toFactor = toUnit.conversionToBase || 1;
    const baseQty = quantity * fromFactor;
    return baseQty / toFactor;
}
/**
 * Convert quantity from a unit to base unit
 */
export function toBaseQuantity(quantity, unit) {
    return quantity * (unit.conversionToBase || 1);
}
/**
 * Convert quantity from base unit to a specific unit
 */
export function fromBaseQuantity(baseQuantity, unit) {
    const factor = unit.conversionToBase || 1;
    return factor > 0 ? baseQuantity / factor : baseQuantity;
}
/**
 * Searches a product for which specific unit contains the given barcode.
 */
export function findUnitByBarcode(product, barcode) {
    const cleanBarcode = barcode.trim().toLowerCase();
    for (const unit of product.units) {
        if (unit.barcodes && unit.barcodes.some((b) => b.trim().toLowerCase() === cleanBarcode)) {
            return unit;
        }
    }
    // Check if matches SKU or product code as fallback to default unit
    if (product.sku.toLowerCase() === cleanBarcode || product.internalCode.toLowerCase() === cleanBarcode) {
        return product.units.find((u) => u.isDefaultSale) || product.units[0] || null;
    }
    return null;
}
export { formatStockInUnits as formatStockBreakdown };
