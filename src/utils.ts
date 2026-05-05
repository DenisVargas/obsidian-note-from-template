// Original function was "ucFirst".
export function capitalize(s: string): string {
    return s[0].toUpperCase() + s.substring(1) 
}

/**
 * Ensures that the provided value is a string array.
 *
 * This utility function normalizes different input types into a predictable string array.
 * It handles falsy values, arrays, and strings, falling back to a backup array when
 * the input cannot be converted.
 *
 * @param input - The input value to normalize. Accepts:
 *            - `string` → wrapped as a single-element array
 *            - `string[]` → returned as-is
 *            - falsy values (`null`, `undefined`, `false`, `0`, `""`) → returns the backup array
 *            - any other type → returns the backup array (as a safe fallback)
 * @param backup - Default array used when `a` is falsy, not an array, or not a string.
 *                 If `backup` itself is falsy, an empty array is used instead.
 * @returns A guaranteed `string[]`:
 *          - If `input` is a non‑empty array → `a`
 *          - If `input` is a string → `[input]`
 *          - Otherwise → `backup` (or `[]` if `backup` is also falsy)
 *
 * @example
 * // Returns ["hello"]
 * ensureArray("hello", []);
 *
 * @example
 * // Returns ["a", "b"]
 * ensureArray(["a", "b"], ["default"]);
 *
 * @example
 * // Returns ["default"]
 * ensureArray(null, ["default"]);
 *
 * @example
 * // Returns [] (backup is falsy)
 * ensureArray(undefined, null);
 */
export function ensureArray(input:any, backup:string[]) : string[] {
    const backupValue = backup ? backup : []
    if( !input ) return backupValue
    if( input instanceof Array ) return input
    if( typeof input === "string" ) return [input]
    return backupValue
}