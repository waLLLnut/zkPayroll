// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Fr, FrLib, keccak256ToFr} from "./Fr.sol";
import {IVerifier, NoteInput, TokenAmount, Call, Execution, MAX_TOKENS_IN_PER_EXECUTION, MAX_TOKENS_OUT_PER_EXECUTION, PublicInputs, U256_LIMBS} from "./Utils.sol";
import {PoolGeneric} from "./PoolGeneric.sol";

// Note: keep in sync with other languages
uint32 constant MAX_NOTES_TO_JOIN = 2;

contract PoolERC20 is PoolGeneric {
    using SafeERC20 for IERC20;
    using FrLib for Fr;
    using PublicInputs for PublicInputs.Type;

    struct PoolERC20Storage {
        IVerifier shieldVerifier;
        IVerifier unshieldVerifier;
        IVerifier joinVerifier;
        IVerifier transferVerifier;
        IVerifier swapVerifier;
    }

    // __LatticA__: Event for audit log linking (wa_commitment only, ciphertext off-chain)
    event UnshieldAuditLog(
        bytes32 indexed nullifier,
        bytes32 waCommitment
    );

    constructor(
        IVerifier shieldVerifier,
        IVerifier unshieldVerifier,
        IVerifier joinVerifier,
        IVerifier transferVerifier,
        IVerifier swapVerifier,
        IVerifier rollupVerifier,
        bytes32 lwePublicKeyHash
    ) PoolGeneric(rollupVerifier, lwePublicKeyHash) {
        _poolErc20Storage().shieldVerifier = shieldVerifier;
        _poolErc20Storage().unshieldVerifier = unshieldVerifier;
        _poolErc20Storage().joinVerifier = joinVerifier;
        _poolErc20Storage().transferVerifier = transferVerifier;
        _poolErc20Storage().swapVerifier = swapVerifier;
    }

    function shield(
        bytes calldata proof,
        IERC20 token,
        uint256 amount,
        NoteInput calldata note
    ) external {
        token.safeTransferFrom(msg.sender, address(this), amount);

        PublicInputs.Type memory pi = PublicInputs.create(1 + 2 + 1);
        pi.push(getNoteHashTree().root);
        pi.push(address(token));
        pi.pushUint256Limbs(amount);
        pi.push(note.noteHash);
        require(
            _poolErc20Storage().shieldVerifier.verify(proof, pi.finish()),
            "Invalid shield proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = note;
            bytes32[] memory nullifiers;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }
    }

    /**
     * @notice Unshield tokens from privacy pool
     * @dev __LatticA__: Circuit now outputs wa_commitment for audit proof linking
     *
     * Circuit output: {note_hashes[1], nullifiers[1], wa_commitment}
     *
     * The wa_commitment links this proof to a separate RLWE audit proof
     * that the relayer verifies off-chain (optimistic verification)
     */
    function unshield(
        bytes calldata proof,
        IERC20 token,
        address to,
        uint256 amount,
        bytes32 nullifier,
        NoteInput calldata changeNote,
        bytes32 waCommitment  // __LatticA__: for audit proof linking
    ) external {
        // Circuit public inputs:
        // 1. tree_roots.note_hash_root
        // 2. to
        // 3. amount.token
        // 4. amount.amount (U256)
        // Circuit public outputs:
        // 5. note_hashes[0]
        // 6. nullifiers[0]
        // 7. wa_commitment

        PublicInputs.Type memory pi = PublicInputs.create(1 + 1 + 1 + 1 + 1 + 1 + 1);
        pi.push(getNoteHashTree().root);
        pi.push(to);
        pi.push(address(token));
        pi.pushUint256Limbs(amount);
        pi.push(changeNote.noteHash);
        pi.push(nullifier);
        pi.push(waCommitment);

        require(
            _poolErc20Storage().unshieldVerifier.verify(proof, pi.finish()),
            "Invalid unshield proof"
        );

        // __LatticA__: Emit audit log event for relayer to index
        emit UnshieldAuditLog(nullifier, waCommitment);

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = changeNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }

        token.safeTransfer(to, amount);
    }

    function join(
        bytes calldata proof,
        bytes32[MAX_NOTES_TO_JOIN] calldata nullifiers,
        NoteInput calldata joinNote
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(
            1 + MAX_NOTES_TO_JOIN + 1
        );
        pi.push(getNoteHashTree().root);
        pi.push(joinNote.noteHash);
        for (uint256 i = 0; i < MAX_NOTES_TO_JOIN; i++) {
            pi.push(nullifiers[i]);
        }
        require(
            _poolErc20Storage().joinVerifier.verify(proof, pi.finish()),
            "Invalid join proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = joinNote;
            bytes32[] memory nullifiersDyn = new bytes32[](nullifiers.length);
            for (uint256 i = 0; i < nullifiers.length; i++) {
                nullifiersDyn[i] = nullifiers[i];
            }
            _PoolGeneric_addPendingTx(noteInputs, nullifiersDyn);
        }
    }

    function transfer(
        bytes calldata proof,
        bytes32 nullifier,
        NoteInput calldata changeNote,
        NoteInput calldata toNote
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(4);
        pi.push(getNoteHashTree().root);
        pi.push(changeNote.noteHash);
        pi.push(toNote.noteHash);
        pi.push(nullifier);

        require(
            _poolErc20Storage().transferVerifier.verify(proof, pi.finish()),
            "Invalid transfer proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](2);
            noteInputs[0] = changeNote;
            noteInputs[1] = toNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }
    }

    function swap(
        bytes calldata proof,
        NoteInput[4] calldata notes,
        bytes32[2] calldata nullifiers
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(1 + 6);
        pi.push(getNoteHashTree().root);
        pi.push(notes[0].noteHash);
        pi.push(notes[1].noteHash);
        pi.push(notes[2].noteHash);
        pi.push(notes[3].noteHash);
        pi.push(nullifiers[0]);
        pi.push(nullifiers[1]);
        require(
            _poolErc20Storage().swapVerifier.verify(proof, pi.finish()),
            "Invalid swap proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](4);
            noteInputs[0] = notes[0];
            noteInputs[1] = notes[1];
            noteInputs[2] = notes[2];
            noteInputs[3] = notes[3];
            bytes32[] memory nullifiersDyn = new bytes32[](nullifiers.length);
            for (uint256 i = 0; i < nullifiers.length; i++) {
                nullifiersDyn[i] = nullifiers[i];
            }
            _PoolGeneric_addPendingTx(noteInputs, nullifiersDyn);
        }
    }

    function _poolErc20Storage()
        private
        pure
        returns (PoolERC20Storage storage s)
    {
        assembly {
            s.slot := STORAGE_SLOT
        }
    }
}

// keccak256("storage.PoolERC20") - 1
bytes32 constant STORAGE_SLOT = 0x2f64cf42bfffdfbf199004d3529d110e06f94674b975e86640e5dc11173fedfe;
