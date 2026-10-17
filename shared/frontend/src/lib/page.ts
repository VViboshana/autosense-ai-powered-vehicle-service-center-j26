/** Paged list from the API (the same shape for every list). */
export type Page<T> = {
  pageNo: number;
  pageSize: number;
  totalCount: number;
  noOfPages: number;
  records: T[];
};

export const PAGE_SIZES = [10, 20, 50, 100] as const;
