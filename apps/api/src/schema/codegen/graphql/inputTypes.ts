import {
  isComponentDefinition,
  type ComponentDefinition,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  type GraphQLInputFieldConfigMap,
  type GraphQLInputType,
} from 'graphql';
import { liveFields } from '../../../content/model.js';
import { COMPONENT_KEY } from '../../../content/validator/index.js';
import { AppError } from '../../../helpers/appError.js';
import { memoType, type SchemaBuild } from './build.js';
import { describeField } from './descriptions.js';
import { componentTypeName, fieldTypeName, modelTypeName } from './names.js';
import { enumType } from './outputTypes.js';

/**
 * Write inputs: `XInput` (models), `CInput` (components) and `XFieldZoneInput` (dynamic-zone items, one
 * optional key per allowed component; exactly one must be set). Every field is optional: writes are patches
 * (ADR 0001), `null` clears a field, and the content validator enforces required fields and every rule.
 */
const list = (type: GraphQLInputType) => new GraphQLList(new GraphQLNonNull(type));

const componentById = (build: SchemaBuild, id: string): ComponentDefinition | undefined => {
  const definition = build.snapshot.byId.get(id)?.definition;
  return definition && isComponentDefinition(definition) ? definition : undefined;
};

const fieldInputType = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition,
): GraphQLInputType | undefined => {
  switch (field.type) {
    case 'number':
      return GraphQLFloat;
    case 'integer':
      return build.fixed.int53;
    case 'boolean':
      return GraphQLBoolean;
    case 'json':
    case 'richtext':
      return build.fixed.json;
    case 'enum': {
      const type = enumType(build, owner, field);
      return field.settings.multiple ? list(type) : type;
    }
    case 'media':
    case 'relation': {
      const many = field.type === 'media' ? field.settings.multiple : field.settings.cardinality === 'many';
      return many ? list(GraphQLID) : GraphQLID;
    }
    case 'component': {
      const component = componentById(build, field.settings.component);
      const type = component ? componentInput(build, component) : null;
      if (!type) {
        return undefined;
      }
      return field.settings.repeatable ? list(type) : type;
    }
    case 'dynamiczone': {
      const type = zoneInput(build, owner, field);
      return type ? list(type) : undefined;
    }
    default:
      return GraphQLString;
  }
};

const inputFields = (build: SchemaBuild, owner: SchemaDefinition): GraphQLInputFieldConfigMap => {
  const fields: GraphQLInputFieldConfigMap = {};
  for (const field of liveFields(owner.fields)) {
    const type = fieldInputType(build, owner, field);
    if (type) {
      fields[field.apiKey] = { type, description: describeField(field) };
    }
  }
  return fields;
};

/** An input object, or null when it would have no fields (GraphQL forbids empty input objects). */
const inputObject = (
  build: SchemaBuild,
  key: string,
  name: string,
  fields: () => GraphQLInputFieldConfigMap,
): GraphQLInputObjectType | null =>
  memoType(build.inputs, key, () => {
    // Components cannot nest cyclically (the registry validator rejects cycles), so eager evaluation
    // terminates.
    const resolved = fields();
    return Object.keys(resolved).length === 0 ? null : new GraphQLInputObjectType({ name, fields: resolved });
  });

export const componentInput = (build: SchemaBuild, component: ComponentDefinition) =>
  inputObject(build, `component:${component.id}`, componentTypeName(component, 'Input'), () =>
    inputFields(build, component),
  );

const zoneInput = (build: SchemaBuild, owner: SchemaDefinition, field: FieldDefinition<'dynamiczone'>) =>
  inputObject(build, `zone:${owner.id}:${field.id}`, fieldTypeName(owner, field, 'ZoneInput'), () => {
    const fields: GraphQLInputFieldConfigMap = {};
    for (const id of field.settings.components) {
      const component = componentById(build, id);
      const type = component ? componentInput(build, component) : null;
      if (component && type) {
        fields[component.apiKey] = { type, description: `A ${component.label} item` };
      }
    }
    return fields;
  });

export const modelInput = (build: SchemaBuild, model: SchemaDefinition) =>
  inputObject(build, `model:${model.id}`, modelTypeName(model, 'Input'), () => inputFields(build, model));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidZoneItem = (field: FieldDefinition) =>
  new AppError(400, 'INVALID_INPUT', `Each "${field.apiKey}" item needs exactly one component key`, {
    field: field.apiKey,
  });

const toWriteValue = (build: SchemaBuild, field: FieldDefinition, value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  switch (field.type) {
    case 'component': {
      const component = componentById(build, field.settings.component);
      const convert = (item: unknown) =>
        component && isRecord(item) ? toWriteData(build, component, item) : item;
      return Array.isArray(value) ? value.map(convert) : convert(value);
    }
    case 'dynamiczone':
      return (Array.isArray(value) ? value : []).map((item) => {
        const keys = isRecord(item) ? Object.keys(item).filter((key) => item[key] != null) : [];
        const [key] = keys;
        const component = key ? build.snapshot.componentsByApiKey.get(key)?.definition : undefined;
        if (keys.length !== 1 || !key || !component || !isRecord(item) || !isComponentDefinition(component)) {
          throw invalidZoneItem(field);
        }
        return {
          [COMPONENT_KEY]: key,
          ...toWriteData(build, component, item[key] as Record<string, unknown>),
        };
      });
    default:
      return value;
  }
};

/** A GraphQL input object → the REST write shape (fields by API key; zone items with `__component`). */
export const toWriteData = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = liveFields(owner.fields).find((candidate) => candidate.apiKey === key);
    output[key] = field ? toWriteValue(build, field, value) : value;
  }
  return output;
};
