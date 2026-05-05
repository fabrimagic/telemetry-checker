import { useEffect, useState } from "react";
import { fetchFullGasFeed, formatItalianDate, type FullGasFeedItem } from "@/lib/fullGasFeed";
import { Skeleton } from "@/components/ui/skeleton";

export function FullGasFeedSection() {
  const [items, setItems] = useState<FullGasFeedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFullGasFeed()
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;

  return (
    <section aria-labelledby="fullgas-feed-heading" className="px-6 py-8 max-w-7xl mx-auto w-full">
      <header className="mb-4">
        <h2 id="fullgas-feed-heading" className="text-xl font-semibold tracking-tight">
          Dal Full Gas Blog
        </h2>
        <p className="text-sm text-muted-foreground">
          Le ultime news di Formula 1 — clicca per leggere su fullgas.blog
        </p>
      </header>

      {loading || !items ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-card border rounded-lg p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? null : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((item) => (
            <a
              key={item.link}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-card border rounded-lg p-4 hover:border-foreground/30 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <h3 className="text-sm font-semibold leading-snug mb-2 line-clamp-3">
                {item.title}
              </h3>
              <time
                dateTime={item.pubDate.toISOString()}
                className="block text-xs text-muted-foreground mb-2"
              >
                {formatItalianDate(item.pubDate)}
              </time>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                {item.excerpt}
              </p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
