import { createInlineContentSpec } from "@blocknote/core";

export const mentionInlineContent = createInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      id: { default: "" },
      label: { default: "" },
      href: { default: "" },
    },
    content: "styled",
  },
  {
    render: (inlineContent) => {
      const dom = document.createElement("a");
      dom.href = inlineContent.props.href;
      dom.className =
        "inline-flex items-center rounded-md bg-violet-500/15 px-1.5 py-0.5 text-sm font-medium text-violet-400 no-underline hover:bg-violet-500/25";
      dom.textContent = inlineContent.props.label;
      dom.addEventListener("click", (e) => e.preventDefault());
      return { dom };
    },
  },
);
