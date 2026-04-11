import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import {
  Target,
  CheckSquare,
  User,
  FolderKanban,
  CalendarRange,
  Highlighter,
} from "lucide-react";

interface EntitySlashItemConfig {
  type: string;
  title: string;
  subtitle: string;
  aliases: string[];
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

const ENTITY_SLASH_ITEMS: EntitySlashItemConfig[] = [
  {
    type: "goal-ref",
    title: "Goal Reference",
    subtitle: "Link to a goal",
    aliases: ["goal", "objective", "target"],
    icon: Target,
    group: "References",
  },
  {
    type: "task-ref",
    title: "Task Reference",
    subtitle: "Link to a task",
    aliases: ["task", "todo", "action item"],
    icon: CheckSquare,
    group: "References",
  },
  {
    type: "person-ref",
    title: "Person Reference",
    subtitle: "Link to a person",
    aliases: ["person", "contact", "user", "people"],
    icon: User,
    group: "References",
  },
  {
    type: "project-ref",
    title: "Project Reference",
    subtitle: "Link to a project",
    aliases: ["project", "initiative", "folder"],
    icon: FolderKanban,
    group: "References",
  },
  {
    type: "meeting-ref",
    title: "Meeting Reference",
    subtitle: "Link to a meeting",
    aliases: ["meeting", "event", "calendar", "sync"],
    icon: CalendarRange,
    group: "References",
  },
  {
    type: "callout",
    title: "Callout",
    subtitle: "Highlighted note with icon and color",
    aliases: ["callout", "note", "highlight", "info", "warning", "tip"],
    icon: Highlighter,
    group: "Advanced",
  },
];

/**
 * Simple fuzzy filter for suggestion items.
 * Matches against title, subtitle, and aliases.
 */
function filterItems(
  items: DefaultReactSuggestionItem[],
  query: string,
): DefaultReactSuggestionItem[] {
  if (!query) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => {
    const inTitle = item.title.toLowerCase().includes(lower);
    const inSubtext = (item.subtext ?? "").toLowerCase().includes(lower);
    const inAliases = (item.aliases ?? []).some((alias) =>
      alias.toLowerCase().includes(lower),
    );
    return inTitle || inSubtext || inAliases;
  });
}

/**
 * Create custom slash menu items for entity reference blocks.
 * Returns items that can be merged with getDefaultReactSlashMenuItems().
 */
export function createEntityRefSlashItems<
  BSchema extends BlockSchema,
  ICSchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ICSchema, SSchema>,
): DefaultReactSuggestionItem[] {
  return ENTITY_SLASH_ITEMS.map((config) => ({
    title: config.title,
    subtext: config.subtitle,
    aliases: config.aliases,
    group: config.group,
    onItemClick: () => {
      const cursorPos = editor.getTextCursorPosition();
      editor.insertBlocks([{ type: config.type }], cursorPos.block, "after");
    },
  }));
}

/**
 * Get all slash menu items (defaults + entity references).
 * Use this as the getItems prop for SuggestionMenuController.
 */
export function getCustomSlashMenuItems<
  BSchema extends BlockSchema,
  ICSchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ICSchema, SSchema>,
): DefaultReactSuggestionItem[] {
  return [
    ...getDefaultReactSlashMenuItems(editor),
    ...createEntityRefSlashItems(editor),
  ];
}

/**
 * Filter slash menu items by query string.
 */
export function filterCustomSlashMenuItems<
  BSchema extends BlockSchema,
  ICSchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ICSchema, SSchema>,
  query: string,
): DefaultReactSuggestionItem[] {
  return filterItems(getCustomSlashMenuItems(editor), query);
}
