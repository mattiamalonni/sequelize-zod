# sequelize-zod

Type-safe validation for Sequelize model attributes, powered by [Zod](https://zod.dev/).

`sequelize-zod` connects Zod schemas to Sequelize's validation lifecycle. Define a schema alongside an attribute, and the schema is checked automatically before Sequelize validates or persists the instance.

## Requirements

- Node.js 24 or newer
- Sequelize 6
- Zod 4
- TypeScript 5 or newer for TypeScript projects

Sequelize and Zod are peer dependencies. Install them with the package:

```bash
npm install sequelize-zod sequelize zod
```

## Quick start

```ts
import { DataTypes, Sequelize } from "sequelize";
import { sequelizeZod } from "sequelize-zod";
import { z } from "zod";

const sequelize = new Sequelize("sqlite::memory:");

// Register the hook before defining models.
sequelizeZod(sequelize);

const User = sequelize.define("User", {
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    schema: z.string().trim().min(3).max(30),
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    schema: z.string().trim().email(),
  },
});

await sequelize.sync();

const user = await User.create({
  username: "  mattia  ",
  email: "mattia@example.com",
});

user.get("username"); // "mattia"
```

The package augments Sequelize's `ModelAttributeColumnOptions` type, so `schema` is accepted and checked directly inside `sequelize.define`.

## CommonJS

The package also ships a CommonJS build:

```js
const { DataTypes, Sequelize } = require("sequelize");
const { sequelizeZod } = require("sequelize-zod");
const { z } = require("zod");

const sequelize = new Sequelize("sqlite::memory:");
sequelizeZod(sequelize);

const User = sequelize.define("User", {
  email: {
    type: DataTypes.STRING,
    schema: z.string().email(),
  },
});
```

## How validation works

The plugin registers one `beforeValidate` hook on the Sequelize instance passed to `sequelizeZod`.

- On create, every attribute with a `schema` is parsed, including omitted attributes with Zod defaults.
- On update, only changed attributes are parsed.
- Calling `instance.validate()` without a field filter parses every attribute with a `schema`.
- A successful parse writes the parsed value back to the instance. This includes Zod transforms and defaults.
- All schemas are evaluated before any parsed value is written, so a failed validation cannot partially apply transforms.
- Every Zod issue becomes a Sequelize `ValidationErrorItem`.
- Attributes without a `schema` continue through Sequelize's regular validation.
- Schemas may use synchronous or asynchronous Zod refinements and transforms.
- For `bulkCreate`, pass both `validate: true` and `individualHooks: true` to run schemas for each row. Sequelize reports failures as an `AggregateError`.
- Database errors that happen after validation are propagated by Sequelize. The hook does not roll back transformed values on an in-memory instance after a failed SQL write.

Register the hook before creating or updating models. Registration is idempotent for each Sequelize instance.

## Handling validation errors

Zod failures are exposed as Sequelize's standard `ValidationError`, so existing Sequelize error handling continues to work:

```ts
import { ValidationError } from "sequelize";

try {
  await User.create({
    username: "x",
    email: "not-an-email",
  });
} catch (error) {
  if (error instanceof ValidationError) {
    for (const item of error.errors) {
      console.log(item.path, item.message);
    }
  }
}
```

Nested Zod paths are appended to the attribute name. For example, an issue at `profile.name` is exposed with the path `profile.name`.

## API

### `sequelizeZod(sequelize): void`

Registers Zod validation on a Sequelize instance.

```ts
import { sequelizeZod } from "sequelize-zod";

sequelizeZod(sequelize);
```

The function throws a `TypeError` when no Sequelize instance is provided.

### `SequelizeZodSchema`

Type alias for the Zod schema accepted by an attribute's `schema` option.

### `ZodAttributeOptions`

Type helper combining Sequelize's `ModelAttributeColumnOptions` with the optional `schema` property.

Zod itself is intentionally not re-exported. Import schemas from `zod`:

```ts
import { z } from "zod";
```

## Migration notes

When replacing an existing Sequelize validation integration:

1. Install `sequelize-zod`, `sequelize`, and `zod`.
2. Register `sequelizeZod(sequelize)` before defining models.
3. Import `z` directly from `zod` and place schemas in each attribute's `schema` option.
4. Review optional, nullable, coercion, and default behavior when translating schemas between validation libraries.

Zod strings are required by default. For example, an email field can be defined as:

```ts
schema: z.string().trim().email();
```

## Development

```bash
npm install
npm run check
npm test
npm run test:coverage
npm run build
```

`npm run check` runs the TypeScript compiler, ESLint, and the Prettier check. To apply formatting locally, run `npm run format`; use `npm run lint:fix` for ESLint's automatic fixes.

`npm run test:coverage` runs the test suite with V8 coverage thresholds for statements, branches, functions, and lines.

The test suite uses Sequelize with an in-memory SQLite database. CI verifies the minimum and latest supported Sequelize 6 and Zod 4 peer versions. The build produces ESM, CommonJS, and TypeScript declaration files in `dist/`.

## Releases

GitHub Actions runs type checking, tests, and the production build for pushes and pull requests. Creating a GitHub Release publishes the matching package version to npm after verification.

Publishing uses npm Trusted Publishing through GitHub Actions OIDC. Configure the repository and the `publish.yml` workflow as a trusted publisher on npm before creating a release.

## License

MIT © Mattia Malonni
