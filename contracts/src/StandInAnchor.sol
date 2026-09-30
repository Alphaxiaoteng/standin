// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice 彩排报告锚定：必须由经授权的 Intent Firewall 校验节点或特定 Agent 签名提交
contract StandInAnchor {
    struct Report {
        bytes32 reportHash;   // keccak256(意图声明 + 实际参数 + 比对结果)
        address agent;        // 报告归属的 Agent 实体
        address to;           // 校验通过的目标收款方
        uint256 amount;       // 校验通过的放款金额
        address token;        // 校验通过的 Token 资产
        bool    allowed;      // 是否放行
        uint64  anchoredAt;
        string  reason;
    }

    address public owner;
    mapping(address => bool) public authorizedVerifiers;
    mapping(bytes32 => Report) public reports;
    uint64 public totalAnchored;
    uint64 public totalBlocked;

    event VerifierUpdated(address indexed verifier, bool active);
    event Anchored(bytes32 indexed reportHash, address indexed agent, bool allowed, string reason);

    modifier onlyAuthorized() {
        require(msg.sender == owner || authorizedVerifiers[msg.sender], "Not authorized verifier");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedVerifiers[msg.sender] = true;
    }

    function setVerifier(address verifier, bool active) external {
        require(msg.sender == owner, "Only owner");
        authorizedVerifiers[verifier] = active;
        emit VerifierUpdated(verifier, active);
    }

    function anchor(
        bytes32 reportHash,
        address agent,
        address to,
        uint256 amount,
        address token,
        bool allowed,
        string calldata reason
    ) external onlyAuthorized {
        require(reports[reportHash].anchoredAt == 0, "already anchored");
        reports[reportHash] = Report(reportHash, agent, to, amount, token, allowed, uint64(block.timestamp), reason);
        if (allowed) totalAnchored++; else totalBlocked++;
        emit Anchored(reportHash, agent, allowed, reason);
    }
}
