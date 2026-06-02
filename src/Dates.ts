/**
 * Date processing helpers for Obsidian-compatible frontmatter values.
 *
 * Obsidian's DateValue.parseFromString expects an ISO 8601 date or date-time string:
 * https://docs.obsidian.md/Reference/TypeScript+API/DateValue/parseFromString#DateValue.parseFromString()+method
 *
 * This module accepts ISO-like input and can also return a user-facing Luxon-formatted string.
 */
import { DateTime } from "luxon";

/**
 * Converts an input date string into:
 * 1) a user-facing date string (optionally formatted with Luxon), and
 * 2) an Obsidian-safe ISO value for frontmatter.
 *
 * Supported inputs:
 * - "now": resolves to the current local date-time.
 * - compact numeric date "YYYYMMDD" (for example, "20240101").
 * - ISO 8601 date/date-time strings.
 *
 * @param ISO8601String Input date token.
 * @param userFormat Optional Luxon format for the user-facing output.
 * @param locale Locale used by Luxon when formatting the user-facing output.
 * @returns Object with userFriendlyDate and frontmatterSafeDate.
 */
export function processDate(
  ISO8601String: string,
  userFormat: string = "",
  locale: string = "en-US"
): { userFriendlyDate: string; frontmatterSafeDate: string } {
  const trimmed = ISO8601String.trim();

  // --- Special case: literal "now" ---
  if (trimmed.toLowerCase() === "now") {
    const now = DateTime.now(); // current local date-time
    const isoNow = now.toISO(); // full ISO 8601 value (for example: "2024-01-01T13:07:04.054-04:00")

    let luxonDate: string;
    if (userFormat) {
      luxonDate = now.setLocale(locale).toFormat(userFormat);
    } else {
      luxonDate = isoNow; // return ISO when no user format is provided
    }

    return {
      userFriendlyDate: luxonDate,
      frontmatterSafeDate: isoNow, // keep the resolved ISO value for frontmatter
    };
  }

  // --- Case: compact numeric literal (digits only, no separators) ---
  // Example: "20240101"
  if (/^\d{8}$/.test(trimmed)) {
    const isoDate = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    const dt = DateTime.fromISO(isoDate);

    let luxonDate: string;
    if (userFormat) {
      luxonDate = dt.setLocale(locale).toFormat(userFormat);
    } else {
      luxonDate = trimmed; // keep "YYYYMMDD" as user-facing literal
    }

    return {
      userFriendlyDate: luxonDate,
      frontmatterSafeDate: isoDate, // "YYYY-MM-DD" is safe for Obsidian frontmatter
    };
  }

  // --- Standard case: ISO 8601 string (date only or date-time with optional offset) ---
  const dt = DateTime.fromISO(trimmed);
  if (!dt.isValid) {
    console.warn(`Invalid ISO 8601 string: ${trimmed}`);
    return { userFriendlyDate: "", frontmatterSafeDate: "" };
  }

  const frontmatterSafeDate = trimmed; // keep original value as-is (already ISO)

  let luxonDate: string;
  if (userFormat) {
    luxonDate = dt.setLocale(locale).toFormat(userFormat);
  } else {
    luxonDate = frontmatterSafeDate; // no user format: return original ISO value
  }

  return { userFriendlyDate: luxonDate, frontmatterSafeDate };
}