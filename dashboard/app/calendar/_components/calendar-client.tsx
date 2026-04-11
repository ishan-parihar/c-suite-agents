"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Users, AlignLeft } from "lucide-react";
import Link from "next/link";
import { cn, truncate } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { CalendarEvent } from "@/lib/server/calendar";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_EVENTS_PER_CELL = 3;

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  project: { label: "Project", color: "var(--accent-secondary)" },
  campaign: { label: "Campaign", color: "var(--status-warning)" },
  activity: { label: "Activity", color: "var(--status-healthy)" },
  content: { label: "Content", color: "#8B5CF6" },
  calendar: { label: "Calendar", color: "var(--accent-primary)" },
};

function getMonthDates(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const dates: (number | null)[][] = [];
  let day = 1;
  for (let week = 0; week < 6; week++) {
    const weekDates: (number | null)[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const weekIndex = week * 7 + dow;
      if (weekIndex < startOffset || day > daysInMonth) {
        weekDates.push(null);
      } else {
        weekDates.push(day);
        day++;
      }
    }
    dates.push(weekDates);
    if (day > daysInMonth) break;
  }
  return { dates };
}

function getEventsForDate(events: CalendarEvent[], year: number, month: number, day: number): CalendarEvent[] {
  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return events.filter((e) => {
    const eventDate = e.date?.split("T")[0];
    if (eventDate === dateStr) return true;
    if (e.endDate) {
      const startDate = e.date?.split("T")[0];
      if (startDate && startDate <= dateStr && dateStr <= e.endDate.split("T")[0]) return true;
    }
    return false;
  });
}

// ── DnD: Droppable Day Cell ──────────────────────────────────────────────────

function DroppableDay({
  dateStr,
  day,
  month,
  dayEvents,
  onCreateEvent,
  onEditEvent,
}: {
  dateStr: string;
  day: number;
  month: number;
  dayEvents: CalendarEvent[];
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateStr}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative min-h-[5rem] border-t border-l border-border bg-surface p-1 transition-colors cursor-pointer",
        isOver && "bg-accent/10 ring-2 ring-accent ring-inset z-10",
        !isOver && dayEvents.length > 0 ? "hover:bg-elevated" : "hover:bg-hover/50"
      )}
      onClick={() => onCreateEvent(dateStr)}
      role="button"
      tabIndex={0}
      aria-label={`Create event on ${MONTHS[month]} ${day}`}
      onKeyDown={(e) => { if (e.key === "Enter") onCreateEvent(dateStr); }}
    >
      <span className="text-sm font-medium text-text-secondary">{day}</span>
      <div className="mt-1 space-y-0.5">
        {dayEvents.slice(0, MAX_EVENTS_PER_CELL).map((evt) => (
          <DraggableEvent
            key={evt.id}
            event={evt}
            onEdit={onEditEvent}
          />
        ))}
        {dayEvents.length > MAX_EVENTS_PER_CELL && (
          <div className="text-xs text-text-muted px-1">+{dayEvents.length - MAX_EVENTS_PER_CELL} more</div>
        )}
      </div>
    </div>
  );
}

// ── DnD: Draggable Event Chip ────────────────────────────────────────────────

function DraggableEvent({ event, onEdit }: { event: CalendarEvent; onEdit: (event: CalendarEvent) => void }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.activity;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event-${event.id}`,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onEdit(event); }}
      className={cn(
        "group relative flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-hover cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
      style={{ borderLeft: `2px solid ${cfg.color}`, ...style }}
      aria-label={`${event.title} - ${cfg.label}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} aria-hidden="true" />
      <span className="truncate text-text-secondary group-hover:text-text-primary">{truncate(event.title, 16)}</span>
      <div className="pointer-events-none absolute -top-8 left-0 z-10 rounded bg-elevated border border-border px-2 py-1 text-xs shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="font-medium text-text-primary">{truncate(event.title, 32)}</div>
        <div className="text-text-muted">{cfg.label}</div>
      </div>
    </div>
  );
}

