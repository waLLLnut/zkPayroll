// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IVerifier} from "./Utils.sol";

/**
 * @title RlweAuditChallenge
 * @notice Optimistic challenge contract for RLWE audit proofs
 *
 * Flow:
 * 1. User submits unshield proof on-chain (wa_commitment emitted)
 * 2. User submits RLWE audit proof to Relayer (off-chain)
 * 3. Relayer verifies and stores ct_commitment + full ciphertext (IPFS)
 * 4. Challenge period (e.g., 7 days)
 * 5. Anyone can challenge with fraud proof if:
 *    - Ciphertext doesn't decrypt correctly
 *    - Noise doesn't satisfy range proof (not small)
 *    - wa_commitment doesn't match
 * 6. Successful challenge = Relayer stake slashed
 */
contract RlweAuditChallenge {
    // Relayer info
    struct Relayer {
        uint256 stake;
        bool isRegistered;
    }

    // Audit log entry (stored by relayer)
    struct AuditEntry {
        bytes32 nullifier;
        bytes32 waCommitment;
        bytes32 ctCommitment;
        string ipfsCid;  // Full ciphertext location
        address relayer;
        uint256 timestamp;
        bool challenged;
        bool slashed;
    }

    // Challenge info
    struct Challenge {
        bytes32 nullifier;
        address challenger;
        uint256 timestamp;
        bool resolved;
        bool successful;
    }

    // Verifier for RLWE audit fraud proofs
    IVerifier public immutable fraudProofVerifier;

    // Minimum stake for relayers
    uint256 public constant MIN_STAKE = 1 ether;

    // Challenge period (7 days)
    uint256 public constant CHALLENGE_PERIOD = 7 days;

    // Relayer registry
    mapping(address => Relayer) public relayers;

    // Audit entries by nullifier
    mapping(bytes32 => AuditEntry) public auditEntries;

    // Challenges by nullifier
    mapping(bytes32 => Challenge) public challenges;

    // Events
    event RelayerRegistered(address indexed relayer, uint256 stake);
    event RelayerUnregistered(address indexed relayer);
    event AuditEntrySubmitted(
        bytes32 indexed nullifier,
        bytes32 waCommitment,
        bytes32 ctCommitment,
        string ipfsCid,
        address indexed relayer
    );
    event ChallengeSubmitted(
        bytes32 indexed nullifier,
        address indexed challenger
    );
    event ChallengeResolved(
        bytes32 indexed nullifier,
        bool successful,
        address indexed winner
    );
    event RelayerSlashed(
        address indexed relayer,
        bytes32 indexed nullifier,
        uint256 amount
    );

    constructor(IVerifier fraudProofVerifier_) {
        fraudProofVerifier = fraudProofVerifier_;
    }

    /**
     * @notice Register as a relayer with stake
     */
    function registerRelayer() external payable {
        require(msg.value >= MIN_STAKE, "Insufficient stake");
        require(!relayers[msg.sender].isRegistered, "Already registered");

        relayers[msg.sender] = Relayer({
            stake: msg.value,
            isRegistered: true
        });

        emit RelayerRegistered(msg.sender, msg.value);
    }

    /**
     * @notice Unregister as relayer (after challenge period for all entries)
     */
    function unregisterRelayer() external {
        Relayer storage relayer = relayers[msg.sender];
        require(relayer.isRegistered, "Not registered");

        uint256 stake = relayer.stake;
        relayer.isRegistered = false;
        relayer.stake = 0;

        (bool success, ) = msg.sender.call{value: stake}("");
        require(success, "Transfer failed");

        emit RelayerUnregistered(msg.sender);
    }

    /**
     * @notice Submit audit entry (by relayer)
     * @param nullifier Transaction nullifier (from unshield)
     * @param waCommitment WaAddress commitment (from unshield proof)
     * @param ctCommitment Ciphertext commitment (hash of full RLWE ciphertext)
     * @param ipfsCid IPFS CID where full ciphertext is stored
     */
    function submitAuditEntry(
        bytes32 nullifier,
        bytes32 waCommitment,
        bytes32 ctCommitment,
        string calldata ipfsCid
    ) external {
        require(relayers[msg.sender].isRegistered, "Not a registered relayer");
        require(auditEntries[nullifier].timestamp == 0, "Entry already exists");

        auditEntries[nullifier] = AuditEntry({
            nullifier: nullifier,
            waCommitment: waCommitment,
            ctCommitment: ctCommitment,
            ipfsCid: ipfsCid,
            relayer: msg.sender,
            timestamp: block.timestamp,
            challenged: false,
            slashed: false
        });

        emit AuditEntrySubmitted(
            nullifier,
            waCommitment,
            ctCommitment,
            ipfsCid,
            msg.sender
        );
    }

    /**
     * @notice Challenge an audit entry with fraud proof
     * @param nullifier The nullifier of the entry to challenge
     * @param fraudProof ZK proof showing the RLWE audit is invalid
     *
     * The fraud proof circuit proves ONE of:
     * 1. ctCommitment != hash(provided_ciphertext)
     * 2. Ciphertext doesn't decrypt to claimed waCommitment
     * 3. Noise values are not small (range proof violation)
     */
    function challenge(
        bytes32 nullifier,
        bytes calldata fraudProof
    ) external {
        AuditEntry storage entry = auditEntries[nullifier];
        require(entry.timestamp != 0, "Entry does not exist");
        require(!entry.challenged, "Already challenged");
        require(!entry.slashed, "Already slashed");
        require(
            block.timestamp <= entry.timestamp + CHALLENGE_PERIOD,
            "Challenge period expired"
        );

        // Verify fraud proof
        // Public inputs: nullifier, waCommitment, ctCommitment
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = nullifier;
        publicInputs[1] = entry.waCommitment;
        publicInputs[2] = entry.ctCommitment;

        require(
            fraudProofVerifier.verify(fraudProof, publicInputs),
            "Invalid fraud proof"
        );

        // Mark as challenged and slash relayer
        entry.challenged = true;
        entry.slashed = true;

        challenges[nullifier] = Challenge({
            nullifier: nullifier,
            challenger: msg.sender,
            timestamp: block.timestamp,
            resolved: true,
            successful: true
        });

        // Slash relayer stake
        Relayer storage relayer = relayers[entry.relayer];
        uint256 slashAmount = relayer.stake;
        relayer.stake = 0;
        relayer.isRegistered = false;

        // Reward challenger (50% of stake)
        uint256 reward = slashAmount / 2;
        (bool success, ) = msg.sender.call{value: reward}("");
        require(success, "Reward transfer failed");

        emit ChallengeResolved(nullifier, true, msg.sender);
        emit RelayerSlashed(entry.relayer, nullifier, slashAmount);
    }

    /**
     * @notice Check if an audit entry is valid (passed challenge period)
     */
    function isAuditEntryValid(bytes32 nullifier) external view returns (bool) {
        AuditEntry storage entry = auditEntries[nullifier];
        if (entry.timestamp == 0) return false;
        if (entry.slashed) return false;
        if (block.timestamp <= entry.timestamp + CHALLENGE_PERIOD) {
            return false; // Still in challenge period
        }
        return true;
    }

    /**
     * @notice Get audit entry details
     */
    function getAuditEntry(bytes32 nullifier)
        external
        view
        returns (AuditEntry memory)
    {
        return auditEntries[nullifier];
    }
}
