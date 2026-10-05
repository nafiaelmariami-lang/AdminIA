import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePageUser } from "@/server/auth/current-user";
import { listTasks } from "@/server/tasks/service";
import { daysUntil } from "@/lib/format";
import { ButtonLink, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { AddTaskForm, TaskList } from "@/components/app/task-list";

export const metadata: Metadata = { title: "Échéances" };

export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const user = await requirePageUser();
  const showDone = (await searchParams).vue === "terminees";
  const db = await getDb();

  if (showDone) {
    const done = await listTasks(db, user.id, { status: "done" });
    return (
      <div>
        <PageHeader title="Échéances terminées" action={<Link href="/app/echeances" className="text-sm font-semibold text-brand-700">← Retour aux échéances à faire</Link>} />
        <Card>
          <TaskList tasks={done.reverse()} emptyText="Aucune échéance terminée pour l'instant." />
        </Card>
      </div>
    );
  }

  const todo = await listTasks(db, user.id, { status: "todo" });
  const groups = { late: [] as typeof todo, week: [] as typeof todo, month: [] as typeof todo, later: [] as typeof todo, undated: [] as typeof todo };
  for (const t of todo) {
    if (!t.dueDate) groups.undated.push(t);
    else {
      const d = daysUntil(t.dueDate);
      if (d < 0) groups.late.push(t);
      else if (d <= 7) groups.week.push(t);
      else if (d <= 31) groups.month.push(t);
      else groups.later.push(t);
    }
  }
  const sections = [
    { key: "late", title: "En retard", items: groups.late, tone: "text-red-700" },
    { key: "week", title: "Cette semaine", items: groups.week, tone: "text-orange-700" },
    { key: "month", title: "Ce mois-ci", items: groups.month, tone: "text-slate-900" },
    { key: "later", title: "Plus tard", items: groups.later, tone: "text-slate-900" },
    { key: "undated", title: "Sans date", items: groups.undated, tone: "text-slate-900" },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Échéances"
        description="Les actions détectées dans vos documents et celles que vous ajoutez."
        action={
          todo.some((t) => t.dueDate) ? (
            <ButtonLink href="/api/tasks/calendar" variant="secondary" icon="calendar" download>
              Ajouter à mon agenda (.ics)
            </ButtonLink>
          ) : undefined
        }
      />
      <AddTaskForm />
      {sections.length === 0 ? (
        <Card className="p-8 text-center text-slate-600">Aucune échéance à faire. Bravo, tout est à jour !</Card>
      ) : (
        sections.map((s) => (
          <Card key={s.key}>
            <CardHeader title={<span className={s.tone}>{`${s.title} (${s.items.length})`}</span>} />
            <TaskList tasks={s.items} />
          </Card>
        ))
      )}
      <p className="text-center text-sm">
        <Link href="/app/echeances?vue=terminees" className="font-semibold text-brand-700">
          Voir les échéances terminées
        </Link>
      </p>
    </div>
  );
}
