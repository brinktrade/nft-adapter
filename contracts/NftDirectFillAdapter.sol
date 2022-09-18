// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.8.10;
pragma abicoder v1;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import './IWETH.sol';

contract NftDirectFillAdapter {
  IWETH public weth;
  bool public initialized;

  /// @dev initialize the contract with WETH address
  /// @param _weth Address of weth
  function initialize (IWETH _weth) external {
    require(!initialized, 'INITIALIZED');
    initialized = true;
    weth = _weth;
  }

  function fillWithNft (IERC721 nft, uint256 nftTokenId, address to, bytes calldata data) external {
    nft.transferFrom(msg.sender, address(this), nftTokenId);
    _call(to, data);
  }

  function fillWithToken (IERC20 token, uint256 tokenAmount, address to, bytes calldata data) external {
    token.transferFrom(msg.sender, address(this), tokenAmount);
    _call(to, data);
  }

  function fillWithEth (uint256 ethAmount, address to, bytes calldata data) external {
    weth.transferFrom(msg.sender, address(this), ethAmount);
    weth.withdraw(ethAmount);
    _call(to, data);
  }

  function sweepNft (IERC721 nft, uint256 id, address to) external {
    nft.transferFrom(address(this), to, id);
  }

  function sweepToken (IERC20 token, uint256 amount, address to) external {
    token.transfer(to, amount);
  }

  function sweepEth (uint256 amount, address to) external {
    (bool success, ) = to.call{value: amount}(new bytes(0));
    require(success, 'ETH_TRANSFER_FAILED');
  }

  function _call (address to, bytes calldata data) internal {
    assembly {
      let result := call(gas(), to, 0, add(data, 0x20), mload(data), 0, 0)
      returndatacopy(0, 0, returndatasize())
      switch result
      case 0 {
        revert(0, returndatasize())
      }
      default {
        return(0, returndatasize())
      }
    }
  }

  receive() external payable { }
}