// ── DnD: Drag Overlay ────────────────────────────────────────────────────────

function DragOverlayEvent({ event }: { event: CalendarEvent }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.activity;
  return (
    <div
      className="flex items-center gap-1 rounded px-2 py-1 text-xs shadow-lg"
      style={{
        borderLeft: `2px solid ${cfg.color}`,
        backgroundColor: "var(--elevated)",
        opacity: 0.9,
        zIndex: 9999,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} />
      <span className="text-text-primary">{truncate(event.title, 24)}</span>
    </div>
  );
}

// ── Event Form Modal ────────────────────────────────────────────────────────

interface EventFormData {
  title: string;
  date: string;
  endDate: string;
  type: "project" | "campaign" | "activity" | "content" | "calendar";
  description: string;
  attendees: string;
}

function defaultFormData(date?: string): EventFormData {
  return {
    title: "",
    date: date || new Date().toISOString().split("T")[0],
    endDate: "",
    type: "calendar",
    description: "",
    attendees: "",
  };
}

interface EventModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: EventFormData) => void;
  onDelete?: () => void;
  initialData?: EventFormData;
  isEdit?: boolean;
}

function EventModal({ open, onClose, onSave, onDelete, initialData, isEdit }: EventModalProps) {
  const [form, setForm] = useState<EventFormData>(initialData || defaultFormData());

  const update = (field: keyof EventFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (!form.title || !form.date) return;
    onSave(form);
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Event" : "New Event"} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Event title"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Start Date *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">End Date</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
              <button
                key={type}
                type="button"
                onClick={() => update("type", type)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors",
                  form.type === type
                    ? "border-border-strong bg-elevated text-text-primary"
                    : "border-border bg-surface text-text-muted hover:text-text-secondary"
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            <AlignLeft className="h-3.5 w-3.5 inline mr-1" />
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Event details..."
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            <Users className="h-3.5 w-3.5 inline mr-1" />
            Attendees
          </label>
          <input
            type="text"
            value={form.attendees}
            onChange={(e) => update("attendees", e.target.value)}
            placeholder="Comma-separated agent names"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
          />
        </div>

        <div className="flex justify-between pt-2">
          {isEdit && onDelete ? (
            <button
              onClick={onDelete}
              className="px-4 py-2 text-sm text-critical rounded-md border border-border hover:bg-hover transition-colors"
            >
              Delete
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary rounded-md border border-border hover:bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!form.title || !form.date}
              className="px-4 py-2 text-sm bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              {isEdit ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Calendar Grid (client wrapper with click handlers) ───────────────────────

interface CalendarGridClientProps {
  events: CalendarEvent[];
  year: number;
  month: number;
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
}

function CalendarGridClient({ events, year, month, onCreateEvent, onEditEvent }: CalendarGridClientProps) {
  const { dates } = getMonthDates(year, month);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7">
        {DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-text-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="space-y-px">
        {dates.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              if (!day) return <div key={`e-${di}`} className="min-h-[5rem] border-t border-l border-border bg-surface/50 p-1" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = getEventsForDate(events, year, month, day);
              return (
                <DroppableDay
                  key={di}
                  dateStr={dateStr}
                  day={day}
                  month={month}
                  dayEvents={dayEvents}
                  onCreateEvent={onCreateEvent}
                  onEditEvent={onEditEvent}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Calendar List (read-only, unchanged) ─────────────────────────────────────

function CalendarList({ events, year, month }: { events: CalendarEvent[]; year: number; month: number }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysWithEvents: { day: number; events: CalendarEvent[] }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const de = getEventsForDate(events, year, month, day);
    if (de.length > 0) daysWithEvents.push({ day, events: de });
  }
  if (daysWithEvents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">No events this month</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {daysWithEvents.map(({ day, events: de }) => (
        <div key={day} className="rounded-lg border border-border bg-surface p-3">
          <div className="text-sm font-medium text-text-secondary mb-2">{MONTHS[month]} {day}</div>
          <div className="space-y-1.5">
            {de.map((evt) => {
              const cfg = TYPE_CONFIG[evt.type] || TYPE_CONFIG.activity;
              return (
                <div key={evt.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover transition-colors" aria-label={`${evt.title} - ${cfg.label}`}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} aria-hidden="true" />
                  <span className="text-sm text-text-primary truncate">{evt.title}</span>
                  <span className="ml-auto text-xs text-text-muted shrink-0">{cfg.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Calendar Client ─────────────────────────────────────────────────────

interface CalendarClientProps {
  initialEvents: CalendarEvent[];
  year: number;
  month: number;
  view: "grid" | "list";
  now: { month: string; year: number; m: number };
  prevM: { month: string; year: number; m: number };
  nextM: { month: string; year: number; m: number };
  todayM: { month: string; year: number; m: number };
  params: { month?: string; view?: string };
}

export function CalendarClient({ initialEvents, year, month, view, now, prevM, nextM, todayM, params }: CalendarClientProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [createDate, setCreateDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleReschedule = useCallback(async (eventId: string, newDate: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/crud/tasks/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_date: newDate }),
      });
      if (res.ok) {
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, date: newDate } : e
        ));
        toast.success("Event rescheduled");
      }
    } catch (err) {
      console.error("Failed to reschedule:", err);
      toast.error("Failed to reschedule event");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || !active) return;
    const eventId = active.id.toString().replace("event-", "");
    const newDate = over.id.toString().replace("day-", "");
    if (eventId && newDate && newDate !== "null") {
      handleReschedule(eventId, newDate);
    }
  }, [handleReschedule]);

  const activeEvent = useMemo(() => {
    if (!activeId) return null;
    const id = activeId.replace("event-", "");
    return events.find((e) => e.id === id) || null;
  }, [activeId, events]);

  const handleCreateClick = useCallback((date: string) => {
    setCreateDate(date);
    setCreateModalOpen(true);
  }, []);

  const handleEditClick = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setEditModalOpen(true);
  }, []);

  const handleCreateSave = useCallback(async (data: EventFormData) => {
    setSaving(true);
    try {
      const res = await fetch("/api/crud/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.title,
          status: "Up Next",
          action_date: data.date,
          priority: "medium",
          description: data.description || undefined,
          assignee: data.attendees ? data.attendees.split(",").map((a: string) => a.trim()).filter(Boolean).join(", ") : undefined,
          tags: data.type !== "calendar" ? [data.type] : undefined,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        const newEvent: CalendarEvent = {
          id: result.data.id,
          title: result.data.name,
          date: result.data.action_date?.split("T")[0] || data.date,
          endDate: null,
          type: data.type as CalendarEvent["type"],
          color: "blue",
          href: `#/events/${result.data.id}`,
        };
        setEvents((prev) => [...prev, newEvent]);
      }
    } catch (err) {
      console.error("Failed to create event:", err);
    } finally {
      setSaving(false);
      setCreateModalOpen(false);
    }
  }, []);

  const handleEditSave = useCallback(async (data: EventFormData) => {
    if (!editingEvent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crud/tasks/${editingEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.title,
          action_date: data.date,
          description: data.description || undefined,
          assignee: data.attendees ? data.attendees.split(",").map((a: string) => a.trim()).filter(Boolean).join(", ") : undefined,
          tags: data.type !== "calendar" ? [data.type] : undefined,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setEvents((prev) =>
          prev.map((e) =>
            e.id === editingEvent.id
              ? { ...e, title: result.data.name, date: result.data.action_date?.split("T")[0] || data.date, type: data.type as CalendarEvent["type"] }
              : e
          )
        );
      }
    } catch (err) {
      console.error("Failed to update event:", err);
    } finally {
      setSaving(false);
      setEditModalOpen(false);
      setEditingEvent(null);
    }
  }, [editingEvent]);

  const handleDelete = useCallback(async () => {
    if (!editingEvent) return;
    if (!confirm("Delete this event?")) return;
    setSaving(true);
    try {
      await fetch(`/api/crud/tasks/${editingEvent.id}`, { method: "DELETE" });
      setEvents((prev) => prev.filter((e) => e.id !== editingEvent.id));
    } catch (err) {
      console.error("Failed to delete event:", err);
    } finally {
      setSaving(false);
      setEditModalOpen(false);
      setEditingEvent(null);
    }
  }, [editingEvent]);

  const editFormData: EventFormData | undefined = editingEvent
    ? {
        title: editingEvent.title,
        date: editingEvent.date?.split("T")[0] || "",
        endDate: editingEvent.endDate?.split("T")[0] || "",
        type: editingEvent.type as EventFormData["type"],
        description: "",
        attendees: "",
      }
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Calendar</h1>
        <p className="text-sm text-text-secondary mt-1">Unified temporal view across all domains</p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href={`?month=${prevM.month}&view=${view}`} className="rounded-md border border-border bg-surface p-2 text-text-secondary hover:bg-hover transition-colors" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-medium font-heading text-text-primary min-w-[200px] text-center">{MONTHS[month]} {year}</h2>
          <Link href={`?month=${nextM.month}&view=${view}`} className="rounded-md border border-border bg-surface p-2 text-text-secondary hover:bg-hover transition-colors" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {!(year === now.year && month === now.m) && (
            <Link href={`?month=${todayM.month}&view=${view}`} className="text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1 rounded border border-border bg-surface">Today</Link>
          )}
          <div className="flex rounded-md border border-border bg-surface overflow-hidden">
            <Link href={`?month=${params.month || todayM.month}&view=grid`} className={cn("px-3 py-1.5 text-xs transition-colors", view === "grid" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary")} aria-label="Month view">
              Month
            </Link>
            <Link href={`?month=${params.month || todayM.month}&view=list`} className={cn("px-3 py-1.5 text-xs transition-colors", view === "list" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary")} aria-label="List view">
              List
            </Link>
          </div>
          <button
            onClick={() => { setCreateDate(new Date().toISOString().split("T")[0]); setCreateModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors"
            aria-label="Create new event"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            New Event
          </button>
        </div>
      </div>

      <div className="hidden md:block">
        {view === "grid" ? (
          <DndContext
            collisionDetection={closestCenter}
            onDragStart={(event) => setActiveId(event.active.id.toString())}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <CalendarGridClient
              events={events}
              year={year}
              month={month}
              onCreateEvent={handleCreateClick}
              onEditEvent={handleEditClick}
            />
            <DragOverlay dropAnimation={null}>
              {activeEvent && <DragOverlayEvent event={activeEvent} />}
            </DragOverlay>
          </DndContext>
        ) : (
          <CalendarList events={events} year={year} month={month} />
        )}
      </div>

      <div className="md:hidden">
        <CalendarList events={events} year={year} month={month} />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border">
        <span className="text-xs text-text-muted uppercase tracking-wider">Legend</span>
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
            <span className="text-xs text-text-secondary">{cfg.label}</span>
          </div>
        ))}
      </div>

      <EventModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSave={handleCreateSave}
        initialData={defaultFormData(createDate)}
      />

      {editingEvent && (
        <EventModal
          open={editModalOpen}
          onClose={() => { setEditModalOpen(false); setEditingEvent(null); }}
          onSave={handleEditSave}
          onDelete={handleDelete}
          initialData={editFormData}
          isEdit
        />
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 bg-elevated border border-border rounded-lg px-4 py-3 text-sm text-text-secondary shadow-lg flex items-center gap-2">
          <div className="h-4 w-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
