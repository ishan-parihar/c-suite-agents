import { createReactBlockSpec } from "@blocknote/react";
import { CalendarRange } from "lucide-react";
import {
  ENTITY_REF_COLORS,
  ENTITY_REF_LABELS,
  ENTITY_REF_ROUTES,
} from "./types";

export const meetingRefBlock = createReactBlockSpec(
  {
    type: "meeting-ref",
    propSchema: {
      id: { default: "" },
      title: { default: "" },
      status: { default: "" },
    },
    content: "inline",
  },
  {
    render: ({ block }) => {
      const id = block.props.id as string;
      const title = (block.props.title as string) || "Untitled Meeting";
      const status = block.props.status as string;
      const colors = ENTITY_REF_COLORS.meeting;
      const route = ENTITY_REF_ROUTES.meeting;

      return (
        <a
          href={`${route}/${id}`}
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${colors.bg} ${colors.hover} cursor-pointer no-underline`}
          title={`Open ${ENTITY_REF_LABELS.meeting}: ${title}`}
          onClick={(e) => e.preventDefault()}
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-full ${colors.bg}`}>
            <CalendarRange className={`h-3.5 w-3.5 ${colors.icon}`} />
          </span>
          <span className="font-medium text-text">{title}</span>
          {status && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.badge}`}>
              {status}
            </span>
          )}
        </a>
      );
    },
  },
);
