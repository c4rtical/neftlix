import type { ReactNode } from 'react';

export type SortOption = { id: string; label: string };

/** Shared header for every catalogue page: title, search box, sort chips and a count. */
export function BrowseHeader({
  title,
  placeholder,
  query,
  onQuery,
  sorts,
  sort,
  onSort,
  count,
  countLabel,
  extra,
}: {
  title: string;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  sorts?: SortOption[];
  sort?: string;
  onSort?: (id: string) => void;
  count: number;
  countLabel: string;
  extra?: ReactNode;
}) {
  return (
    <div className="browse-head">
      <h2>{title}</h2>
      <input className="browse-search" data-focus type="search" placeholder={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="sorts">
        {sorts?.map((s) => (
          <button key={s.id} className={`chip ${sort === s.id ? 'active' : ''}`} data-focus onClick={() => onSort?.(s.id)}>
            {s.label}
          </button>
        ))}
        {extra}
        <span className="muted">
          {count.toLocaleString('it-IT')} {countLabel}
        </span>
      </div>
    </div>
  );
}

/** Shared sidebar for categories: title, optional filter box, list. */
export function CategorySidebar({
  title,
  filter,
  onFilter,
  showFilter,
  children,
  head,
}: {
  title: string;
  filter: string;
  onFilter: (v: string) => void;
  showFilter: boolean;
  children: ReactNode;
  head?: ReactNode;
}) {
  return (
    <aside className="cats">
      <div className="cats-head">
        <h3>{title}</h3>
        {head}
        {showFilter && <input className="cats-filter" placeholder="Filtra categorie" value={filter} onChange={(e) => onFilter(e.target.value)} data-focus />}
      </div>
      <div className="cats-list">{children}</div>
    </aside>
  );
}
