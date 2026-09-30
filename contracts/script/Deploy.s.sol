// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/StandInAnchor.sol";
import "../src/PaymentVault.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("MONAD_PK", uint256(0x8da690d1d4d878cab206664f9d1f054e574541594cfa45aa1de6f0c65e7bed25));
        vm.startBroadcast(deployerKey);

        StandInAnchor anchor = new StandInAnchor();
        PaymentVault vault = new PaymentVault(address(anchor));

        vm.stopBroadcast();

        console.log("StandInAnchor deployed at:", address(anchor));
        console.log("PaymentVault deployed at:", address(vault));
    }
}