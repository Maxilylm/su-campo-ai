import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface PageHeaderProps {
  breadcrumbs?: { label: string; href?: string }[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ breadcrumbs, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-7">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb className="mb-1.5 text-[13px]">
          <BreadcrumbList>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight">{title}</h1>
          {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
