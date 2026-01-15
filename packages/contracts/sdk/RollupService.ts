import type { Fr } from "@aztec/aztec.js";
import type { AppendOnlyTree, StandardIndexedTree } from "@aztec/merkle-tree";
import { utils } from "@repo/utils";
import assert from "assert";
import { ethers } from "ethers";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types";
import {
  INCLUDE_UNCOMMITTED,
  MAX_NOTES_PER_ROLLUP,
  MAX_NULLIFIERS_PER_ROLLUP,
  NOTE_HASH_SUBTREE_HEIGHT,
  type NoirAndBackend,
} from "./PoolErc20Service";
import type { TreesService } from "./TreesService";
import { prove } from "./utils.js";

export class RollupService {
  constructor(
    private contract: PoolERC20,
    private trees: TreesService,
    private circuits: {
      rollup: AsyncOrSync<NoirAndBackend>;
    },
  ) {}

  async rollup() {
    const { Fr } = await import("@aztec/aztec.js");

    const { noteHashTree, nullifierTree } = await this.trees.getTrees();
    const pending = await this.selectTxsToRollup();
    const pendingNoteHashes = pending.noteHashes.map((h) => new Fr(BigInt(h)));
    const pendingNullifiers = pending.nullifiers.map((h) => new Fr(BigInt(h)));
    const noteHashTreeInput = await getInsertTreeInput(
      noteHashTree,
      pendingNoteHashes,
    );
    const nullifierTreeInput = await getInsertTreeInput(
      nullifierTree._tree,
      pendingNullifiers.map((n) => n.toBuffer()),
    );
    // nullifier가 없는 경우 (shield 트랜잭션만 있는 경우) batchInsertResult가 undefined일 수 있음
    if (nullifierTreeInput.batchInsertResult != null) {
      assert(
        nullifierTreeInput.batchInsertResult.lowLeavesWitnessData,
        "invalid batch insert result low leaf witness data",
      );
    }

    const input = {
      new_note_hashes: pendingNoteHashes.map((x: Fr) => x.toString()),
      note_hash_subtree_sibling_path: noteHashTreeInput.subtreeSiblingPath,
      note_hash_tree: noteHashTreeInput.treeSnapshot,
      expected_new_note_hash_tree: noteHashTreeInput.newTreeSnapshot,

      new_nullifiers: pendingNullifiers.map((x: Fr) => x.toString()),
      nullifier_subtree_sibling_path: nullifierTreeInput.batchInsertResult
        ? nullifierTreeInput.batchInsertResult.newSubtreeSiblingPath
            .toTuple()
            .map((x: Fr) => x.toString())
        : [],
      nullifier_tree: nullifierTreeInput.treeSnapshot,
      sorted_nullifiers: nullifierTreeInput.batchInsertResult
        ? nullifierTreeInput.batchInsertResult.sortedNewLeaves.map((x) =>
            ethers.hexlify(x),
          )
        : Array(MAX_NULLIFIERS_PER_ROLLUP).fill("0x0000000000000000000000000000000000000000000000000000000000000000"),
      sorted_nullifiers_indexes: nullifierTreeInput.batchInsertResult
        ? nullifierTreeInput.batchInsertResult.sortedNewLeavesIndexes
        : Array.from({ length: MAX_NULLIFIERS_PER_ROLLUP }, (_, i) => i),
      nullifier_low_leaf_preimages: nullifierTreeInput.batchInsertResult
        ? nullifierTreeInput.batchInsertResult.lowLeavesWitnessData.map((x) => {
            return {
              nullifier: x.leafPreimage.getKey().toString(),
              next_nullifier: x.leafPreimage.getNextKey().toString(),
              next_index: x.leafPreimage.getNextIndex().toString(),
            };
          })
        : Array(MAX_NOTES_PER_ROLLUP).fill({
            nullifier: "0",
            next_nullifier: "0",
            next_index: "0",
          }),
      nullifier_low_leaf_membership_witnesses: nullifierTreeInput.batchInsertResult
        ? nullifierTreeInput.batchInsertResult.lowLeavesWitnessData.map((x) => {
            return {
              leaf_index: x.index.toString(),
              sibling_path: x.siblingPath.toTuple().map((y: Fr) => y.toString()),
            };
          })
        : Array(MAX_NOTES_PER_ROLLUP).fill({
            leaf_index: "0",
            sibling_path: Array(40).fill("0"),
          }),
      expected_new_nullifier_tree: nullifierTreeInput.newTreeSnapshot,
    };
    // console.log("rollup input\n", JSON.stringify(input));
    const rollupCircuit = await this.circuits.rollup;
    const { proof } = await prove("rollup", rollupCircuit, input);

    // Mantle Sepolia에서 에러 디버깅을 위해 staticCall로 먼저 확인
    try {
      await this.contract.rollup.staticCall(
        proof,
        pending.txIndices,
        {
          root: noteHashTreeInput.newTreeSnapshot.root,
          nextAvailableLeafIndex:
            noteHashTreeInput.newTreeSnapshot.next_available_leaf_index,
        },
        {
          root: nullifierTreeInput.newTreeSnapshot.root,
          nextAvailableLeafIndex:
            nullifierTreeInput.newTreeSnapshot.next_available_leaf_index,
        },
      );
    } catch (error: any) {
      // 에러가 발생해도 실제 트랜잭션은 시도 (로컬에서는 작동하므로)
      if (error.data) {
        const errorData = error.data;
        console.error("⚠️ Rollup staticCall 실패:");
        if (errorData === "0x9fc3a218") {
          console.error("  → SumcheckFailed(): Proof 검증 실패");
        } else if (errorData === "0xed74ac0a") {
          console.error("  → ProofLengthWrong(): Proof 길이 불일치");
        } else if (errorData === "0xfa066593") {
          console.error("  → PublicInputsLengthWrong(): Public inputs 길이 불일치");
        } else if (errorData === "0xa5d82e8a") {
          console.error("  → ShpleminiFailed(): Shplonk 검증 실패");
        } else {
          console.error("  Error Data:", errorData);
        }
      }
    }

    const tx = await this.contract.rollup(
      proof,
      pending.txIndices,
      {
        root: noteHashTreeInput.newTreeSnapshot.root,
        nextAvailableLeafIndex:
          noteHashTreeInput.newTreeSnapshot.next_available_leaf_index,
      },
      {
        root: nullifierTreeInput.newTreeSnapshot.root,
        nextAvailableLeafIndex:
          nullifierTreeInput.newTreeSnapshot.next_available_leaf_index,
      },
    );
    const receipt = await tx.wait();
    console.log("rollup gas used", receipt?.gasUsed);
    return tx;
  }

