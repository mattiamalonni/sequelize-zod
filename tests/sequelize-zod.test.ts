import { DataTypes, Sequelize, ValidationError } from "sequelize";
import { z } from "zod";
import { sequelizeZod } from "../src/index.js";

describe("sequelizeZod", () => {
  let sequelize: Sequelize;

  beforeEach(() => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    sequelizeZod(sequelize);
  });

  afterEach(async () => {
    await sequelize.close();
  });

  it("validates changed attributes and stores transformed values", async () => {
    const User = sequelize.define("User", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().trim().min(3),
      },
    });
    await sequelize.sync();

    const user = await User.create({ username: "  Mattia  " });

    expect(user.get("username")).toBe("Mattia");
  });

  it("applies Zod defaults to omitted attributes on create", async () => {
    const Defaults = sequelize.define("Defaults", {
      name: {
        type: DataTypes.STRING,
        schema: z.string().default("guest"),
      },
    });
    await sequelize.sync();

    const row = await Defaults.create({});

    expect(row.get("name")).toBe("guest");
  });

  it("supports optional, nullable, and coercion schemas", async () => {
    const Settings = sequelize.define("Settings", {
      label: {
        type: DataTypes.STRING,
        schema: z.string().optional(),
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
        schema: z.string().nullable(),
      },
      retries: {
        type: DataTypes.INTEGER,
        schema: z.coerce.number().int().nonnegative(),
      },
    });
    await sequelize.sync();

    const settings = await Settings.create({
      description: null,
      retries: "2",
    });

    expect(settings.get("label")).toBeUndefined();
    expect(settings.get("description")).toBeNull();
    expect(settings.get("retries")).toBe(2);
  });

  it("returns every Zod issue as a Sequelize validation item", async () => {
    const User = sequelize.define("User", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(5).max(8),
      },
    });
    await sequelize.sync();

    await expect(User.create({ username: "a" })).rejects.toMatchObject({
      name: "SequelizeValidationError",
      errors: [
        expect.objectContaining({
          path: "username",
          type: "validation error",
        }),
      ],
    });
  });

  it("collects issues from multiple attributes", async () => {
    const User = sequelize.define("MultipleErrors", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(3),
      },
      email: {
        type: DataTypes.STRING,
        schema: z.string().email(),
      },
    });
    await sequelize.sync();

    await expect(
      User.create({ username: "x", email: "invalid" }),
    ).rejects.toMatchObject({
      name: "SequelizeValidationError",
      errors: [
        expect.objectContaining({ path: "username" }),
        expect.objectContaining({ path: "email" }),
      ],
    });
  });

  it("does not run schemas for unchanged attributes on update", async () => {
    const User = sequelize.define("User", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(3),
      },
      age: {
        type: DataTypes.INTEGER,
        schema: z.number().int().positive(),
      },
    });
    await sequelize.sync();
    const user = await User.create({ username: "valid", age: 1 });

    user.set("username", "updated");
    await expect(user.save()).resolves.toBe(user);
  });

  it("validates every schema during explicit instance validation", async () => {
    const User = sequelize.define("ExplicitValidation", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(3),
      },
    });
    await sequelize.sync();
    const user = await User.create({ username: "valid" });

    user.dataValues.username = "x";

    await expect(user.validate()).rejects.toMatchObject({
      name: "SequelizeValidationError",
      errors: [expect.objectContaining({ path: "username" })],
    });
  });

  it("respects explicit validation fields", async () => {
    const User = sequelize.define("SelectedValidation", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(3),
      },
      age: {
        type: DataTypes.INTEGER,
        schema: z.number().positive(),
      },
    });
    await sequelize.sync();
    const user = await User.create({ username: "valid", age: 1 });

    user.dataValues.age = -1;
    await expect(user.validate({ fields: ["username"] })).resolves.toBe(user);
    await expect(user.validate()).rejects.toMatchObject({
      name: "SequelizeValidationError",
      errors: [expect.objectContaining({ path: "age" })],
    });
  });

  it("supports asynchronous Zod schemas", async () => {
    const User = sequelize.define("AsyncValidation", {
      token: {
        type: DataTypes.STRING,
        schema: z.string().refine(async () => false, "Token is invalid"),
      },
    });
    await sequelize.sync();

    await expect(User.create({ token: "abc" })).rejects.toMatchObject({
      name: "SequelizeValidationError",
      errors: [
        expect.objectContaining({
          path: "token",
          message: expect.stringContaining("Token is invalid"),
        }),
      ],
    });
  });

  it("propagates unexpected schema exceptions", async () => {
    const User = sequelize.define("UnexpectedSchemaError", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().transform(() => {
          throw new Error("Unexpected schema failure");
        }),
      },
    });
    await sequelize.sync();

    await expect(User.create({ username: "valid" })).rejects.toThrow(
      "Unexpected schema failure",
    );
  });

  it("propagates persistence errors after successful validation", async () => {
    const User = sequelize.define("PersistenceError", {
      username: {
        type: DataTypes.STRING,
        unique: true,
        schema: z.string().trim(),
      },
    });
    await sequelize.sync();
    await User.create({ username: "Alice" });
    const duplicate = User.build({ username: " Alice " });

    await expect(duplicate.save()).rejects.toMatchObject({
      name: "SequelizeUniqueConstraintError",
    });
    expect(duplicate.get("username")).toBe("Alice");
  });

  it("does not partially apply transforms when another schema fails", async () => {
    const User = sequelize.define("AtomicValidation", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().trim(),
      },
      email: {
        type: DataTypes.STRING,
        schema: z.string().email(),
      },
    });
    await sequelize.sync();
    const user = User.build({ username: "  Mattia  ", email: "invalid" });

    await expect(user.validate()).rejects.toBeInstanceOf(ValidationError);
    expect(user.get("username")).toBe("  Mattia  ");
  });

  it("registers only one hook per Sequelize instance", async () => {
    let parseCount = 0;
    sequelizeZod(sequelize);
    const User = sequelize.define("IdempotentValidation", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().transform((value) => {
          parseCount += 1;
          return value;
        }),
      },
    });
    await sequelize.sync();

    await User.create({ username: "Mattia" });

    expect(parseCount).toBe(1);
  });

  it("supports bulk validation with Sequelize individual hooks", async () => {
    const User = sequelize.define("BulkValidation", {
      username: {
        type: DataTypes.STRING,
        schema: z.string().min(3),
      },
    });
    await sequelize.sync();

    await expect(
      User.bulkCreate([{ username: "x" }], {
        validate: true,
        individualHooks: true,
      }),
    ).rejects.toMatchObject({ name: "AggregateError" });
  });

  it("fails fast when no Sequelize instance is provided", () => {
    expect(() => sequelizeZod(undefined as unknown as Sequelize)).toThrow(
      "The required sequelize instance option is missing",
    );
  });
});
