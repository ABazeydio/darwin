'use client';
import { useState, Suspense, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Compass, Search, Sparkles, X } from 'lucide-react';
import { categories, Category, Listing } from '@/lib/data';
import { createClient } from '@/lib/supabase/client';
import ListingCard from '@/components/ListingCard';
import { fetchMarketplace } from '@/lib/marketplace-query';
import { mapMarketplaceListing, type MarketplaceRow } from '@/lib/marketplace';
import { earliestBoostExpiry, useMarketplaceRefresh } from '@/lib/use-marketplace-refresh';
import SkeletonCard from '@/components/SkeletonCard';
import PageTransition from '@/components/PageTransition';

const ease = [0.16, 1, 0.3, 1] as const;

function BrowseContent() {
  const searchParams = useSearchParams();
  const initialCat = searchParams.get('category') as Category | null;

  const [query, setQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<Category | 'All'>(initialCat || 'All');
  const [sortBy, setSortBy] = useState<'recommended' | 'newest' | 'price-low' | 'price-high'>('recommended');
  const [dbListings, setDbListings] = useState<Listing[]>([]);

  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const campus = searchParams.get('campus');

  const fetchListings = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    try {
      const supabase = createClient();
      // Fetch every loaded page using the same filters; the database ranks
      // before pagination. Ignore stale requests when filters change.
      const [pages, saved] = await Promise.all([
        Promise.all(Array.from({ length: pageCount }, (_, i) => fetchMarketplace(supabase, {
          query: query.trim(), category: selectedCat === 'All' ? null : selectedCat,
          campus, sort: sortBy, limit: 24, offset: i * 24,
        }))),
        fetch('/api/saved').then((r) => r.json()).catch(() => ({ savedIds: [] })),
      ]);
      if (request.current !== version) return;
      if (pages.some((page) => page.error)) {
        setLoadError('Listings could not be loaded. Please try again.');
        return;
      }
      const rows = pages.flatMap((page) => (page.data ?? []) as MarketplaceRow[]);
      const savedIds = new Set<string>(saved.savedIds ?? []);
      const unique = new Map(rows.map((row) => [row.listing.id, mapMarketplaceListing(row, savedIds)]));
      setDbListings([...unique.values()]);
      setTotal(Number(rows[0]?.total_count ?? 0));
      setLoadError('');
    } catch {
      if (request.current === version) setLoadError('Listings could not be loaded. Please try again.');
    } finally { if (request.current === version) setLoading(false); }
  }, [query, selectedCat, sortBy, campus, pageCount]);

  const invalidate = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchListings(); }, 200);
    return () => { window.clearTimeout(timer); invalidate(); };
  }, [fetchListings, invalidate]);
  useMarketplaceRefresh(fetchListings, earliestBoostExpiry(dbListings), dbListings[0]?.serverNow);

  function changeFilters(update: () => void) {
    request.current++;
    setPageCount(1);
    setDbListings([]);
    setTotal(0);
    setLoading(true);
    update();
  }
  const filtered = dbListings;

  const heroListing = filtered[0];

  const browseStats = [
    {
      label: 'Fresh today',
      value: `${dbListings.length} listing${dbListings.length !== 1 ? 's' : ''}`,
      icon: <Sparkles size={14} />,
    },
    {
      label: 'Verified hubs',
      value: '3 campuses',
      icon: <Compass size={14} />,
    },
    {
      label: 'Fast handoff',
      value: 'Meetups nearby',
      icon: <ArrowUpRight size={14} />,
    },
  ];

  const hasActiveFilters = selectedCat !== 'All' || query.trim().length > 0;

  return (
    <PageTransition>
      <div className="container-vspr page-shell relative overflow-clip">
        <div className="bg-glow-orb bg-glow-orb--purple-tr" />
        <div className="bg-glow-orb bg-glow-orb--blue-bl" />
        <div className="bg-grid-subtle" />
        <div className="browse-shell relative z-10">
          <motion.section
            className="browse-hero-panel surface-panel"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease }}
          >
            <div className="browse-hero-grid">
              <header className="browse-hero-copy-block">
                <span className="section-label">Browse</span>
                <h1 className="browse-hero-title">
                  Find the right item fast, without sorting through campus chaos.
                </h1>
                <p className="browse-hero-copy">
                  Search, filter, and close a clean handoff from a marketplace built for students, not classifieds.
                </p>

                <div className="browse-stat-row">
                  {browseStats.map((item, index) => (
                    <motion.div
                      key={item.label}
                      className="browse-stat-tile"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.18 + index * 0.08, duration: 0.35, ease }}
                    >
                      <div className="browse-stat-label">
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                      <p className="browse-stat-value">{item.value}</p>
                    </motion.div>
                  ))}
                </div>
              </header>

              <aside className="browse-feature-card">
                {heroListing ? (
                  <>
                <div className="browse-feature-media">
                  <Image
                    src={heroListing.image}
                    alt={heroListing.title}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 34vw"
                    className="object-cover"
                  />
                  <div className="browse-feature-media-gradient" />
                  <div className="browse-feature-meta-top">
                    <span className="browse-feature-chip">Spotlight</span>
                    <span className="browse-feature-chip browse-feature-chip-muted">
                      {heroListing.category}
                    </span>
                  </div>
                </div>

                <div className="browse-feature-body">
                  <div className="browse-feature-copy">
                    <div className="browse-feature-kicker">
                      <span className="condition-dot condition-like-new" />
                      <span>{heroListing.condition}</span>
                      <span className="text-muted">·</span>
                      <span>{heroListing.seller.campus}</span>
                    </div>
                    <h2 className="browse-feature-title">{heroListing.title}</h2>
                    <p className="browse-feature-description">{heroListing.description}</p>
                  </div>

                  <div className="browse-feature-footer">
                    <div>
                      <p className="browse-feature-price-label">Current ask</p>
                      <p className="price-tag browse-feature-price">${heroListing.price}</p>
                    </div>
                    <Link href={`/listing/${heroListing.id}`} className="pill-btn pill-btn-outline">
                      View Listing
                    </Link>
                  </div>
                </div>
                  </>
                ) : (
                  <div className="browse-feature-body browse-feature-body--empty">
                    <div className="browse-feature-copy">
                      <span className="browse-feature-chip">Spotlight</span>
                      <h2 className="browse-feature-title">No listings yet</h2>
                      <p className="browse-feature-description">
                        Be the first student to post an item on Darwin.
                      </p>
                    </div>
                    <div className="browse-feature-footer">
                      <Link href="/sell" className="pill-btn">
                        Create a listing
                      </Link>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </motion.section>

          <motion.section
            className="browse-controls-panel surface-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.45, ease }}
          >
            <div className="browse-controls-top">
              <div className="browse-search-field">
                <Search size={18} className="browse-search-icon" />
                <input
                  type="text"
                  placeholder="Search by item, course, brand, or keyword"
                  value={query}
                  onChange={(e) => changeFilters(() => setQuery(e.target.value))}
                  className="browse-search-input"
                />
              </div>

              <div className="browse-controls-meta">
                <select
                  value={sortBy}
                  onChange={(e) => changeFilters(() => setSortBy(e.target.value as typeof sortBy))}
                  className="vspr-select browse-sort-select"
                >
                  <option value="recommended">Recommended</option>
                  <option value="newest">Newest First</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                </select>
              </div>
            </div>

            <div className="browse-pill-row">
              {['All', ...categories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCat(cat as Category | 'All')}
                  className={`filter-chip ${selectedCat === cat ? 'filter-chip-active' : ''}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </motion.section>

          {loadError && <div role="alert" className="text-secondary mb-5">{loadError} <button type="button" className="pill-btn pill-btn-sm" onClick={() => void fetchListings()}>Retry</button></div>}
          {loading && filtered.length === 0 ? <div className="browse-results-grid">{Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}</div> : filtered.length > 0 ? (
            <>
              <motion.div
                className="browse-results-header"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.18, duration: 0.35, ease }}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <p className="browse-results-count">
                    {total} listing{total !== 1 ? 's' : ''}
                  </p>
                  {selectedCat !== 'All' && (
                    <button
                      className="browse-active-filter"
                      onClick={() => changeFilters(() => setSelectedCat('All'))}
                    >
                      {selectedCat}
                      <span className="browse-active-filter-clear">
                        <X size={8} />
                      </span>
                    </button>
                  )}
                  {query.trim() && (
                    <button
                      className="browse-active-filter"
                      onClick={() => changeFilters(() => setQuery(''))}
                    >
                      &ldquo;{query}&rdquo;
                      <span className="browse-active-filter-clear">
                        <X size={8} />
                      </span>
                    </button>
                  )}
                </div>
              </motion.div>

              <section
                aria-label="Results"
                className="browse-results-grid grid grid-cols-1 auto-rows-fr gap-6 sm:grid-cols-2 xl:grid-cols-3"
              >
                {filtered.map((listing, index) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    index={index}
                    variant="browse"
                  />
                ))}
              </section>
              {filtered.length < total && <button type="button" className="pill-btn pill-btn-outline mt-6" disabled={loading} onClick={() => setPageCount((count) => count + 1)}>{loading ? 'Loading…' : 'Load more listings'}</button>}
            </>
          ) : (
            <motion.section
              aria-label="No results"
              className="empty-state browse-empty-state"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease }}
            >
              <div className="empty-state-icon">
                <Search size={26} />
              </div>
              <p className="text-secondary text-xl font-medium mt-5">
                {hasActiveFilters
                  ? 'No listings match your search.'
                  : 'No listings yet.'}
              </p>
              <p className="text-muted mt-2 text-sm">
                {hasActiveFilters
                  ? 'Try a broader keyword or clear a category filter.'
                  : 'Check back soon or post the first item for sale.'}
              </p>
              {!hasActiveFilters && (
                <Link href="/sell" className="pill-btn pill-btn-sm mt-6 inline-flex">
                  Create a listing
                </Link>
              )}
              {hasActiveFilters && (
                <button
                  className="pill-btn pill-btn-outline pill-btn-sm mt-6"
                  onClick={() => changeFilters(() => { setSelectedCat('All'); setQuery(''); })}
                >
                  Clear All Filters
                </button>
              )}
            </motion.section>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="container-vspr page-shell">
          <div className="browse-shell">
            <div className="surface-panel browse-hero-panel">
              <div className="flex flex-col gap-4">
                <div className="h-4 w-20 rounded bg-white/[0.06]" />
                <div className="h-10 w-3/4 rounded bg-white/[0.06]" />
                <div className="h-4 w-1/2 rounded bg-white/[0.06]" />
              </div>
            </div>
            <div className="surface-panel browse-controls-panel">
              <div className="h-14 rounded-2xl bg-white/[0.06] skeleton-shimmer" />
            </div>
            <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </section>
          </div>
        </div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}
