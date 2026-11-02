import { useMemo } from "react";
import type { ActivityLog } from "@scope/contracts";
import { VueMount } from "@/vue/VueMount";
import ActivityFeedVue from "./activity-feed/ActivityFeed.vue";

export interface ActivityFeedProps {
  activities: ActivityLog[];
  loading?: boolean;
  projectNames?: Record<string, string>;
  compact?: boolean;
  limit?: number;
  emptyText?: string;
  onSelect?: (activity: ActivityLog) => void;
  className?: string;
}

/** React-facing wrapper around the Vue ActivityFeed module. */
export function ActivityFeed({ className, ...props }: ActivityFeedProps) {
  // Memoize so the Vue island only receives a new props object when inputs change.
  const vueProps = useMemo(
    () => ({
      activities: props.activities,
      loading: props.loading ?? false,
      projectNames: props.projectNames ?? {},
      compact: props.compact ?? false,
      limit: props.limit ?? 50,
      emptyText: props.emptyText ?? "No activity yet.",
      onSelect: props.onSelect,
    }),
    [props.activities, props.loading, props.projectNames, props.compact, props.limit, props.emptyText, props.onSelect],
  );

  return <VueMount component={ActivityFeedVue} props={vueProps} className={className} ariaLabel="Recent activity" />;
}
