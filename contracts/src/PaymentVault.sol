// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./StandInAnchor.sol";

/// @notice 付款金库：通过状态机强制执行意图防火墙校验，严格绑定 Agent 身份与接收方 Hash
contract PaymentVault {
    using SafeERC20 for IERC20;

    StandInAnchor public immutable anchor;

    struct Policy {
        address agent;        // 授权的具体 Agent 地址
        bytes32 merchantHash; // 合规商户/用途哈希 (keccak256(to, purpose))
        uint128 maxPerTx;     // 单笔最大限额
        uint128 maxPerWeek;   // 每周最大限额
        uint64  expires;      // 策略有效期
        uint64  currentEpoch; // 当前周期时间戳
        bool    exists;       // 策略是否存在
    }

    // user => (agent, merchantHash) 复合键 => Policy
    mapping(address => mapping(bytes32 => Policy)) public policies;
    // user => (agent, merchantHash) 复合键 => 当前周期已花销额度
    mapping(address => mapping(bytes32 => uint256)) public weeklySpent;
    // user => token => 可用存入余额
    mapping(address => mapping(address => uint256)) public deposits;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Promoted(address indexed user, address indexed agent, bytes32 indexed merchantHash, Policy policy);
    event Revoked(address indexed user, bytes32 indexed policyKey);
    event Released(address indexed user, address indexed agent, bytes32 indexed reportHash, address to, uint256 amount);

    constructor(address _anchor) {
        anchor = StandInAnchor(_anchor);
    }

    function getPolicyKey(address agent, bytes32 merchantHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(agent, merchantHash));
    }

    function deposit(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external {
        require(deposits[msg.sender][token] >= amount, "insufficient deposit");
        deposits[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function promote(
        address agent,
        bytes32 merchantHash,
        uint128 maxPerTx,
        uint128 maxPerWeek,
        uint64 expires
    ) external {
        require(agent != address(0), "Invalid agent");
        bytes32 pKey = getPolicyKey(agent, merchantHash);
        uint64 epoch = uint64(block.timestamp / 7 days);

        policies[msg.sender][pKey] = Policy({
            agent: agent,
            merchantHash: merchantHash,
            maxPerTx: maxPerTx,
            maxPerWeek: maxPerWeek,
            expires: expires,
            currentEpoch: epoch,
            exists: true
        });

        emit Promoted(msg.sender, agent, merchantHash, policies[msg.sender][pKey]);
    }

    function revoke(address agent, bytes32 merchantHash) external {
        bytes32 pKey = getPolicyKey(agent, merchantHash);
        delete policies[msg.sender][pKey];
        emit Revoked(msg.sender, pKey);
    }

    function release(
        address user,
        bytes32 merchantHash,
        address to,
        uint256 amount,
        address token,
        bytes32 reportHash
    ) external {
        // 1. 验证报告已在 StandInAnchor 锚定且放行
        (, address rAgent, address rTo, uint256 rAmount, address rToken, bool rAllowed, , ) = anchor.reports(reportHash);
        require(rAllowed, "report not allowed");
        require(rTo == to && rAmount == amount && rToken == token, "report mismatch");
        require(rAgent == msg.sender, "agent caller mismatch with report");

        // 2. 强校验：调用者必须与用户授权的 Policy 强绑定
        bytes32 pKey = getPolicyKey(msg.sender, merchantHash);
        Policy storage p = policies[user][pKey];
        require(p.exists, "no policy");
        require(p.agent == msg.sender, "unauthorized agent caller");
        require(block.timestamp <= p.expires, "policy expired");
        require(amount <= p.maxPerTx, "exceeds per-tx limit");

        // 3. 时间窗口周期滚动（Epoch Rolling）校验每周限额
        uint64 currentEpoch = uint64(block.timestamp / 7 days);
        if (p.currentEpoch < currentEpoch) {
            p.currentEpoch = currentEpoch;
            weeklySpent[user][pKey] = 0; // 新周期重置支出
        }
        require(weeklySpent[user][pKey] + amount <= p.maxPerWeek, "exceeds weekly limit");

        // 4. 验证余额充足并扣款
        require(deposits[user][token] >= amount, "insufficient deposit");
        deposits[user][token] -= amount;
        weeklySpent[user][pKey] += amount;

        IERC20(token).safeTransfer(to, amount);
        emit Released(user, msg.sender, reportHash, to, amount);
    }
}
