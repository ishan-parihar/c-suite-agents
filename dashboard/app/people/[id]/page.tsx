import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
import { getPersonDetail } from "@/lib/server/people";

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton variant="text" lines={2} className="mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} variant="card" lines={4} />
        ))}
      </div>
    </div>
  );
}

async function PersonDetail({ id }: { id: string }) {
  const person = await getPersonDetail(id);

  if (!person) {
    return (
      <div className="bg-surface border border-border rounded-lg px-5 py-12 text-center text-sm text-text-muted">
        Person not found
      </div>
    );
  }

  const initials = person.name
    .split(" ")
    .map(function(n: string) { return n[0]; })
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const influenceTools: string[] = Array.isArray(person.influenceToolkit)
    ? person.influenceToolkit
    : person.influenceToolkit
      ? JSON.parse(person.influenceToolkit)
      : [];

  const projects: any[] = Array.isArray(person.projects)
    ? person.projects
    : person.projects
      ? JSON.parse(person.projects)
      : [];

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/people"
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          People
        </Link>
      </div>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-elevated flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-heading font-medium text-text-secondary">
            {initials}
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-heading font-semibold tracking-tight">
            {person.name}
          </h1>
          {person.relationshipStatus && (
            <p className="text-sm text-text-secondary mt-0.5">
              {person.relationshipStatus}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Contact Info
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {person.email && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Email</span>
                  <span className="text-sm text-text-primary">{person.email}</span>
                </div>
              )}
              {person.city && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">City</span>
                  <span className="text-sm text-text-primary">{person.city}</span>
                </div>
              )}
              {person.timezone && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Timezone</span>
                  <span className="text-sm text-text-primary">{person.timezone}</span>
                </div>
              )}
              {person.reconnectBy && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Reconnect By</span>
                  <span className="text-sm text-text-primary">
                    {formatDate(person.reconnectBy)}
                  </span>
                </div>
              )}
              {!person.email && !person.city && !person.timezone && !person.reconnectBy && (
                <p className="text-sm text-text-muted">No contact info available</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Relationship Intel
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {person.relationshipStatus && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Status</span>
                  <span className="text-sm text-text-primary">{person.relationshipStatus}</span>
                </div>
              )}
              {person.networkingProfile && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Networking Profile</span>
                  <span className="text-sm text-text-primary">{person.networkingProfile}</span>
                </div>
              )}
              {person.professionalDomain && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Professional Domain</span>
                  <span className="text-sm text-text-primary">{person.professionalDomain}</span>
                </div>
              )}
              {person.connectionFrequencyDays != null && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Connection Frequency</span>
                  <span className="text-sm text-text-primary">
                    Every {person.connectionFrequencyDays} days
                  </span>
                </div>
              )}
              {person.lastConnectedDate && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Last Connected</span>
                  <span className="text-sm text-text-primary">
                    {formatDate(person.lastConnectedDate)}
                  </span>
                </div>
              )}
              {person.lastInteractionSentiment && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Last Sentiment</span>
                  <span className="text-sm text-text-primary">
                    {person.lastInteractionSentiment}
                  </span>
                </div>
              )}
              {person.valueExchangeBalance && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Value Exchange</span>
                  <span className="text-sm text-text-primary">
                    {person.valueExchangeBalance}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Context & Background
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {person.originContext && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Origin Context</span>
                  <p className="text-sm text-text-primary">{person.originContext}</p>
                </div>
              )}
              {person.strategicContext && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Strategic Context</span>
                  <p className="text-sm text-text-primary">{person.strategicContext}</p>
                </div>
              )}
              {person.summary && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Summary</span>
                  <p className="text-sm text-text-primary">{person.summary}</p>
                </div>
              )}
              {!person.originContext && !person.strategicContext && !person.summary && (
                <p className="text-sm text-text-muted">No context available</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Psychological Profile
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {person.coreShadow && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Core Shadow</span>
                  <span className="text-sm text-text-primary">{person.coreShadow}</span>
                </div>
              )}
              {person.developmentalAltitude && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Developmental Altitude</span>
                  <span className="text-sm text-text-primary">{person.developmentalAltitude}</span>
                </div>
              )}
              {person.aspirationalDrive && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Aspirational Drive</span>
                  <span className="text-sm text-text-primary">{person.aspirationalDrive}</span>
                </div>
              )}
              {person.temporalFocus && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Temporal Focus</span>
                  <span className="text-sm text-text-primary">{person.temporalFocus}</span>
                </div>
              )}
              {person.primaryCenterOfIntelligence && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Center of Intelligence</span>
                  <span className="text-sm text-text-primary">
                    {person.primaryCenterOfIntelligence}
                  </span>
                </div>
              )}
              {person.dominantPowerStrategy && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Power Strategy</span>
                  <span className="text-sm text-text-primary">{person.dominantPowerStrategy}</span>
                </div>
              )}
              {person.primaryConflictStyle && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Conflict Style</span>
                  <span className="text-sm text-text-primary">{person.primaryConflictStyle}</span>
                </div>
              )}
              {person.explanatoryStyle && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Explanatory Style</span>
                  <span className="text-sm text-text-primary">{person.explanatoryStyle}</span>
                </div>
              )}
              {person.stabilityProfile && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Stability Profile</span>
                  <span className="text-sm text-text-primary">{person.stabilityProfile}</span>
                </div>
              )}
              {person.desiredTrajectory && (
                <div className="flex justify-between items-center py-1 border-b border-border">
                  <span className="text-xs text-text-muted">Desired Trajectory</span>
                  <span className="text-sm text-text-primary">{person.desiredTrajectory}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Engagement
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {person.engagementBlueprint && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Engagement Blueprint</span>
                  <p className="text-sm text-text-primary">{person.engagementBlueprint}</p>
                </div>
              )}
              {person.keyPersonalIntel && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Key Personal Intel</span>
                  <p className="text-sm text-text-primary">{person.keyPersonalIntel}</p>
                </div>
              )}
              {influenceTools.length > 0 && (
                <div>
                  <span className="text-xs text-text-muted block mb-1">Influence Toolkit</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {influenceTools.map(function(tool, i) {
                      return (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full text-xs bg-elevated text-text-secondary"
                        >
                          {tool}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {!person.engagementBlueprint && !person.keyPersonalIntel && influenceTools.length === 0 && (
                <p className="text-sm text-text-muted">No engagement data available</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Projects
            </h2>
          </CardHeader>
          <CardContent>
            {projects.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-text-muted mb-2">
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1">
                  {projects.map(function(project, i) {
                    return (
                      <Link
                        key={i}
                        href={`/projects/${project.id || project}`}
                        className="block text-sm text-text-primary hover:text-accent transition-colors py-1"
                      >
                        {project.name || project.id || project}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">No projects associated</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default async function PersonDetailPage({ params }: DetailPageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PersonDetail id={id} />
    </Suspense>
  );
}
