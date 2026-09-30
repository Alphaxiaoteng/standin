// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/StandInAnchor.sol";
import "../src/PaymentVault.sol";

contract Deploy is Script {
    function run() external {
        // 私钥只能来自环境变量，绝不写入源码或提交进仓库。
        uint256 deployerKey = vm.envUint("MONAD_PK");
        vm.startBroadcast(deployerKey);

        StandInAnchor anchor = new StandInAnchor();
        PaymentVault vault = new PaymentVault(address(anchor));

        vm.stopBroadcast();

        console.log("StandInAnchor deployed at:", address(anchor));
        console.log("PaymentVault deployed at:", address(vault));
    }
}