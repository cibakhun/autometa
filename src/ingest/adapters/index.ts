import type { SourceAdapter } from "../adapter";
import { createDemoAdapter } from "./demo";

/** All known sources. Add a real adapter here once its access is agreed. */
export const ADAPTERS: Record<string, () => SourceAdapter> = {
  demo: () => createDemoAdapter({ count: Number(process.env.DEMO_LISTING_COUNT ?? 3000) }),
};
