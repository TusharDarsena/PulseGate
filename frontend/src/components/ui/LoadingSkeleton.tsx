type SkeletonTone = 'default' | 'subtle';

interface SkeletonProps {
  readonly className?: string;
  readonly tone?: SkeletonTone;
}

export function Skeleton({ className = '', tone = 'default' }: SkeletonProps) {
  const color = tone === 'subtle' ? 'bg-[#272C33]/50' : 'bg-[#272C33]';
  return <div aria-hidden="true" className={`animate-pulse rounded ${color} ${className}`} />;
}

type CollectionSkeletonVariant = 'event' | 'listing' | 'ticket';

interface CollectionSkeletonProps {
  readonly variant: CollectionSkeletonVariant;
  readonly count?: number;
  readonly className?: string;
}

export function CollectionSkeleton({ variant, count = 6, className = '' }: CollectionSkeletonProps) {
  const card = variant === 'ticket' ? <TicketCardSkeleton /> : <EventCardSkeleton variant={variant} />;
  return (
    <div
      aria-busy="true"
      aria-label="Loading content"
      className={`grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {Array.from({ length: count }, (_, index) => <div key={index}>{card}</div>)}
    </div>
  );
}

function EventCardSkeleton({ variant }: { variant: 'event' | 'listing' }) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#272C33] bg-[#15181C]">
      <Skeleton className={variant === 'listing' ? 'h-44' : 'aspect-video'} />
      <div className="space-y-3 p-5">
        <Skeleton tone="subtle" className="h-6 w-3/4" />
        <Skeleton tone="subtle" className="h-4 w-1/2" />
        <Skeleton tone="subtle" className="h-4 w-2/3" />
        <div className="flex items-center justify-between border-t border-[#272C33]/30 pt-4">
          <Skeleton tone="subtle" className="h-6 w-20" />
          <Skeleton tone="subtle" className="h-10 w-28 rounded-lg" />
        </div>
      </div>
    </article>
  );
}

function TicketCardSkeleton() {
  return (
    <article className="min-h-[300px] overflow-hidden rounded-xl border border-[#272C33] bg-[#15181C] p-5">
      <Skeleton className="h-36 w-full" />
      <div className="mt-5 space-y-3">
        <Skeleton tone="subtle" className="h-6 w-3/4" />
        <Skeleton tone="subtle" className="h-4 w-1/2" />
        <Skeleton tone="subtle" className="h-10 w-full rounded-lg" />
      </div>
    </article>
  );
}
