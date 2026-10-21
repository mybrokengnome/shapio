/**
 * A problem found in a definition. `path` is a JSON pointer into the definition (`/fields/2/apiKey`), so
 * the admin can put the message next to the control and the CLI can point at the file location.
 */
export type ValidationIssue = {
  path: string;
  code: IssueCode;
  message: string;
  /** Set by cross-definition checks so a multi-definition apply can say which file is wrong. */
  definitionId?: string;
  /**
   * Interface issues on a member (`INTERFACE_FIELD_MISSING`, `INTERFACE_FIELD_MISMATCH`): the interface whose
   * contract is not met and the contract field's API ID, so the admin can offer to add the field.
   */
  interfaceId?: string;
  fieldApiKey?: string;
};

export type IssueCode =
  | 'INVALID_STRUCTURE'
  | 'INVALID_TEXT'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'API_KEY_INVALID'
  | 'API_KEY_TOO_LONG'
  | 'API_KEY_RESERVED_PREFIX'
  | 'API_KEY_RESERVED'
  | 'API_KEY_COLLISION'
  | 'PLURAL_API_KEY_SAME_AS_SINGULAR'
  | 'GENERATED_NAME_COLLISION'
  | 'INVALID_SETTINGS'
  | 'INVALID_RANGE'
  | 'INVALID_PATTERN'
  | 'DUPLICATE_ENUM_VALUE'
  | 'INVALID_ENUM_VALUE'
  | 'UNSUPPORTED_FLAG'
  | 'INVALID_DEFAULT_VALUE'
  | 'UNKNOWN_EDITOR'
  | 'INCOMPATIBLE_EDITOR'
  | 'INVALID_EDITOR_OPTIONS'
  | 'UNKNOWN_FIELD_REFERENCE'
  | 'INVALID_FIELD_REFERENCE'
  | 'DUPLICATE_GROUP'
  | 'UNKNOWN_REFERENCE'
  | 'INVALID_REFERENCE_TARGET'
  | 'COMPONENT_CYCLE'
  | 'COMPONENT_TOO_DEEP'
  | 'REFERENCED_DEFINITION'
  | 'UNKNOWN_PARENT'
  | 'INVALID_PARENT'
  | 'INHERITANCE_CYCLE'
  | 'INHERITANCE_TOO_DEEP'
  | 'INHERITED_FIELD_COLLISION'
  | 'INHERITED_FLAG_MISMATCH'
  | 'HAS_CHILDREN'
  | 'UNKNOWN_INTERFACE'
  | 'INVALID_INTERFACE'
  | 'INTERFACE_FIELD_MISSING'
  | 'INTERFACE_FIELD_MISMATCH'
  | 'INVALID_INTERFACE_FIELD'
  | 'HAS_MEMBERS';

export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      `Schema definition is invalid: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
    );
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

export const issue = (path: string, code: IssueCode, message: string): ValidationIssue => ({
  path,
  code,
  message,
});
