import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { annualGoals } from '@/drizzle/schema/lifeos/annual_goals';
import { z } from 'zod';

export const insertGoalSchema = createInsertSchema(annualGoals);
export const selectGoalSchema = createSelectSchema(annualGoals);
export const updateGoalSchema = createUpdateSchema(annualGoals);

export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type SelectGoal = z.infer<typeof selectGoalSchema>;
export type UpdateGoal = z.infer<typeof updateGoalSchema>;
