import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

// Skip this test - @aztec/aztec.js is not installed
describe.skip("NonMembershipTree", () => {
  const depth = 32;
  let leaves: any[];
  let tree: any;
  beforeEach(async () => {
    // Test requires @aztec/aztec.js which is not available
  });

  it("proves non-membership", async () => {
    const { Fr } = await eval(`import("@aztec/aztec.js")`);
    await tree.getNonMembershipWitness(new Fr(2));
  });

  it("fails for members", async () => {
    for (const leaf of leaves) {
      await expect(tree.getNonMembershipWitness(leaf)).rejectedWith(
        `key already present: "${leaf}"`,
      );
    }
  });
});
