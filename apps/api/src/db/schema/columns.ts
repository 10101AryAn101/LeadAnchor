import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/** Time-sortable UUIDv7 primary key. */
export const pk = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const tsz = (name: string) => timestamp(name, { withTimezone: true });
