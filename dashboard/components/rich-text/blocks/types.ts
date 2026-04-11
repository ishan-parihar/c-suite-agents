export type EntityRefType = 'goal' | 'task' | 'person' | 'project' | 'meeting';

export interface EntityRefProps {
  id: string;
  title?: string;
  status?: string;
  type: EntityRefType;
}

export const ENTITY_REF_COLORS: Record<EntityRefType, { bg: string; icon: string; badge: string; hover: string }> = {
  goal: {
    bg: 'bg-blue-500/10',
    icon: 'text-blue-500',
    badge: 'bg-blue-500/20 text-blue-400',
    hover: 'hover:bg-blue-500/20',
  },
  task: {
    bg: 'bg-green-500/10',
    icon: 'text-green-500',
    badge: 'bg-green-500/20 text-green-400',
    hover: 'hover:bg-green-500/20',
  },
  person: {
    bg: 'bg-purple-500/10',
    icon: 'text-purple-500',
    badge: 'bg-purple-500/20 text-purple-400',
    hover: 'hover:bg-purple-500/20',
  },
  project: {
    bg: 'bg-orange-500/10',
    icon: 'text-orange-500',
    badge: 'bg-orange-500/20 text-orange-400',
    hover: 'hover:bg-orange-500/20',
  },
  meeting: {
    bg: 'bg-teal-500/10',
    icon: 'text-teal-500',
    badge: 'bg-teal-500/20 text-teal-400',
    hover: 'hover:bg-teal-500/20',
  },
};

export const ENTITY_REF_LABELS: Record<EntityRefType, string> = {
  goal: 'Goal',
  task: 'Task',
  person: 'Person',
  project: 'Project',
  meeting: 'Meeting',
};

export const ENTITY_REF_ROUTES: Record<EntityRefType, string> = {
  goal: '/goals',
  task: '/tasks',
  person: '/people',
  project: '/projects',
  meeting: '/meetings',
};
