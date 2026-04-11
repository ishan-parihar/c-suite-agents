import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { people } from '@/drizzle/schema/lifeos/people';
import { z } from 'zod';

export const insertPersonSchema = createInsertSchema(people);
export const selectPersonSchema = createSelectSchema(people);
export const updatePersonSchema = createUpdateSchema(people);

export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type SelectPerson = z.infer<typeof selectPersonSchema>;
export type UpdatePerson = z.infer<typeof updatePersonSchema>;
