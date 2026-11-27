import type { Contact } from "@/types/crm";
import {
  POSITIONAL_IMPORT_FIELDS,
  type ContactImportResult,
  type DuplicateHandlingMode,
  type DuplicateMatchSource,
  type ImportContactInput,
  type ImportNameRule,
  type ImportRowResult,
  type ImportRowStatus,
} from "./contactImportTypes.ts";
import {
  buildExistingPhoneMatchMap,
  detectDelimiter,
  isPlaceholderContactName,
  mapHeaderToField,
  normalizeImportPhone,
  normalizeImportRowFields,
  splitCsvLine,
  type ExistingPhoneMatch,
} from "./contactImportRowHelpers.ts";

export {
  detectDelimiter,
  isPlaceholderContactName,
  normalizeImportPhone,
  splitCsvLine,
  type ContactImportResult,
  type DuplicateHandlingMode,
  type DuplicateMatchSource,
  type ExistingPhoneMatch,
  type ImportContactInput,
  type ImportNameRule,
  type ImportRowResult,
  type ImportRowStatus,
};

/** Generate final contact display name with optional prefix/suffix and fallback rule. */
export function applyImportNameRule(
  rawName: string | undefined,
  phoneE164: string | undefined,
  sequenceIndex: number,
  nameRule: ImportNameRule
): string {
  const generatedFallback =
    nameRule.fallback === "sequence"
      ? `客户-${String(sequenceIndex + 1).padStart(3, "0")}`
      : `客户-${(phoneE164 || "").replace(/\D/g, "").slice(-4) || String(sequenceIndex + 1).padStart(3, "0")}`;
  return `${nameRule.prefix}${rawName?.trim() || generatedFallback}${nameRule.suffix}`.trim();
}

type ColumnResolution = {
  hasHeader: boolean;
  headers: string[];
  fieldToIndex: Partial<Record<keyof ImportContactInput, number>>;
  missingPhoneColumn: boolean;
};

function resolveImportColumns(
  nonEmptyLines: string[],
  delimiter: string,
  explicitHasHeader?: boolean
): ColumnResolution {
  const firstRowCells = splitCsvLine(nonEmptyLines[0]!, delimiter);
  const detectedHeaderFields = firstRowCells
    .map((cell) => mapHeaderToField(cell))
    .filter((field): field is keyof ImportContactInput => field !== null);
  const hasHeader =
    explicitHasHeader !== undefined
      ? explicitHasHeader
      : detectedHeaderFields.includes("phone") || detectedHeaderFields.includes("name");

  const fieldToIndex: Partial<Record<keyof ImportContactInput, number>> = {};
  if (hasHeader) {
    firstRowCells.forEach((cell, colIndex) => {
      const mappedField = mapHeaderToField(cell);
      if (mappedField) fieldToIndex[mappedField] = colIndex;
    });
    return {
      hasHeader: true,
      headers: [...firstRowCells],
      fieldToIndex,
      missingPhoneColumn: fieldToIndex.phone === undefined,
    };
  }

  if (firstRowCells.length === 1 && normalizeImportPhone(firstRowCells[0] || "")) {
    fieldToIndex.phone = 0;
  } else {
    firstRowCells.forEach((_, colIndex) => {
      const positionalField = POSITIONAL_IMPORT_FIELDS[colIndex];
      if (positionalField) fieldToIndex[positionalField] = colIndex;
    });
  }
  return {
    hasHeader: false,
    headers: firstRowCells.map((_, colIndex) => `col${colIndex + 1}`),
    fieldToIndex,
    missingPhoneColumn: false,
  };
}

