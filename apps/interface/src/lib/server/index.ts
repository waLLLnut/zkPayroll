import { lib } from "$lib";
import { createBackendSdk } from "@repo/contracts/sdk/backendSdk";
import { TreesService } from "@repo/contracts/sdk/serverSdk";

const trees = new TreesService(lib.contract);
const backendSdk = createBackendSdk(lib, trees, {
  rollup: import("@repo/contracts/noir/target/rollup.json"),
});

export const serverLib = {
  ...backendSdk,
  trees,
};
