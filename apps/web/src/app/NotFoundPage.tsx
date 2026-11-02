import { Link } from "react-router";
import { Compass } from "lucide-react";
import { routes } from "@/app/routes";
import { EmptyState } from "@/design-system";

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 lg:px-8">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Link to={routes.dashboard()} className="text-sm font-medium text-accent hover:underline">
            Go to dashboard
          </Link>
        }
      />
    </div>
  );
}
