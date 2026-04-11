import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { User, FolderKanban, CheckSquare } from "lucide-react";

/**
 * Mentionable entity returned from the CRUD API.
 */
export interface MentionableEntity {
  id: string;
  name: string;
  type: "person" | "project" | "task";
  subtitle?: string;
}

const ENTITY_ICONS: Record<MentionableEntity["type"], React.ComponentType<{ className?: string }>> = {
  person: User,
  project: FolderKanban,
  task: CheckSquare,
};

/**
 * Fetch mentionable entities from the CRUD API.
 * Fetches people, projects, and tasks with a small limit.
 */
async function fetchMentionableEntities(): Promise<MentionableEntity[]> {
  const entities: MentionableEntity[] = [];

  const fetches = [
    { slug: "people", type: "person" as const, nameField: "name", subtitleField: "email" },
    { slug: "projects", type: "project" as const, nameField: "name", subtitleField: "status" },
    { slug: "tasks", type: "task" as const, nameField: "name", subtitleField: "status" },
  ];

  const results = await Promise.allSettled(
    fetches.map(async ({ slug, type, nameField, subtitleField }) => {
      const res = await fetch(`/api/crud/${slug}?limit=50`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const json = await res.json();
      const items = json?.data?.items ?? json?.data ?? [];
      return items.map((item: Record<string, unknown>) => ({
        id: String(item.id),
        name: String(item[nameField] ?? "Untitled"),
        type,
        subtitle: subtitleField ? String(item[subtitleField] ?? "") : undefined,
      })) as MentionableEntity[];
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      entities.push(...result.value);
    }
  }

  return entities;
}

/**
 * Simple fuzzy filter for mention items.
 */
function filterMentionItems(
  items: DefaultReactSuggestionItem[],
  query: string,
): DefaultReactSuggestionItem[] {
  if (!query) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => {
    const inTitle = item.title.toLowerCase().includes(lower);
    const inSubtext = (item.subtext ?? "").toLowerCase().includes(lower);
    return inTitle || inSubtext;
  });
}

/**
 * Cache for mentionable entities to avoid refetching on every keystroke.
 */
let entitiesCache: MentionableEntity[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function getMentionableEntities(): Promise<MentionableEntity[]> {
  const now = Date.now();
  if (entitiesCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return entitiesCache;
  }
  entitiesCache = await fetchMentionableEntities();
  cacheTimestamp = now;
  return entitiesCache;
}

/**
 * Create @mention suggestion items from entities.
 * Used as the getItems callback for the SuggestionMenuController.
 */
export async function createMentionItems<
  BSchema extends BlockSchema,
  ICSchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ICSchema, SSchema>,
  query: string,
): Promise<DefaultReactSuggestionItem[]> {
  const entities = await getMentionableEntities();

  const items: DefaultReactSuggestionItem[] = entities.map((entity) => {
    const Icon = ENTITY_ICONS[entity.type];
    return {
      title: entity.name,
      subtext: entity.subtitle ?? entity.type,
      aliases: [entity.type, entity.name],
      group: entity.type.charAt(0).toUpperCase() + entity.type.slice(1) + "s",
      icon: <Icon className="h-4 w-4" />,
      onItemClick: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editor as any).insertInlineContent([
          {
            type: "mention",
            props: {
              id: entity.id,
              label: `@${entity.name}`,
              href: `/${entity.type}s/${entity.id}`,
            },
          },
          " ",
        ]);
      },
    };
  });

  return filterMentionItems(items, query);
}
