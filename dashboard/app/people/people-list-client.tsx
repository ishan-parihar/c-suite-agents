"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PersonListItem } from "@/lib/server/people";

interface PeopleListClientProps {
  people: PersonListItem[];
}

export function PeopleListClient({ people }: PeopleListClientProps) {
  const [query, setQuery] = useState("");

  const filtered = people.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.email && p.email.toLowerCase().includes(q)) ||
      (p.city && p.city.toLowerCase().includes(q)) ||
      (p.relationshipStatus && p.relationshipStatus.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people..."
          className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length > 0 ? (
          filtered.map((person) => (
            <Link key={person.id} href={`/people/${person.id}`} className="block">
              <Card className="hover:border-border-strong transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-elevated flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-heading font-medium text-text-secondary">
                        {person.name
                          .split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-text-primary truncate">
                        {person.name}
                      </h3>
                      {person.relationshipStatus && (
                        <p className="text-xs text-text-secondary mt-0.5">
                          {person.relationshipStatus}
                        </p>
                      )}
                      {person.city && (
                        <p className="text-xs text-text-muted mt-1">{person.city}</p>
                      )}
                      {person.email && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
                          <Mail className="w-3 h-3" />
                          <span className="truncate">{person.email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        ) : (
          <div className="col-span-full bg-surface border border-border rounded-lg px-5 py-12 text-center text-sm text-text-muted">
            {query ? "No people match your search" : "No people found"}
          </div>
        )}
      </div>
    </div>
  );
}
