import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { campaigns } from '@/drizzle/schema/lifeos/campaigns';
import { z } from 'zod';

export const insertCampaignSchema = createInsertSchema(campaigns);
export const selectCampaignSchema = createSelectSchema(campaigns);
export const updateCampaignSchema = createUpdateSchema(campaigns);

export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type SelectCampaign = z.infer<typeof selectCampaignSchema>;
export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;
