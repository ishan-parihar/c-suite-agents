import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { projects } from '@/drizzle/schema/lifeos/projects';
import { z } from 'zod';

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);
export const updateProjectSchema = createUpdateSchema(projects);

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type SelectProject = z.infer<typeof selectProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
