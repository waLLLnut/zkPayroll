// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title AuditLog
 * @notice RLWE-encrypted audit log for privacy-preserving compliance
 *
 * This contract stores encrypted sender identities for each transaction,
 * enabling threshold decryption by authorized auditors while maintaining
 * privacy for normal operations.
 *
 * RLWE Parameters:
 * - N = 1024 (polynomial degree)
 * - Q = 167772161 (modulus)
 * - Message slots: 32 (8-bit each, 256 bits total)
 * - Ciphertext: c0 (32 elements) + c1 (1024 elements) = 1056 elements
 */
contract AuditLog {
    // RLWE ciphertext size: 32 (c0) + 1024 (c1) = 1056 Field elements
    uint32 public constant RLWE_CT_SIZE = 1056;

    // 2-of-3 threshold decryption public key hash
    bytes32 public rlwePublicKeyHash;

    // Audit log: nullifier => encrypted sender identity (RLWE ciphertext)
    mapping(bytes32 => bytes) public auditLog;

    // Audit request structure
    struct AuditRequest {
        bytes32 id;
        address requestor;
        bytes32 nullifier;
        string reason;
        uint256 createdAt;
        uint8 approvalCount;
        bool completed;
        mapping(address => bool) approvals;
    }

    // Authorized auditors (2-of-3 threshold)
    address[3] public auditors;
    uint8 public constant THRESHOLD = 2;

    // Audit requests
    mapping(bytes32 => AuditRequest) private auditRequests;
    bytes32[] public requestIds;

    // Events
    event AuditLogStored(
        bytes32 indexed nullifier,
        bytes32 indexed txHash,
        uint256 timestamp
    );

    event AuditRequestCreated(
        bytes32 indexed requestId,
        address indexed requestor,
        bytes32 indexed nullifier,
        string reason
    );

    event AuditApproval(
        bytes32 indexed requestId,
        address indexed auditor,
        uint8 approvalCount
    );

    event AuditCompleted(
        bytes32 indexed requestId,
        bytes32 indexed nullifier,
        uint256 timestamp
    );

    constructor(
        bytes32 _rlwePublicKeyHash,
        address[3] memory _auditors
    ) {
        rlwePublicKeyHash = _rlwePublicKeyHash;
        auditors = _auditors;
    }

    /**
     * @notice Store encrypted sender identity for a transaction
     * @param nullifier The nullifier (unique transaction identifier)
     * @param ciphertext RLWE ciphertext (32 c0 + 1024 c1 = 1056 Field elements)
     * @param txHash Transaction hash for reference
     */
    function storeAuditLog(
        bytes32 nullifier,
        bytes calldata ciphertext,
        bytes32 txHash
    ) external {
        require(
            auditLog[nullifier].length == 0,
            "Audit log already exists for this nullifier"
        );
        require(
            ciphertext.length == RLWE_CT_SIZE * 32,
            "Invalid ciphertext size"
        );

        auditLog[nullifier] = ciphertext;
        emit AuditLogStored(nullifier, txHash, block.timestamp);
    }

    /**
     * @notice Create an audit request for a specific transaction
     * @param nullifier The nullifier to audit
     * @param reason Reason for the audit request
     * @return requestId The unique request ID
     */
    function createAuditRequest(
        bytes32 nullifier,
        string calldata reason
    ) external returns (bytes32 requestId) {
        require(
            auditLog[nullifier].length > 0,
            "No audit log for this nullifier"
        );

        requestId = keccak256(
            abi.encodePacked(nullifier, msg.sender, block.timestamp)
        );

        AuditRequest storage req = auditRequests[requestId];
        req.id = requestId;
        req.requestor = msg.sender;
        req.nullifier = nullifier;
        req.reason = reason;
        req.createdAt = block.timestamp;

        requestIds.push(requestId);

        emit AuditRequestCreated(requestId, msg.sender, nullifier, reason);
    }

    /**
     * @notice Approve an audit request (auditor only)
     * @param requestId The request ID to approve
     */
    function approveAuditRequest(bytes32 requestId) external {
        require(isAuditor(msg.sender), "Not an authorized auditor");

        AuditRequest storage req = auditRequests[requestId];
        require(req.id == requestId, "Request not found");
        require(!req.completed, "Request already completed");
        require(!req.approvals[msg.sender], "Already approved");

        req.approvals[msg.sender] = true;
        req.approvalCount++;

        emit AuditApproval(requestId, msg.sender, req.approvalCount);

        // Check if threshold reached
        if (req.approvalCount >= THRESHOLD) {
            req.completed = true;
            emit AuditCompleted(req.id, req.nullifier, block.timestamp);
        }
    }

    /**
     * @notice Get encrypted sender identity after threshold approval
     * @param requestId The approved request ID
     * @return ciphertext The RLWE ciphertext
     */
    function getApprovedCiphertext(
        bytes32 requestId
    ) external view returns (bytes memory ciphertext) {
        AuditRequest storage req = auditRequests[requestId];
        require(req.completed, "Request not approved by threshold");
        return auditLog[req.nullifier];
    }

    /**
     * @notice Check if an address is an authorized auditor
     */
    function isAuditor(address addr) public view returns (bool) {
        for (uint8 i = 0; i < 3; i++) {
            if (auditors[i] == addr) return true;
        }
        return false;
    }

    /**
     * @notice Get audit request details
     */
    function getAuditRequest(
        bytes32 requestId
    ) external view returns (
        address requestor,
        bytes32 nullifier,
        string memory reason,
        uint256 createdAt,
        uint8 approvalCount,
        bool completed
    ) {
        AuditRequest storage req = auditRequests[requestId];
        return (
            req.requestor,
            req.nullifier,
            req.reason,
            req.createdAt,
            req.approvalCount,
            req.completed
        );
    }

    /**
     * @notice Get total number of audit requests
     */
    function getRequestCount() external view returns (uint256) {
        return requestIds.length;
    }
}
