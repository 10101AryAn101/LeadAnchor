import type { PublicProfile } from "@leadanchor/contracts";
import { IconClock, IconMapPin } from "@tabler/icons-react";

/** C-42: short answers, where the work is, hours and real questions, readable by people and AI assistants alike. */
export function DiscoverySections({
  discovery,
  name,
}: {
  discovery: NonNullable<PublicProfile["discovery"]>;
  name: string;
}) {
  return (
    <>
      {discovery.answers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">At a glance</h2>
          <div className="space-y-3">
            {discovery.answers.map((answer) => (
              <article key={answer.service} className="rounded-lg border bg-card p-4">
                <h3 className="font-semibold">{answer.service}</h3>
                <p className="mt-1 text-[15px] leading-6">{answer.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {(discovery.areaServed.length > 0 || discovery.hours.length > 0) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {discovery.areaServed.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="flex items-center gap-2 font-bold">
                <IconMapPin className="size-5 text-muted-foreground" /> Where we work
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                ZIP codes of jobs in the last year
              </p>
              <p className="tabular mt-2 text-[15px]">{discovery.areaServed.join(", ")}</p>
            </div>
          )}
          {discovery.hours.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="flex items-center gap-2 font-bold">
                <IconClock className="size-5 text-muted-foreground" /> Hours
              </h2>
              <dl className="mt-2 space-y-0.5 text-[15px]">
                {discovery.hours.map((day) => (
                  <div key={day.day} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{day.day}</dt>
                    <dd className="tabular">{day.hours}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}

      {discovery.faq.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">Questions people ask {name}</h2>
          <div className="divide-y rounded-lg border bg-card">
            {discovery.faq.map((item) => (
              <details key={item.question} className="group px-4 py-3">
                <summary className="cursor-pointer font-semibold marker:text-muted-foreground">
                  {item.question}
                </summary>
                <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
