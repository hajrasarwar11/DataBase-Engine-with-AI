import { pgTable, serial, text, integer, timestamp, boolean, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const databasesTable = pgTable("databases", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDatabaseSchema = createInsertSchema(databasesTable).omit({ id: true, createdAt: true });
export type InsertDatabase = z.infer<typeof insertDatabaseSchema>;
export type Database = typeof databasesTable.$inferSelect;

export const collectionsTable = pgTable("collections", {
  id: serial("id").primaryKey(),
  databaseId: integer("database_id").notNull().references(() => databasesTable.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  recordCount: integer("record_count").default(0).notNull(),
  schema: jsonb("schema"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCollectionSchema = createInsertSchema(collectionsTable).omit({ id: true, createdAt: true });
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type Collection = typeof collectionsTable.$inferSelect;

export const recordsTable = pgTable("records", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull().references(() => collectionsTable.id),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRecordSchema = createInsertSchema(recordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecord = z.infer<typeof insertRecordSchema>;
export type Record = typeof recordsTable.$inferSelect;

export const queryHistoryTable = pgTable("query_history", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  databaseId: integer("database_id"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  executionTimeMs: numeric("execution_time_ms").notNull(),
  success: boolean("success").notNull(),
  rowCount: integer("row_count"),
  errorMessage: text("error_message"),
});

export const insertQueryHistorySchema = createInsertSchema(queryHistoryTable).omit({ id: true, executedAt: true });
export type InsertQueryHistory = z.infer<typeof insertQueryHistorySchema>;
export type QueryHistory = typeof queryHistoryTable.$inferSelect;
