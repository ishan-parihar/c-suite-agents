import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { z } from 'zod';

export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);
export const updateTaskSchema = createUpdateSchema(tasks);

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type SelectTask = z.infer<typeof selectTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