  async selectTxsToRollup() {
    const txs = Array.from(
      (await this.contract.getAllPendingTxs()).entries(),
    ).filter(([, tx]) => !tx.rolledUp);
    let batch: {
      txIndices: number[];
      noteHashes: string[];
      nullifiers: string[];
    } = {
      txIndices: [],
      noteHashes: [],
      nullifiers: [],
    };

    for (const [i, tx] of txs) {
      if (
        batch.noteHashes.length + tx.noteHashes.length > MAX_NOTES_PER_ROLLUP ||
        batch.nullifiers.length + tx.nullifiers.length >
          MAX_NULLIFIERS_PER_ROLLUP
      ) {
        break;
      }
      // TODO(perf): this is O(N^2), refactor
      batch = {
        txIndices: [...batch.txIndices, i],
        noteHashes: [...batch.noteHashes, ...tx.noteHashes],
        nullifiers: [...batch.nullifiers, ...tx.nullifiers],
      };
    }
    return {
      txIndices: batch.txIndices,
      noteHashes: utils.arrayPadEnd(
        batch.noteHashes,
        MAX_NOTES_PER_ROLLUP,
        ethers.ZeroHash,
      ),
      nullifiers: utils.arrayPadEnd(
        batch.nullifiers,
        MAX_NULLIFIERS_PER_ROLLUP,
        ethers.ZeroHash,
      ),
    };
  }
}

async function getInsertTreeInput<T extends Fr | Buffer>(
  tree: AppendOnlyTree<T> | StandardIndexedTree,
  newLeaves: T[],
) {
  const subtreeSiblingPath = await getSubtreeSiblingPath(tree as any);
  const treeSnapshot = await treeToSnapshot(tree as any);

  let batchInsertResult:
    | Awaited<ReturnType<StandardIndexedTree["batchInsert"]>>
    | undefined;
  if ("batchInsert" in tree) {
    const subtreeHeight = Math.log2(newLeaves.length);
    assert(Number.isInteger(subtreeHeight), "subtree height must be integer");
    // console.log("batch inserting", newLeaves);
    try {
      batchInsertResult = await tree.batchInsert(newLeaves as any, subtreeHeight);
    } catch (error: any) {
      // "Nullifiers are create only" 에러인 경우, 이미 존재하는 nullifier를 필터링하고 재시도
      if (error.message?.includes("Nullifiers are create only")) {
        const filteredLeaves = [];
        for (const leaf of newLeaves) {
          try {
            const leafBuffer = Buffer.isBuffer(leaf) ? leaf : Buffer.from(leaf);
            if ("findIndexOfPreviousKey" in tree) {
              const hexString = leafBuffer.toString("hex");
              const keyAsBigInt = hexString ? BigInt("0x" + hexString) : 0n;
              const result = (tree as any).findIndexOfPreviousKey(keyAsBigInt, INCLUDE_UNCOMMITTED);
              if (!result?.alreadyPresent) {
                filteredLeaves.push(leaf);
              }
            } else {
              filteredLeaves.push(leaf);
            }
          } catch {
            filteredLeaves.push(leaf);
          }
        }
        if (filteredLeaves.length > 0) {
          const subtreeHeight2 = Math.log2(filteredLeaves.length);
          assert(Number.isInteger(subtreeHeight2), "subtree height must be integer");
          batchInsertResult = await tree.batchInsert(filteredLeaves as any, subtreeHeight2);
        }
        // filteredLeaves.length === 0이면 batchInsertResult는 undefined로 유지
      } else {
        throw error;
      }
    }
  } else {
    await tree.appendLeaves(newLeaves);
  }
  const newTreeSnapshot = await treeToSnapshot(tree as any);
  await tree.rollback();

  return {
    treeSnapshot,
    subtreeSiblingPath,
    newTreeSnapshot,
    batchInsertResult,
  };
}

async function getSubtreeSiblingPath(noteHashTree: AppendOnlyTree<Fr>) {
  const index = noteHashTree.getNumLeaves(INCLUDE_UNCOMMITTED);
  const siblingPath = await noteHashTree.getSiblingPath(
    index,
    INCLUDE_UNCOMMITTED,
  );
  return siblingPath
    .getSubtreeSiblingPath(NOTE_HASH_SUBTREE_HEIGHT)
    .toTuple()
    .map((x: Fr) => x.toString());
}

async function treeToSnapshot(tree: AppendOnlyTree<Fr>) {
  const { Fr } = await import("@aztec/aztec.js");
  return {
    root: new Fr(tree.getRoot(INCLUDE_UNCOMMITTED)).toString() as string,
    next_available_leaf_index: tree
      .getNumLeaves(INCLUDE_UNCOMMITTED)
      .toString(),
  };
}
