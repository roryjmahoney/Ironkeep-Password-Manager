import type { CreditCardFields, IdentityFields, LoginFields, MutationContext, SecureNoteFields } from "./vault-mutations.js";
import {
  addCreditCard,
  addIdentity,
  addLogin,
  addSecureNote,
  findLikelyCreditCardDuplicates,
  findLikelyIdentityDuplicates,
  findLikelyLoginDuplicates,
  findLikelySecureNoteDuplicates,
} from "./vault-mutations.js";
import type { VaultPayload } from "./models.js";

const MAX_CSV_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_FIELD_LENGTH = 64 * 1024;
const HEADERS = [
  "kind", "title", "username", "password", "url", "notes", "cardholder_name", "card_number",
  "expiry_month", "expiry_year", "verification_code", "first_name", "middle_name", "last_name", "email",
  "phone", "company", "address_line_1", "address_line_2", "city", "region", "postal_code", "country",
] as const;

export type CsvImportRecord =
  | { kind: "login"; fields: LoginFields }
  | { kind: "secureNote"; fields: SecureNoteFields }
  | { kind: "creditCard"; fields: CreditCardFields }
  | { kind: "identity"; fields: IdentityFields };

export interface ParsedCsvImportRecord {
  record: CsvImportRecord;
  duplicate: boolean;
}

export interface CsvImportPreview {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
}

export interface ParsedCsvImport {
  preview: CsvImportPreview;
  records: ParsedCsvImportRecord[];
}

function escapeCsv(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportVaultCsv(payload: VaultPayload): string {
  const rows = payload.items.map((item): Array<string | number | undefined> => {
    if (item.kind === "login") {
      return ["login", item.title, item.username, item.password, item.uris.join("\n"), item.notes];
    }
    if (item.kind === "secureNote") {
      return ["secureNote", item.title, "", "", "", item.body];
    }
    if (item.kind === "creditCard") {
      return ["creditCard", item.title, "", "", "", item.notes, item.cardholderName, item.number, item.expiryMonth, item.expiryYear, item.verificationCode];
    }
    return [
      "identity", item.title, "", "", "", item.notes, "", "", "", "", "", item.firstName, item.middleName,
      item.lastName, item.email, item.phone, item.company, item.addressLine1, item.addressLine2, item.city,
      item.region, item.postalCode, item.country,
    ];
  });
  return `${HEADERS.join(",")}\r\n${rows.map((row) => HEADERS.map((_, index) => escapeCsv(row[index])).join(",")).join("\r\n")}\r\n`;
}

function parseCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength === 0 || new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    throw new RangeError("CSV file size is invalid");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      if (field.length > MAX_FIELD_LENGTH) throw new RangeError("CSV field is too large");
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (field.length > MAX_FIELD_LENGTH) throw new RangeError("CSV field is too large");
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new RangeError("CSV has too many rows");
    } else field += character;
  }
  if (quoted) throw new TypeError("CSV has an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function rowObject(headers: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header.trim().toLowerCase(), values[index]?.trim() ?? ""]));
}

function titleFromUrl(value: string): string {
  try {
    return new URL(value).hostname || "Imported login";
  } catch {
    return "Imported login";
  }
}

function recordFromRow(row: Record<string, string>, commonLogin: boolean): CsvImportRecord {
  const value = (key: string): string => row[key] ?? "";
  const kind = commonLogin ? "login" : value("kind");
  if (kind === "login") {
    return {
      kind,
      fields: {
        title: value("title") || value("name") || titleFromUrl(value("url")),
        username: value("username"),
        password: value("password"),
        uris: (value("url") || value("uris")).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean),
        androidPackageNames: [],
      },
    };
  }
  if (kind === "secureNote") return { kind, fields: { title: value("title"), body: value("notes") || value("body") } };
  if (kind === "creditCard") {
    return {
      kind,
      fields: {
        title: value("title"),
        cardholderName: value("cardholder_name"),
        number: value("card_number"),
        expiryMonth: Number(value("expiry_month")),
        expiryYear: Number(value("expiry_year")),
        verificationCode: value("verification_code"),
        notes: value("notes"),
      },
    };
  }
  if (kind === "identity") {
    return {
      kind,
      fields: {
        title: value("title"),
        firstName: value("first_name"),
        middleName: value("middle_name"),
        lastName: value("last_name"),
        email: value("email"),
        phone: value("phone"),
        company: value("company"),
        addressLine1: value("address_line_1"),
        addressLine2: value("address_line_2"),
        city: value("city"),
        region: value("region"),
        postalCode: value("postal_code"),
        country: value("country"),
        notes: value("notes"),
      },
    };
  }
  throw new TypeError("Unsupported CSV item kind");
}

function duplicate(payload: VaultPayload, record: CsvImportRecord): boolean {
  if (record.kind === "login") return findLikelyLoginDuplicates(payload, record.fields).length > 0;
  if (record.kind === "secureNote") return findLikelySecureNoteDuplicates(payload, record.fields).length > 0;
  if (record.kind === "creditCard") return findLikelyCreditCardDuplicates(payload, record.fields).length > 0;
  return findLikelyIdentityDuplicates(payload, record.fields).length > 0;
}

function addRecord(payload: VaultPayload, record: CsvImportRecord, context: MutationContext): VaultPayload {
  if (record.kind === "login") return addLogin(payload, record.fields, context);
  if (record.kind === "secureNote") return addSecureNote(payload, record.fields, context);
  if (record.kind === "creditCard") return addCreditCard(payload, record.fields, context);
  return addIdentity(payload, record.fields, context);
}

export function previewVaultCsvImport(payload: VaultPayload, csv: string): ParsedCsvImport {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new TypeError("CSV must include a header and at least one row");
  const headerRow = rows[0];
  if (!headerRow) throw new TypeError("CSV header is missing");
  const headers = headerRow.map((value) => value.trim().toLowerCase());
  const commonLogin = !headers.includes("kind") && headers.includes("url") && headers.includes("username") && headers.includes("password");
  if (!commonLogin && !headers.includes("kind")) throw new TypeError("CSV header is unsupported");

  let shadow = payload;
  const records: ParsedCsvImportRecord[] = [];
  let invalidRows = 0;
  for (const values of rows.slice(1)) {
    try {
      const record = recordFromRow(rowObject(headers, values), commonLogin);
      const isDuplicate = duplicate(shadow, record);
      shadow = addRecord(shadow, record, { deviceId: "csv-preview" });
      records.push({ record, duplicate: isDuplicate });
    } catch {
      invalidRows += 1;
    }
  }
  return {
    preview: {
      totalRows: rows.length - 1,
      validRows: records.length,
      duplicateRows: records.filter((entry) => entry.duplicate).length,
      invalidRows,
    },
    records,
  };
}

export function applyVaultCsvImport(
  payload: VaultPayload,
  records: ParsedCsvImportRecord[],
  includeDuplicates: boolean,
  context: MutationContext,
): VaultPayload {
  return records.reduce(
    (current, entry) => entry.duplicate && !includeDuplicates ? current : addRecord(current, entry.record, context),
    payload,
  );
}
