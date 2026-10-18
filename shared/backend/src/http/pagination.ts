import { z } from 'zod';

/** Paged list response, the same shape for every list in the app. */
export type Page<T> = {
  pageNo: number;
  pageSize: number;
  totalCount: number;
  noOfPages: number;
  records: T[];
};

export const PAGE_SIZES = [10, 20, 50, 100] as const;

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), { message: `pageSize must be one of ${PAGE_SIZES.join(', ')}` })
    .default(20),
});

export type PageRequest = z.infer<typeof pageQuery>;

export function toPage<T>(records: T[], totalCount: number, req: PageRequest): Page<T> {
  return {
    pageNo: req.page,
    pageSize: req.pageSize,
    totalCount,
    noOfPages: Math.max(1, Math.ceil(totalCount / req.pageSize)),
    records,
  };
}

export function offsetOf(req: PageRequest) {
  return (req.page - 1) * req.pageSize;
}
