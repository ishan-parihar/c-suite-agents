import { createReactBlockSpec } from "@blocknote/react";
import { useState, useCallback } from "react";

const CALLOUT_COLORS = {
  blue: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    icon: "text-blue-500",
  },
  amber: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    icon: "text-amber-500",
  },
  green: {
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    icon: "text-green-500",
  },
  purple: {
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    icon: "text-purple-500",
  },
  rose: {
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    icon: "text-rose-500",
  },
  gray: {
    bg: "bg-gray-500/10",
    border: "border-gray-500/20",
    icon: "text-gray-500",
  },
} as const;

type CalloutColor = keyof typeof CALLOUT_COLORS;

const COLOR_BUTTONS: { value: CalloutColor; label: string; dot: string }[] = [
  { value: "blue", label: "Blue", dot: "bg-blue-500" },
  { value: "amber", label: "Amber", dot: "bg-amber-500" },
  { value: "green", label: "Green", dot: "bg-green-500" },
  { value: "purple", label: "Purple", dot: "bg-purple-500" },
  { value: "rose", label: "Rose", dot: "bg-rose-500" },
  { value: "gray", label: "Gray", dot: "bg-gray-500" },
];

const COMMON_EMOJIS = ["💡", "⚠️", "✅", "❌", "📌", "🔔", "🎯", "💬", "📝", "🚀", "ℹ️", "🔥"];

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: { default: "left" },
      icon: { default: "💡" },
      color: { default: "blue" },
    },
    content: "inline",
  } as const,
  {
    render: (props) => {
      const { editor, block, contentRef } = props;
      const icon = (block.props.icon as string) || "💡";
      const color = (block.props.color as CalloutColor) || "blue";
      const [showPicker, setShowPicker] = useState(false);
      const [pickerTab, setPickerTab] = useState<"color" | "icon">("color");

      const colors = CALLOUT_COLORS[color];

      const updateIcon = useCallback(
        (newIcon: string) => {
          editor.updateBlock(block, {
            props: { icon: newIcon },
          });
          setShowPicker(false);
        },
        [editor, block],
      );

      const updateColor = useCallback(
        (newColor: CalloutColor) => {
          editor.updateBlock(block, {
            props: { color: newColor },
          });
        },
        [editor, block],
      );

      return (
        <div className={`relative rounded-lg border-l-4 ${colors.border} ${colors.bg} p-3`}>
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => {
                setPickerTab("icon");
                setShowPicker(!showPicker);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-xs hover:bg-black/10"
              title="Change icon"
            >
              {icon}
            </button>
            <button
              type="button"
              onClick={() => {
                setPickerTab("color");
                setShowPicker(!showPicker);
              }}
              className={`h-3 w-3 rounded-full ${colors.icon.replace("text-", "bg-")} ring-1 ring-black/10`}
              title="Change color"
            />
          </div>

          {showPicker && (
            <div className="absolute right-2 top-10 z-10 w-56 rounded-lg border border-border bg-background p-2 shadow-lg">
              <div className="mb-2 flex gap-1">
                {(["color", "icon"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setPickerTab(tab)}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
                      pickerTab === tab
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {pickerTab === "color" && (
                <div className="grid grid-cols-6 gap-1">
                  {COLOR_BUTTONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => updateColor(c.value)}
                      className={`flex h-7 w-7 items-center justify-center rounded-full ${c.dot} ${
                        color === c.value ? "ring-2 ring-primary ring-offset-1" : ""
                      }`}
                      title={c.label}
                    />
                  ))}
                </div>
              )}

              {pickerTab === "icon" && (
                <div>
                  <div className="grid grid-cols-6 gap-1">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => updateIcon(emoji)}
                        className={`flex h-7 w-7 items-center justify-center rounded text-sm ${
                          icon === emoji ? "bg-primary/10" : "hover:bg-muted"
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="Type emoji..."
                    className="mt-2 w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) updateIcon(val);
                      }
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pr-12">
            <span className="mt-0.5 shrink-0 select-none text-base">{icon}</span>
            <div ref={contentRef} className="min-w-0 flex-1" />
          </div>
        </div>
      );
    },
  },
);
