import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder for a section whose module has not been built yet.
 *
 * 00-platform owns the shell; each section's routes belong to its own module
 * and arrive in tier order (docs/workflows/development-process.md). The nav is
 * permission-filtered now (AC-24), so the entry must exist — but it must not
 * lead to a 404. This says plainly which module delivers the screen, and gets
 * replaced when that module lands.
 */
export function ModulePlaceholder({
  title,
  module: moduleName,
  summary,
}: {
  title: string;
  module: string;
  summary: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not built yet</CardTitle>
          <CardDescription>{summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This screen is delivered by module{" "}
            <span className="font-medium text-foreground">{moduleName}</span>. You can see the
            section because your role permits it — the platform shell, authentication and
            property scoping are already in place.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
