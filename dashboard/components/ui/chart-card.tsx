import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "./card";
import { Skeleton } from "./skeleton";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
}

export function ChartCard({ title, subtitle, children, loading, error, className }: ChartCardProps) {
  if (loading) {
    return (
      <Card className={cn("p-0 overflow-hidden", className)}>
        <Skeleton variant="chart" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("border-critical/30", className)}>
        <CardContent>
          <p className="text-sm text-critical">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("p-0 overflow-hidden", className)} role="region" aria-label={title}>
      <CardHeader>
        <h3 className="font-heading text-sm font-medium text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
      </CardHeader>
      <CardContent role="img" aria-label={`${title} chart`}>
        {children}
      </CardContent>
    </Card>
  );
}
