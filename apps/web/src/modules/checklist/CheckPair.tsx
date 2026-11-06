import { isGuestUser, type Task, type TaskCheckSide } from "@scope/contracts";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/date";
import { CHECK_SIDE_LABEL } from "@/lib/taskStatus";
import { Checkbox } from "@/design-system";

export interface CheckPairProps {
  task: Task;
  onToggle: (side: TaskCheckSide) => void;
  size?: "md" | "lg";
  /** Show "Dev / Client" captions under the boxes (hidden when a header labels the columns). */
  captions?: boolean;
  /** Viewers can see who checked what but cannot tick. */
  readOnly?: boolean;
  /** Public share: Client stays tappable while Developer is locked. */
  allowClientCheck?: boolean;
  className?: string;
}

const SIDES: TaskCheckSide[] = ["developer", "client"];

/**
 * The two "Checked by" boxes from the scope document: Developer and Client.
 * Each tick records who and when; the timestamp is exposed in the tooltip and
 * fully in the task sheet.
 */
export function CheckPair({ task, onToggle, size = "md", captions = true, readOnly = false, allowClientCheck = false, className }: CheckPairProps) {
  return (
    <div className={cn("flex shrink-0 items-start", size === "lg" ? "gap-3" : "gap-1.5", className)}>
      {SIDES.map((side) => {
        const check = side === "developer" ? task.developerCheck : task.clientCheck;
        const label = CHECK_SIDE_LABEL[side];
        const title = check ? `${label}: checked by ${check.checkedBy.name} · ${formatDateTime(check.checkedAt)}` : `${label}: not yet checked`;
        const memberClientLocked = allowClientCheck && side === "client" && check !== null && !isGuestUser(check.checkedBy);
        return (
          <div key={side} className="flex w-9 flex-col items-center" title={title}>
            <Checkbox
              size={size}
              checked={check !== null}
              onChange={() => onToggle(side)}
              disabled={memberClientLocked || (readOnly && !(allowClientCheck && side === "client"))}
              label={check ? `Clear ${label} check on "${task.title}" (checked by ${check.checkedBy.name}, ${formatDateTime(check.checkedAt)})` : `Mark "${task.title}" checked by ${label}`}
            />
            {captions && <span className={cn("mt-0.5 text-[10px] leading-3 tracking-wide uppercase", check ? "text-ink-muted" : "text-ink-faint")}>{side === "developer" ? "Dev" : "Client"}</span>}
          </div>
        );
      })}
    </div>
  );
}