function evaluateImportDataRows(
  nonEmptyLines: string[],
  startLineIndex: number,
  delimiter: string,
  fieldToIndex: Partial<Record<keyof ImportContactInput, number>>,
  existingByPhone: Map<string, ExistingPhoneMatch>
): ImportRowResult[] {
  const seenPhonesInBatch = new Set<string>();
  const evaluatedRows: ImportRowResult[] = [];
  const mappedEntries = Object.entries(fieldToIndex) as [keyof ImportContactInput, number][];

  for (let rowIndex = startLineIndex; rowIndex < nonEmptyLines.length; rowIndex++) {
    const lineNumber = rowIndex + 1;
    const rowCells = splitCsvLine(nonEmptyLines[rowIndex]!, delimiter);
    const rawFields = {} as Record<keyof ImportContactInput, string>;
    for (const [fieldKey, columnIndex] of mappedEntries) {
      rawFields[fieldKey] = rowCells[columnIndex] || "";
    }
    const parsedInput = normalizeImportRowFields(rawFields);
    if (!parsedInput.phone) {
      evaluatedRows.push({
        line: lineNumber,
        status: "skip_no_phone",
        reason: parsedInput.name ? "无有效手机号" : "无姓名且无手机号",
        input: parsedInput,
      });
      continue;
    }
    if (seenPhonesInBatch.has(parsedInput.phone)) {
      evaluatedRows.push({
        line: lineNumber,
        status: "skip_dup",
        reason: "表格内重复号码",
        input: parsedInput,
        duplicateSource: "batch_duplicate",
      });
      continue;
    }
    seenPhonesInBatch.add(parsedInput.phone);
    const existingMatch = existingByPhone.get(parsedInput.phone);
    if (existingMatch) {
      evaluatedRows.push({
        line: lineNumber,
        status: "skip_dup",
        reason: "手机号已存在",
        input: parsedInput,
        duplicateSource: "existing_account",
        existingContactId: existingMatch.primaryContactId || undefined,
        existingContactIds: existingMatch.allContactIds,
        existingContactName: existingMatch.displayName || undefined,
        existingContactHasHumanName: existingMatch.hasHumanName,
      });
      continue;
    }
    evaluatedRows.push({ line: lineNumber, status: "ready", input: parsedInput });
  }
  return evaluatedRows;
}

/** Parse pasted spreadsheet cells or CSV text into validated import rows with duplicate diagnostics. */
export function parseContactsImport(
  rawText: string,
  existingContacts: Partial<Contact>[],
  options?: { hasHeader?: boolean }
): ContactImportResult {
  const nonEmptyLines = String(rawText || "")
    .split(/\r?\n/)
    .filter((lineText) => lineText.trim().length > 0);
  if (!nonEmptyLines.length) {
    return {
      rows: [],
      created: [],
      skipped: [],
      errors: [],
      detectedDelimiter: ",",
      headers: [],
      hasHeader: false,
    };
  }
  const delimiter = detectDelimiter(nonEmptyLines.join("\n"));
  const columnResolution = resolveImportColumns(nonEmptyLines, delimiter, options?.hasHeader);
  const startLineIndex = columnResolution.hasHeader ? 1 : 0;

  if (columnResolution.missingPhoneColumn) {
    const errorRows: ImportRowResult[] = nonEmptyLines.slice(startLineIndex).map((_, offset) => ({
      line: startLineIndex + offset + 1,
      status: "error",
      reason: "未识别到电话列，请确认表头含「电话/手机号/phone」",
    }));
    return {
      rows: errorRows,
      created: [],
      skipped: [],
      errors: errorRows,
      detectedDelimiter: delimiter,
      headers: columnResolution.headers,
      hasHeader: true,
    };
  }

  const existingByPhone = buildExistingPhoneMatchMap(existingContacts);
  const evaluatedRows = evaluateImportDataRows(
    nonEmptyLines,
    startLineIndex,
    delimiter,
    columnResolution.fieldToIndex,
    existingByPhone
  );
  return {
    rows: evaluatedRows,
    created: evaluatedRows.filter((row) => row.status === "ready"),
    skipped: evaluatedRows.filter((row) => row.status === "skip_dup" || row.status === "skip_no_phone"),
    errors: evaluatedRows.filter((row) => row.status === "error"),
    detectedDelimiter: delimiter,
    headers: columnResolution.headers,
    hasHeader: columnResolution.hasHeader,
  };
}
