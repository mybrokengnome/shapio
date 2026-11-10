import type { DefinitionIndex } from '../inheritance/resolve.js';
import type { FieldDefinition } from '../types/definitions.js';

/**
 * Schema lenses (plan schema-lenses): a client names the schema version it was built against and reads
 * today's content in that version's shape. A lens is computed from two definitions matched by stable IDs:
 * the one the content is stored under (`stored`, today's) and the one the client knows (`client`, at its
 * version). It never replays recorded steps: every real conversion has already been applied to the stored
 * value, so the only question is how to present that one value in the client's type.
 */

/**
 * One side of a lens: definitions by ID (`get`) and a model's effective definition with inherited fields
 * (`resolve`). A `SchemaSnapshot` view gives it as `{ get: (id) => view.byId.get(id)?.definition, resolve:
 * view.resolve }`; a `DefinitionIndex` is one already.
 */
export type LensSide = Pick<DefinitionIndex, 'get' | 'resolve'>;

/** Why a client field reads null (`[]` for lists) through the lens. */
export type LensNullReason =
  /** The field no longer exists (removed, or lost with a parent model). */
  | 'removed'
  /** Its storage changed to one Shapio has no converter back from: no stored value can be shown. */
  | 'dropped'
  /** A component field now holds another component: the stored instances are not the client's. */
  | 'componentChanged';

/**
 * How one field of the client's definition reads from storage, in the client's field order:
 * - `same`: every stored value is valid for the client as it is (at most a rename); `nested` carries the
 *   lenses of the components it holds, which may differ on their own;
 * - `convert`: the stored value is converted to the client's type and re-checked against it; a value that
 *   does not fit reads null (`[]`);
 * - `null`: always null (`[]`).
 * `apiKey` is the client's API ID; `client` and `stored` are the two field definitions.
 */
export type FieldLens =
  | {
      kind: 'same';
      fieldId: string;
      apiKey: string;
      client: FieldDefinition;
      stored: FieldDefinition;
      nested?: NestedLens;
    }
  | {
      kind: 'convert';
      fieldId: string;
      apiKey: string;
      client: FieldDefinition;
      stored: FieldDefinition;
      nested?: NestedLens;
    }
  | {
      kind: 'null';
      fieldId: string;
      apiKey: string;
      client: FieldDefinition;
      stored: FieldDefinition | null;
      /** The client's field is a list: it reads `[]`, not null. */
      list: boolean;
      reason: LensNullReason;
    };

/**
 * The lenses of the components a component or dynamic-zone field holds on the client's side, by component
 * ID. null: a component the client names that it does not know itself (never for a valid schema).
 */
export type NestedLens = { components: ReadonlyMap<string, DefinitionLens | null> };

/**
 * - `identity`: nothing to translate: same API ID and route, every field `same` under the same API ID, and
 *   every nested lens an identity too;
 * - `lensed`: something differs;
 * - `gone`: the definition no longer exists (reads through the lens are refused: 404);
 * - `uncovered`: a model whose kind changed (collection ↔ singleton); the lens does not hide it (409).
 */
export type DefinitionLensStatus = 'identity' | 'lensed' | 'gone' | 'uncovered';

export type DefinitionLens = {
  definitionId: string;
  status: DefinitionLensStatus;
  /** The client's API ID of the definition. */
  apiKey: string;
  /** Today's API ID; null when the definition is gone. */
  storedApiKey: string | null;
  /** One per field of the client's definition, in its order. */
  fields: readonly FieldLens[];
  /** Client API ID → stable field ID. */
  apiKeyToFieldId: ReadonlyMap<string, string>;
  /**
   * Today's fields the client does not know (added since its version), by stable ID. Reads ignore them; a
   * write that replaces a whole component instance would drop their values, so it is refused.
   */
  addedFieldIds: readonly string[];
};

/** What a client on an older schema version sees, from least to most affected. */
export const LENS_EFFECTS = ['transparent', 'converted', 'lossy', 'nulled', 'gone', 'uncovered'] as const;
export type LensEffect = (typeof LENS_EFFECTS)[number];
