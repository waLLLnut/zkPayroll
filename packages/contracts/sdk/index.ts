// Re-export everything from sdk.ts
export * from "./sdk";

// Also export as namespace for tests that use `import { sdk } from "../sdk"`
import * as sdkExports from "./sdk";
export const sdk = sdkExports;
