import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { boardMeetings } from '@/drizzle/schema/operations/boardMeetings';
import { z } from 'zod';

export const insertMeetingSchema = createInsertSchema(boardMeetings);
export const selectMeetingSchema = createSelectSchema(boardMeetings);
export const updateMeetingSchema = createUpdateSchema(boardMeetings);

export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type SelectMeeting = z.infer<typeof selectMeetingSchema>;
export type UpdateMeeting = z.infer<typeof updateMeetingSchema>;
