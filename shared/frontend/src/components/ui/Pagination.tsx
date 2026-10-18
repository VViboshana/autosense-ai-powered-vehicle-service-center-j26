import { PAGE_SIZES, type Page } from '@/lib/page';

/** Footer of every paged list: "Showing 1–20 of 57", rows per page, and page buttons. */
export function Pagination<T>({ page, onPage, onPageSize }: {
  page: Page<T>;
  onPage: (n: number) => void;
  onPageSize: (n: number) => void;
}) {
  if (page.totalCount === 0) return null;
  const first = (page.pageNo - 1) * page.pageSize + 1;
  const last = first + page.records.length - 1;
  const pages = Array.from({ length: page.noOfPages }, (_, i) => i + 1).filter(
    (n) => Math.abs(n - page.pageNo) <= 2 || n === 1 || n === page.noOfPages,
  );
  return (
    <div className="as-grid-foot">
      <span className="as-num">
        Showing {first}–{last} of {page.totalCount}
      </span>
      <div className="d-flex align-items-center gap-3 flex-wrap">
        <label className="d-flex align-items-center gap-2">
          Rows
          <select className="form-select form-select-sm" style={{ width: 'auto' }} value={page.pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Pages">
          <ul className="pagination pagination-sm mb-0">
            <li className={`page-item${page.pageNo <= 1 ? ' disabled' : ''}`}>
              <button type="button" className="page-link" aria-label="Previous page" onClick={() => onPage(page.pageNo - 1)}>
                ‹
              </button>
            </li>
            {pages.map((n) => (
              <li key={n} className={`page-item${n === page.pageNo ? ' active' : ''}`}>
                <button type="button" className="page-link" onClick={() => onPage(n)} aria-current={n === page.pageNo ? 'page' : undefined}>
                  {n}
                </button>
              </li>
            ))}
            <li className={`page-item${page.pageNo >= page.noOfPages ? ' disabled' : ''}`}>
              <button type="button" className="page-link" aria-label="Next page" onClick={() => onPage(page.pageNo + 1)}>
                ›
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
