import {
  ValidationError,
  ValidationErrorItem,
  type Model,
  type ModelAttributeColumnOptions,
  type Sequelize,
} from "sequelize";
import { type ZodType } from "zod";

export type SequelizeZodSchema = ZodType;

export type ZodAttributeOptions = ModelAttributeColumnOptions & {
  schema?: SequelizeZodSchema;
};

declare module "sequelize" {
  interface ModelAttributeColumnOptions {
    schema?: SequelizeZodSchema;
  }
}

const registeredSequelizeInstances = new WeakSet<Sequelize>();

function formatIssueValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function sequelizeZod(sequelize: Sequelize): void {
  if (!sequelize) {
    throw new TypeError("The required sequelize instance option is missing");
  }

  if (registeredSequelizeInstances.has(sequelize)) {
    return;
  }

  sequelize.addHook("beforeValidate", async (instance: Model, options) => {
    const modelConstructor = instance.constructor as typeof Model;
    const rawAttributes = modelConstructor.rawAttributes;
    const fields =
      instance.isNewRecord || !options.fields
        ? Object.keys(rawAttributes)
        : options.fields;

    if (fields.length === 0) {
      return;
    }

    const validationErrors: ValidationErrorItem[] = [];
    const modelName = instance.constructor.name;
    const parsedValues = new Map<string, unknown>();

    for (const fieldName of fields) {
      const fieldDefinition = rawAttributes[fieldName];
      const schema = fieldDefinition?.schema;

      if (!schema) {
        continue;
      }

      const result = await schema.safeParseAsync(instance.get(fieldName));

      if (result.success) {
        parsedValues.set(fieldName, result.data);
        continue;
      }

      for (const issue of result.error.issues) {
        const path = [fieldName, ...issue.path].join(".");
        validationErrors.push(
          new ValidationErrorItem(
            `${modelName}.${path}: ${issue.message}`,
            "validation error",
            path,
            formatIssueValue(issue.input),
            instance,
            "zod",
            "safeParseAsync",
            [],
          ),
        );
      }
    }

    if (validationErrors.length > 0) {
      throw new ValidationError("Validation failed", validationErrors);
    }

    for (const [fieldName, value] of parsedValues) {
      instance.set(fieldName, value);
    }
  });

  registeredSequelizeInstances.add(sequelize);
}
