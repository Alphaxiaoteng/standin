// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/StandInAnchor.sol";
import "../src/PaymentVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestUSDC is ERC20 {
    constructor() ERC20("TestUSDC", "USDC") {
        _mint(msg.sender, 10000e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract StandInSecureTest is Test {
    StandInAnchor public anchor;
    PaymentVault public vault;
    TestUSDC public usdc;

    address verifier = address(this); // 测试合约本身作为合规 Verifier 签名节点
    address user = address(0x1);
    address agent = address(0x2);
    address rogueAgent = address(0x999);
    address merchant = address(0x3);
    bytes32 merchantHash = keccak256(abi.encodePacked(merchant, "API Services"));

    function setUp() public {
        usdc = new TestUSDC();
        anchor = new StandInAnchor();
        vault = new PaymentVault(address(anchor));

        // 给 user 分发资金并存入金库
        usdc.transfer(user, 1000e6);
        vm.startPrank(user);
        usdc.approve(address(vault), 1000e6);
        vault.deposit(address(usdc), 100e6);
        vm.stopPrank();
    }

    function test_AccessControl_UnauthorizedAnchor() public {
        bytes32 rh = keccak256("fake-report");
        vm.prank(rogueAgent);
        vm.expectRevert("Not authorized verifier");
        anchor.anchor(rh, rogueAgent, merchant, 10e6, address(usdc), true, "fake");
    }

    function test_Vault_Release_Success() public {
        bytes32 rh = keccak256("valid-report-1");
        // 授权 Verifier 锚定报告
        anchor.anchor(rh, agent, merchant, 10e6, address(usdc), true, "rehearsal passed");

        // 用户向该 Agent 签发 Policy
        vm.prank(user);
        vault.promote(agent, merchantHash, 10e6, 50e6, uint64(block.timestamp + 7 days));

        // Agent 调用 release 成功放行扣款
        vm.prank(agent);
        vault.release(user, merchantHash, merchant, 10e6, address(usdc), rh);

        bytes32 pKey = vault.getPolicyKey(agent, merchantHash);
        assertEq(vault.deposits(user, address(usdc)), 90e6);
        assertEq(usdc.balanceOf(merchant), 10e6);
        assertEq(vault.weeklySpent(user, pKey), 10e6);
    }

    function test_Vault_RogueAgent_Blocked() public {
        bytes32 rh = keccak256("valid-report-2");
        anchor.anchor(rh, agent, merchant, 10e6, address(usdc), true, "passed for agent");

        // 用户仅授权了合法 agent
        vm.prank(user);
        vault.promote(agent, merchantHash, 10e6, 50e6, uint64(block.timestamp + 7 days));

        // 黑客 agent 冒充调用试图提款，触发强校验拦截
        vm.prank(rogueAgent);
        vm.expectRevert("agent caller mismatch with report");
        vault.release(user, merchantHash, merchant, 10e6, address(usdc), rh);
    }

    function test_Vault_EpochRotation() public {
        bytes32 rh1 = keccak256("report-w1");
        bytes32 rh2 = keccak256("report-w2");
        anchor.anchor(rh1, agent, merchant, 30e6, address(usdc), true, "passed");
        anchor.anchor(rh2, agent, merchant, 30e6, address(usdc), true, "passed");

        vm.prank(user);
        vault.promote(agent, merchantHash, 30e6, 50e6, uint64(block.timestamp + 30 days));

        // 第 1 周花 30U
        vm.prank(agent);
        vault.release(user, merchantHash, merchant, 30e6, address(usdc), rh1);

        // 跃迁 8 天进入第 2 周
        vm.warp(block.timestamp + 8 days);

        // 第 2 周再次花 30U，因周期重置成功放行
        vm.prank(agent);
        vault.release(user, merchantHash, merchant, 30e6, address(usdc), rh2);
        
        bytes32 pKey = vault.getPolicyKey(agent, merchantHash);
        assertEq(vault.weeklySpent(user, pKey), 30e6);
    }
}
