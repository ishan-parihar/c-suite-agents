import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { goalRefBlock } from "./goal-ref-block";
import { taskRefBlock } from "./task-ref-block";
import { personRefBlock } from "./person-ref-block";
import { projectRefBlock } from "./project-ref-block";
import { meetingRefBlock } from "./meeting-ref-block";
import { calloutBlock } from "./callout-block";
import { mentionInlineContent } from "./mention-inline";

export { goalRefBlock } from "./goal-ref-block";
export { taskRefBlock } from "./task-ref-block";
export { personRefBlock } from "./person-ref-block";
export { projectRefBlock } from "./project-ref-block";
export { meetingRefBlock } from "./meeting-ref-block";
export { calloutBlock } from "./callout-block";

export {
  ENTITY_REF_COLORS,
  ENTITY_REF_LABELS,
  ENTITY_REF_ROUTES,
} from "./types";
export type { EntityRefProps, EntityRefType } from "./types";

export {
  createEntityRefSlashItems,
  getCustomSlashMenuItems,
  filterCustomSlashMenuItems,
} from "./slash-items";

export { createMentionItems } from "./mention-items";
export type { MentionableEntity } from "./mention-items";

export const customBlockSpecs = {
  "goal-ref": goalRefBlock(),
  "task-ref": taskRefBlock(),
  "person-ref": personRefBlock(),
  "project-ref": projectRefBlock(),
  "meeting-ref": meetingRefBlock(),
  callout: calloutBlock(),
};

export const entityRefSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...customBlockSpecs,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionInlineContent,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
  },
});
