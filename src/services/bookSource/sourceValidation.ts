import Ajv2020 from "ajv/dist/2020";
import { load } from "cheerio/slim";
import { BookSource } from "../../models/BookSource";
import { bookSourceSchema } from "./bookSourceSchema";

export interface SourceValidationResult {
  valid: boolean;
  errors: string[];
  source?: BookSource;
}

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validateSchema = ajv.compile(bookSourceSchema);

const fieldSuffix = /@(text|html|[A-Za-z_:][\w:.-]*)$/;
const selectorFromRule = (rule: string) => rule.replace(fieldSuffix, "").trim();

const collectSelectorRules = (source: BookSource): [string, string][] => {
  const rules: [string, string][] = [
    ["search.list", source.search.list],
    ["search.fields.title", source.search.fields.title],
    ["search.fields.detailUrl", source.search.fields.detailUrl],
    ["detail.fields.tocUrl", source.detail.fields.tocUrl],
    ["toc.list", source.toc.list],
    ["toc.fields.title", source.toc.fields.title],
    ["toc.fields.url", source.toc.fields.url],
    ["content.body", source.content.body],
  ];
  const optional: [string, string | undefined][] = [
    ["search.fields.author", source.search.fields.author],
    ["search.fields.cover", source.search.fields.cover],
    ["detail.fields.title", source.detail.fields.title],
    ["detail.fields.author", source.detail.fields.author],
    ["detail.fields.cover", source.detail.fields.cover],
    ["detail.fields.description", source.detail.fields.description],
  ];
  optional.forEach(([path, rule]) => rule && rules.push([path, rule]));
  (source.content.remove || []).forEach((rule, index) =>
    rules.push([`content.remove[${index}]`, rule])
  );
  return rules;
};

const validateSelectors = (source: BookSource): string[] => {
  const $ = load("<main></main>");
  return collectSelectorRules(source).flatMap(([path, rule]) => {
    const selector = selectorFromRule(rule);
    if (!selector) return [];
    try {
      $(selector);
      return [];
    } catch {
      return [`${path} contains an invalid CSS selector`];
    }
  });
};

const validateBaseUrl = (source: BookSource): string[] => {
  try {
    const url = new URL(source.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return ["baseUrl must use http or https"];
    }
    return [];
  } catch {
    return ["baseUrl must be an absolute URL"];
  }
};

export const validateBookSource = (input: unknown): SourceValidationResult => {
  if (!validateSchema(input)) {
    return {
      valid: false,
      errors: (validateSchema.errors || []).map(
        (error) => `${error.instancePath || "/"} ${error.message || "is invalid"}`
      ),
    };
  }
  const source = input as BookSource;
  const errors = [...validateBaseUrl(source), ...validateSelectors(source)];
  return errors.length
    ? { valid: false, errors }
    : { valid: true, errors: [], source };
};

export const parseBookSourceJson = (text: string): SourceValidationResult[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return [
      {
        valid: false,
        errors: [error instanceof Error ? error.message : "Invalid JSON"],
      },
    ];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length > 100) {
    return [{ valid: false, errors: ["A source pack may contain at most 100 sources"] }];
  }
  return items.map(validateBookSource);
};
