const fieldRule = { type: "string", minLength: 1, maxLength: 500 } as const;

const fieldsObject = (properties: Record<string, unknown>, required: string[]) =>
  ({
    type: "object",
    additionalProperties: false,
    properties,
    required,
  }) as const;

export const bookSourceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://koodo-reader.local/schema/book-source-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "schemaVersion",
    "name",
    "baseUrl",
    "enabled",
    "search",
    "detail",
    "toc",
    "content",
  ],
  properties: {
    id: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
    },
    schemaVersion: { const: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    baseUrl: { type: "string", minLength: 8, maxLength: 2048 },
    allowedHosts: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 253,
        pattern: "^[A-Za-z0-9.-]+$",
      },
    },
    description: { type: "string", maxLength: 500 },
    enabled: { type: "boolean" },
    search: {
      type: "object",
      additionalProperties: false,
      required: ["request", "list", "fields"],
      properties: {
        request: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 2048 },
            method: { enum: ["GET"] },
            headers: {
              type: "object",
              maxProperties: 24,
              propertyNames: {
                pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$",
                maxLength: 100,
              },
              additionalProperties: {
                type: "string",
                maxLength: 1000,
                pattern: "^[^\\r\\n]*$",
              },
            },
          },
        },
        list: fieldRule,
        fields: fieldsObject(
          {
            title: fieldRule,
            author: fieldRule,
            cover: fieldRule,
            detailUrl: fieldRule,
          },
          ["title", "detailUrl"]
        ),
      },
    },
    detail: {
      type: "object",
      additionalProperties: false,
      required: ["fields"],
      properties: {
        fields: fieldsObject(
          {
            title: fieldRule,
            author: fieldRule,
            cover: fieldRule,
            description: fieldRule,
            tocUrl: fieldRule,
          },
          ["tocUrl"]
        ),
      },
    },
    toc: {
      type: "object",
      additionalProperties: false,
      required: ["list", "fields"],
      properties: {
        list: fieldRule,
        fields: fieldsObject(
          { title: fieldRule, url: fieldRule },
          ["title", "url"]
        ),
      },
    },
    content: {
      type: "object",
      additionalProperties: false,
      required: ["body"],
      properties: {
        body: fieldRule,
        remove: {
          type: "array",
          maxItems: 64,
          items: fieldRule,
        },
      },
    },
  },
} as const;
