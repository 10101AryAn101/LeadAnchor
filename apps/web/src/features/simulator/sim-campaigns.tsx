"use client";

import { IconBulb, IconSnowflake, IconSunHigh, IconUsersPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Scenario = "mild" | "freeze" | "heat";

interface SimWeather {
  scenario: Scenario;
  simulated: boolean;
  place: string | null;
  forecast: Array<{ date: string; lowF: number; highF: number }>;
}

const failed = (fallback: string) => (error: unknown) =>
  toast.error(isApiError(error) ? error.message : fallback);

/**
 * Development only: what email campaigns (module 11) need to try out locally. Past customers to
 * send to, and a weather service that can be told a cold snap or heat wave is coming (C-30).
 */
export function SimulatedCampaigns() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const weather = useQuery({
    queryKey: ["sim-weather"],
    queryFn: () => api<SimWeather>("/dev/simulator/weather"),
  });

  const samples = useMutation({
    mutationFn: () => api<{ added: number }>("/dev/simulator/past-customers", { method: "POST" }),
    onSuccess: ({ added }) => {
      void queryClient.invalidateQueries({ queryKey: keys.customersAll });
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      toast.success(
        added > 0
          ? `Added ${added} past customers with finished jobs.`
          : "The sample customers are already here.",
      );
    },
    onError: failed("Couldn't add them."),
  });
  const setWeather = useMutation({
    mutationFn: (kind: Scenario) =>
      api("/dev/simulator/weather", { method: "POST", body: { kind } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sim-weather"] }),
    onError: failed("Couldn't change the weather."),
  });
  const ideas = useMutation({
    mutationFn: () => api<{ created: number }>("/dev/simulator/campaign-ideas", { method: "POST" }),
    onSuccess: ({ created }) => {
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      if (created > 0)
        toast.success(`${created} new offer ${created === 1 ? "idea" : "ideas"}.`, {
          action: { label: "See them", onClick: () => router.push("/campaigns") },
        });
      else toast.info("Nothing new worth an offer right now.");
    },
    onError: failed("Couldn't check."),
  });

  return (
    <section className="space-y-5 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-[17px] font-bold">Campaigns</h2>
        <p className="text-[15px] text-muted-foreground">
          Sample past customers to send offers to, and the simulated weather that suggests them.
          Every six hours LeadAnchor checks the forecast and the holiday calendar on its own.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={samples.isPending} onClick={() => samples.mutate()}>
          {samples.isPending ? <Spinner /> : <IconUsersPlus />} Add sample past customers
        </Button>
        <span className="text-sm text-muted-foreground">
          12 people with jobs from the last year and a half (example.com emails).
        </span>
      </div>

      <div className="space-y-3">
        <p className="font-semibold">The forecast for your town</p>
        {!weather.data ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : (
          <>
            {!weather.data.simulated && (
              <p className="text-sm text-muted-foreground">
                {weather.data.forecast.length > 0
                  ? `Live from the US National Weather Service${weather.data.place ? ` for ${weather.data.place}` : ""}, so the simulated weather is off.`
                  : "No forecast: the National Weather Service covers US towns only. Check the city and state (or ZIP) in Settings."}
              </p>
            )}
            <ToggleGroup
              value={[weather.data.scenario]}
              onValueChange={(next) => next[0] && setWeather.mutate(next[0] as Scenario)}
              variant="outline"
              aria-label="Simulated weather"
              className="w-full flex-wrap"
              disabled={!weather.data.simulated || setWeather.isPending}
            >
              <ToggleGroupItem value="mild" className="min-h-11 flex-1 px-3 text-[15px]">
                Ordinary week
              </ToggleGroupItem>
              <ToggleGroupItem value="freeze" className="min-h-11 flex-1 px-3 text-[15px]">
                <IconSnowflake /> Cold snap
              </ToggleGroupItem>
              <ToggleGroupItem value="heat" className="min-h-11 flex-1 px-3 text-[15px]">
                <IconSunHigh /> Heat wave
              </ToggleGroupItem>
            </ToggleGroup>
            <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {weather.data.forecast.map((day) => {
                const freezing = day.lowF <= 32;
                const scorching = day.highF >= 100;
                return (
                  <li
                    key={day.date}
                    className={cn(
                      "rounded-md border p-2 text-center text-sm",
                      freezing && "border-info/50 bg-info-subtle",
                      scorching && "border-signal/50 bg-signal-subtle",
                    )}
                  >
                    <span className="block font-semibold">
                      {new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", {
                        weekday: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                    <span className="tabular block text-muted-foreground">
                      {day.highF}° / {day.lowF}°
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={ideas.isPending} onClick={() => ideas.mutate()}>
          {ideas.isPending ? <Spinner /> : <IconBulb />} Check for offer ideas now
        </Button>
        <span className="text-sm text-muted-foreground">
          A freeze or heat wave in the next five days, or a holiday two or three weeks out.
        </span>
      </div>
    </section>
  );
}
