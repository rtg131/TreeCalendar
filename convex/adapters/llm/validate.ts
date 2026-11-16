import type { GenericValidator } from "convex/values";

type AnyValidator = GenericValidator & {
  kind: string;
  isOptional: "optional" | "required";
  fields?: Record<string, AnyValidator>;
  members?: AnyValidator[];
  element?: AnyValidator;
  value?: unknown;
  key?: AnyValidator;
};

export function validateValue(validator: GenericValidator, value: unknown, path = "$"): string[] {
  const val = validator as AnyValidator;
  if (value === undefined) {
    return val.isOptional === "optional" ? [] : [`${path}: required`];
  }
  switch (val.kind) {
    case "any":
      return [];
    case "string":
      return typeof value === "string" ? [] : [`${path}: expected string`];
    case "float64":
      return typeof value === "number" ? [] : [`${path}: expected number`];
    case "int64":
      return typeof value === "bigint" ? [] : [`${path}: expected int64`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "null":
      return value === null ? [] : [`${path}: expected null`];
    case "id":
      return typeof value === "string" ? [] : [`${path}: expected id`];
    case "bytes":
      return value instanceof ArrayBuffer ? [] : [`${path}: expected bytes`];
    case "literal":
      return value === val.value ? [] : [`${path}: expected ${JSON.stringify(val.value)}`];
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array`];
      return value.flatMap((item, i) => validateValue(val.element!, item, `${path}[${i}]`));
    case "record":
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: expected record`];
      return Object.entries(value).flatMap(([k, item]) => [
        ...validateValue(val.key!, k, `${path}.<key>`),
        ...validateValue(val.value as AnyValidator, item, `${path}.${k}`),
      ]);
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: expected object`];
      const fields = val.fields!;
      const extra = Object.keys(value).filter((k) => !(k in fields)).map((k) => `${path}.${k}: unexpected field`);
      return [
        ...extra,
        ...Object.entries(fields).flatMap(([k, f]) => validateValue(f, (value as Record<string, unknown>)[k], `${path}.${k}`)),
      ];
    }
    case "union":
      return val.members!.some((m) => validateValue(m, value, path).length === 0) ? [] : [`${path}: matches no union member`];
    default:
      return [`${path}: unsupported validator kind ${val.kind}`];
  }
}
