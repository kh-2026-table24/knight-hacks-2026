import type { Issue } from "./issues";
import type { Vec2, Vec3 } from "./spec";

// Helpers for reading untrusted JSON (Claude's output, saved games) into typed values. Each problem is
// recorded as an Issue whose message starts with the exact path, so Claude can find what to fix.

type Fields = Record<string, unknown>;
export const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Descriptions longer than this are a sign Claude is writing prose where a phrase belongs.
const DEFAULT_MAX_TEXT = 300;

interface Optional {
  optional?: boolean;
}
export interface NumberRule extends Optional {
  min?: number;
  max?: number;
  /** Must be strictly greater than this. */
  above?: number;
  int?: boolean;
}
interface ListRule extends Optional {
  min?: number;
  max?: number;
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function describe(rule: NumberRule) {
  const bounds = [
    rule.above !== undefined && `above ${rule.above}`,
    rule.min !== undefined && `at least ${rule.min}`,
    rule.max !== undefined && `at most ${rule.max}`,
  ].filter(Boolean);
  return `${rule.int ? "a whole number" : "a number"}${bounds.length ? ` ${bounds.join(" and ")}` : ""}`;
}

const inRange = (v: number, rule: NumberRule) =>
  (!rule.int || Number.isInteger(v)) &&
  (rule.min === undefined || v >= rule.min) &&
  (rule.max === undefined || v <= rule.max) &&
  (rule.above === undefined || v > rule.above);

export class Reader {
  private errors = 0;

  constructor(readonly issues: Issue[] = []) {}

  get errorCount() {
    return this.errors;
  }

  error(path: string, message: string) {
    this.errors++;
    this.issues.push({ severity: "error", path, message });
  }

  /** Starts reading an object, reporting it if it isn't one, and any field not in `allowed`. */
  object(value: unknown, path: string, allowed: readonly string[]): Obj | undefined {
    if (!isFields(value)) {
      this.error(path, `${path || "The game"} must be a JSON object`);
      return undefined;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.error(join(path, key), `${path || "The game"} has an unknown field "${key}"; the allowed fields are ${allowed.join(", ")}`);
      }
    }
    return new Obj(this, value, path);
  }
}

/** One object being read. Each getter returns undefined (after recording why) when the value is missing or invalid. */
export class Obj {
  private readonly errorsBefore: number;

  constructor(
    private readonly reader: Reader,
    private readonly fields: Fields,
    readonly path: string,
  ) {
    this.errorsBefore = reader.errorCount;
  }

  /** Whether anything read from this object so far was wrong. */
  get failed() {
    return this.reader.errorCount > this.errorsBefore;
  }

  at(key: string) {
    return join(this.path, key);
  }

  has(key: string) {
    return this.fields[key] !== undefined;
  }

  /** The raw value, for fields whose shape depends on another field (an item's kind). */
  raw(key: string) {
    return this.fields[key];
  }

  error(key: string, problem: string): undefined {
    this.reader.error(this.at(key), `${this.at(key)} ${problem}`);
    return undefined;
  }

  private get(key: string, rule: Optional): unknown {
    const value = this.fields[key];
    if (value === undefined && !rule.optional) this.error(key, "is required");
    return value;
  }

  text(key: string, rule: Optional & { max?: number } = {}): string | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (typeof v !== "string" || !v.trim()) return this.error(key, "must be a non-empty string");
    const max = rule.max ?? DEFAULT_MAX_TEXT;
    if (v.length > max) return this.error(key, `must be at most ${max} characters, got ${v.length}`);
    return v.trim();
  }

  slug(key: string, rule: Optional = {}): string | undefined {
    const v = this.text(key, rule);
    if (v !== undefined && !SLUG.test(v)) return this.error(key, `must be a lowercase slug like "great-hall", got "${v}"`);
    return v;
  }

  color(key: string, rule: Optional = {}): string | undefined {
    const v = this.text(key, rule);
    if (v !== undefined && !HEX_COLOR.test(v)) return this.error(key, `must be a hex color like "#ffb060", got "${v}"`);
    return v;
  }

  num(key: string, rule: NumberRule = {}): number | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (!isNumber(v) || !inRange(v, rule)) return this.error(key, `must be ${describe(rule)}, got ${JSON.stringify(v)}`);
    return v;
  }

  bool(key: string, rule: Optional = {}): boolean | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") return this.error(key, "must be true or false");
    return v;
  }

  oneOf<T extends string>(key: string, options: readonly T[], rule: Optional = {}): T | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (!options.includes(v as T)) return this.error(key, `must be one of ${options.map((o) => `"${o}"`).join(", ")}, got ${JSON.stringify(v)}`);
    return v as T;
  }

  vec2(key: string, rule: Optional = {}): Vec2 | undefined {
    return this.vector(key, 2, rule) as Vec2 | undefined;
  }

  vec3(key: string, rule: Optional = {}): Vec3 | undefined {
    return this.vector(key, 3, rule) as Vec3 | undefined;
  }

  private vector(key: string, length: number, rule: Optional): number[] | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length !== length || !v.every(isNumber)) return this.error(key, `must be an array of ${length} numbers`);
    return [...v];
  }

  /** Reads an array, parsing each element at path key[i], labeled with the element's id when it has one. */
  array<T>(key: string, item: (value: unknown, path: string) => T | undefined, rule: ListRule = {}): T[] | undefined {
    const v = this.get(key, rule);
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) return this.error(key, "must be an array");
    if (rule.min !== undefined && v.length < rule.min) return this.error(key, `must have at least ${rule.min} ${rule.min === 1 ? "entry" : "entries"}`);
    if (rule.max !== undefined && v.length > rule.max) return this.error(key, `has ${v.length} entries; the limit is ${rule.max}`);
    const out: T[] = [];
    v.forEach((element, i) => {
      const label = isFields(element) && typeof element.id === "string" ? `(${element.id})` : "";
      const parsed = item(element, `${this.at(key)}[${i}]${label}`);
      if (parsed !== undefined) out.push(parsed);
    });
    return out;
  }

  /** Reads an array of non-empty strings, such as dialogue lines or animation poses. */
  strings(key: string, rule: ListRule & { maxLength?: number } = {}): string[] | undefined {
    const max = rule.maxLength ?? DEFAULT_MAX_TEXT;
    return this.array(
      key,
      (value, path) => {
        if (typeof value === "string" && value.trim() && value.length <= max) return value.trim();
        this.reader.error(path, `${path} must be a non-empty string of at most ${max} characters`);
        return undefined;
      },
      rule,
    );
  }
}
