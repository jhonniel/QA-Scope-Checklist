import type { UserSummary } from "@scope/contracts";
import { cn } from "@/lib/cn";

type Size = "xs" | "sm" | "md" | "lg";

const sizeClasses: Record<Size, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
};

/* Neutral tints only — avatars must not compete with the single accent. */
const tints = ["bg-[#e4e4e9] text-[#3b3b45]", "bg-[#d9d9e0] text-[#2b2b33]", "bg-[#ececf0] text-[#4a4a55]", "bg-[#cfcfd7] text-[#1f1f26]"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function tintFor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return tints[Math.abs(hash) % tints.length];
}

export interface MemberAvatarProps {
  user: UserSummary;
  size?: Size;
  className?: string;
  /** Hide the tooltip-ish title attribute (e.g. when the name is shown next to it). */
  plain?: boolean;
}

export function MemberAvatar({ user, size = "md", className, plain }: MemberAvatarProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none ring-2 ring-surface", sizeClasses[size], tintFor(user.uuid), className)}
      title={plain ? undefined : user.name}
      aria-label={user.name}
      role="img"
    >
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full rounded-full object-cover" /> : initials(user.name)}
    </span>
  );
}

export interface AvatarStackProps {
  users: UserSummary[];
  max?: number;
  size?: Size;
  className?: string;
}

export function AvatarStack({ users, max = 4, size = "sm", className }: AvatarStackProps) {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <div className={cn("flex items-center -space-x-1.5", className)} aria-label={`${users.length} members`}>
      {visible.map((u) => (
        <MemberAvatar key={u.uuid} user={u} size={size} />
      ))}
      {overflow > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-surface-muted font-medium text-ink-muted ring-2 ring-surface", sizeClasses[size])}>
          +{overflow}
        </span>
      )}
    </div>
  );
}
