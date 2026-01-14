// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IVerifier} from "../Utils.sol";

/**
 * @title MockVerifier
 * @notice Mock verifier for testing that always returns true
 * In production, this would be replaced with actual ZK proof verifiers
 */
contract MockVerifier is IVerifier {
    /**
     * @notice Always returns true for testing purposes
     */
    function verify(
        bytes calldata /* proof */,
        bytes32[] calldata /* publicInputs */
    ) external pure override returns (bool) {
        return true;
    }
}

/**
 * @title MockRejectingVerifier
 * @notice Mock verifier that always returns false (for negative test cases)
 */
contract MockRejectingVerifier is IVerifier {
    function verify(
        bytes calldata /* proof */,
        bytes32[] calldata /* publicInputs */
    ) external pure override returns (bool) {
        return false;
    }
}
